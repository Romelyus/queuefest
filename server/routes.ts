import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { log } from "./log";
import {
  insertEventSchema,
  insertTableSchema,
  loginSchema,
  joinQueueSchema,
  QueueEntryStatus,
  TableStatus,
  UserRole,
} from "../shared/schema";

// Telegram Bot API helper
const BOT_TOKEN = process.env.BOT_TOKEN || "";

async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  if (!BOT_TOKEN) {
    log("⚠️  BOT_TOKEN not set, skipping Telegram notification");
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    const result = await res.json();
    if (!result.ok) {
      log(`Telegram error: ${JSON.stringify(result)}`);
      return false;
    }
    return true;
  } catch (e: any) {
    log(`Telegram send error: ${e.message}`);
    return false;
  }
}

// Confirmation timeout: 3 minutes (for notification confirmation)
const CONFIRM_TIMEOUT_MS = 3 * 60 * 1000;
// Walk timeout: 3 minutes (to reach the table after confirming)
const WALK_TIMEOUT_MS = 3 * 60 * 1000;

const confirmTimers = new Map<string, NodeJS.Timeout>();
const walkTimers = new Map<string, NodeJS.Timeout>();

async function notifyNextInQueue(tableId: string) {
  // Check how many slots are available
  const table = await storage.getTable(tableId);
  if (!table) return;

  const maxSlots = table.maxParallelGames || 1;
  const allQueue = await storage.getActiveQueueForTableWithPlaying(tableId);
  const playingCount = allQueue.filter((e) => e.status === QueueEntryStatus.PLAYING).length;
  const confirmedCount = allQueue.filter((e) => e.status === QueueEntryStatus.CONFIRMED).length;
  const notifiedCount = allQueue.filter((e) => e.status === QueueEntryStatus.NOTIFIED).length;

  // Available slots = max - playing - confirmed - notified (people already on their way)
  const occupiedSlots = playingCount + confirmedCount + notifiedCount;
  const availableSlots = maxSlots - occupiedSlots;

  if (availableSlots <= 0) return;

  // Notify as many waiting users as we have available slots
  const waiting = allQueue.filter((e) => e.status === QueueEntryStatus.WAITING);
  const toNotify = waiting.slice(0, availableSlots);

  for (const next of toNotify) {
    const deadline = new Date(Date.now() + CONFIRM_TIMEOUT_MS).toISOString();
    await storage.updateQueueEntry(next.id, {
      status: QueueEntryStatus.NOTIFIED,
      notifiedAt: new Date().toISOString(),
      confirmDeadline: deadline,
    });

    // Try to send Telegram notification (subscription is per-user now)
    const sub = await storage.getSubscriptionByUserId(next.userId);
    if (sub?.chat_id) {
      const gameName = table.gameName || "игра";
      const tableName = table.tableName || "стол";
      await sendTelegramMessage(
        sub.chat_id,
        `🎲 <b>Ваша очередь подошла!</b>\n\nИгра: ${gameName}\nСтол: ${tableName}\n\nПодойдите к столу в течение 3 минут.`
      );
    }

    // Set confirmation timeout
    const timer = setTimeout(async () => {
      try {
        const entry = await storage.getQueueEntry(next.id);
        if (entry && entry.status === QueueEntryStatus.NOTIFIED) {
          await storage.updateQueueEntry(next.id, {
            status: QueueEntryStatus.EXPIRED,
            completedAt: new Date().toISOString(),
          });
          // Reposition remaining and notify next person
          const active = await storage.getActiveQueueForTable(tableId);
          for (let i = 0; i < active.length; i++) {
            await storage.updateQueueEntry(active[i].id, { position: i + 1 });
          }
          await notifyNextInQueue(tableId);
        }
      } catch (err: any) {
        log(`Confirm timer error: ${err.message}`);
      }
      confirmTimers.delete(next.id);
    }, CONFIRM_TIMEOUT_MS);

    confirmTimers.set(next.id, timer);
  }
}

// Start walk timer after user confirms
function startWalkTimer(entryId: string, tableId: string) {
  const timer = setTimeout(async () => {
    try {
      const entry = await storage.getQueueEntry(entryId);
      if (entry && entry.status === QueueEntryStatus.CONFIRMED) {
        // User didn't start the game within 3 minutes — expire them
        await storage.updateQueueEntry(entryId, {
          status: QueueEntryStatus.EXPIRED,
          completedAt: new Date().toISOString(),
        });

        // Send Telegram notification about expiry
        const sub = await storage.getSubscriptionByUserId(entry.userId);
        if (sub?.chat_id) {
          await sendTelegramMessage(
            sub.chat_id,
            `⏰ <b>Время истекло</b>\n\nВы не успели подойти к столу за 3 минуты.\nЗапишитесь в очередь снова через QR-код.`
          );
        }

        // Reposition remaining and notify next person
        const active = await storage.getActiveQueueForTable(tableId);
        for (let i = 0; i < active.length; i++) {
          await storage.updateQueueEntry(active[i].id, { position: i + 1 });
        }

        // Update table status if no one is playing/confirmed
        const allQueue = await storage.getActiveQueueForTableWithPlaying(tableId);
        const stillPlaying = allQueue.filter((e) =>
          e.status === QueueEntryStatus.PLAYING || e.status === QueueEntryStatus.CONFIRMED
        ).length;
        if (stillPlaying === 0) {
          await storage.updateTable(tableId, {
            status: TableStatus.FREE,
            currentSessionStart: null,
          });
        }

        await notifyNextInQueue(tableId);
      }
    } catch (err: any) {
      log(`Walk timer error: ${err.message}`);
    }
    walkTimers.delete(entryId);
  }, WALK_TIMEOUT_MS);

  walkTimers.set(entryId, timer);
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // ====== AUTH ======
  // User login — uses active event automatically
  app.post("/api/auth/login", async (req, res) => {
    try {
      const data = loginSchema.parse(req.body);
      const activeEvent = await storage.getActiveEvent();
      if (!activeEvent) {
        return res.status(400).json({ message: "Нет активного события. Обратитесь к администратору." });
      }
      let user = await storage.getUserByBracelet(data.braceletId, activeEvent.id);
      if (!user) {
        user = await storage.createUser(
          data.braceletId,
          `Гость ${data.braceletId}`,
          UserRole.USER,
          activeEvent.id
        );
      }
      res.json(user);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/auth/admin-login", async (req, res) => {
    try {
      const { password } = req.body;
      if (password !== "admin2026" && password !== "manager2026") {
        return res.status(401).json({ message: "Неверный пароль" });
      }

      const role = password === "admin2026" ? UserRole.ADMIN : UserRole.MANAGER;
      const braceletId = password === "admin2026" ? "ADMIN" : "MANAGER";
      const name = password === "admin2026" ? "Администратор" : "Менеджер";

      // Admin/manager need an event context for the FK constraint.
      // Try active event first; if none, create a bootstrap event.
      let activeEvent = await storage.getActiveEvent();
      if (!activeEvent) {
        activeEvent = await storage.createEvent({ name: "Фестиваль", description: "" });
        await storage.activateEvent(activeEvent.id);
      }

      let user = await storage.getUserByBracelet(braceletId, activeEvent.id);
      if (!user) {
        user = await storage.createUser(braceletId, name, role, activeEvent.id);
      }
      res.json(user);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/auth/user/:id", async (req, res) => {
    const user = await storage.getUser(req.params.id);
    if (!user) return res.status(404).json({ message: "Пользователь не найден" });
    res.json(user);
  });

  // ====== EVENTS ======
  app.get("/api/events", async (_req, res) => {
    const events = await storage.getEvents();
    res.json(events);
  });

  app.get("/api/events/active", async (_req, res) => {
    const active = await storage.getActiveEvent();
    res.json(active || null);
  });

  app.get("/api/events/:id", async (req, res) => {
    const event = await storage.getEvent(req.params.id);
    if (!event) return res.status(404).json({ message: "Событие не найдено" });
    res.json(event);
  });

  app.post("/api/events", async (req, res) => {
    try {
      const data = insertEventSchema.parse(req.body);
      const event = await storage.createEvent(data);
      res.status(201).json(event);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/events/:id", async (req, res) => {
    const event = await storage.updateEvent(req.params.id, req.body);
    if (!event) return res.status(404).json({ message: "Событие не найдено" });
    res.json(event);
  });

  app.post("/api/events/:id/activate", async (req, res) => {
    const event = await storage.activateEvent(req.params.id);
    if (!event) return res.status(404).json({ message: "Событие не найдено" });
    res.json(event);
  });

  app.post("/api/events/:id/deactivate", async (req, res) => {
    const event = await storage.updateEvent(req.params.id, { isActive: false });
    if (!event) return res.status(404).json({ message: "Событие не найдено" });
    res.json(event);
  });

  app.delete("/api/events/:id", async (req, res) => {
    const ok = await storage.deleteEvent(req.params.id);
    if (!ok) return res.status(404).json({ message: "Событие не найдено" });
    res.json({ success: true });
  });

  // ====== TABLES ======
  app.get("/api/events/:eventId/tables", async (req, res) => {
    const tables = await storage.getTables(req.params.eventId);
    const tablesWithQueue = await Promise.all(
      tables.map(async (t) => {
        const queue = await storage.getActiveQueueForTableWithPlaying(t.id);
        return { ...t, queueLength: queue.length, queue };
      })
    );
    res.json(tablesWithQueue);
  });

  app.get("/api/tables/:id", async (req, res) => {
    const table = await storage.getTable(req.params.id);
    if (!table) return res.status(404).json({ message: "Стол не найден" });
    const queue = await storage.getActiveQueueForTableWithPlaying(table.id);
    res.json({ ...table, queueLength: queue.length, queue });
  });

  app.post("/api/tables", async (req, res) => {
    try {
      const data = insertTableSchema.parse(req.body);
      const table = await storage.createTable(data);
      res.status(201).json(table);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/tables/:id", async (req, res) => {
    const updates: Record<string, unknown> = {};
    if (req.body.tableName !== undefined) updates.tableName = req.body.tableName;
    if (req.body.gameName !== undefined) updates.gameName = req.body.gameName;
    if (req.body.maxParallelGames !== undefined) updates.maxParallelGames = Number(req.body.maxParallelGames);
    if (req.body.status !== undefined) updates.status = req.body.status;
    if (req.body.currentSessionStart !== undefined) updates.currentSessionStart = req.body.currentSessionStart;

    const table = await storage.updateTable(req.params.id, updates as any);
    if (!table) return res.status(404).json({ message: "Стол не найден" });
    res.json(table);
  });

  app.delete("/api/tables/:id", async (req, res) => {
    const ok = await storage.deleteTable(req.params.id);
    if (!ok) return res.status(404).json({ message: "Стол не найден" });
    res.json({ success: true });
  });

  // ====== QUEUE ======
  app.get("/api/tables/:tableId/queue", async (req, res) => {
    const queue = await storage.getActiveQueueForTableWithPlaying(req.params.tableId);
    const enriched = await Promise.all(
      queue.map(async (e) => {
        const user = await storage.getUser(e.userId);
        return { ...e, userName: user?.name, braceletId: user?.braceletId };
      })
    );
    res.json(enriched);
  });

  app.get("/api/users/:userId/queues", async (req, res) => {
    const queues = await storage.getUserQueues(req.params.userId);
    res.json(queues);
  });

  // Check if user has Telegram subscription
  app.get("/api/users/:userId/subscription", async (req, res) => {
    const sub = await storage.getSubscriptionByUserId(req.params.userId);
    res.json(sub || null);
  });

  app.post("/api/queue/join", async (req, res) => {
    try {
      const data = joinQueueSchema.parse(req.body);
      const user = await storage.getUser(data.userId);
      if (!user) return res.status(404).json({ message: "Пользователь не найден" });

      const table = await storage.getTable(data.tableId);
      if (!table) return res.status(404).json({ message: "Стол не найден" });

      const alreadyInQueue = await storage.isUserInQueue(data.userId, data.tableId);
      if (alreadyInQueue)
        return res.status(400).json({ message: "Вы уже в очереди на этот стол" });

      const entry = await storage.addToQueue(data.tableId, data.userId, table.eventId);

      // If table has available slots and this is first in queue, notify immediately
      const allQueue = await storage.getActiveQueueForTableWithPlaying(data.tableId);
      const playingCount = allQueue.filter((e) => e.status === QueueEntryStatus.PLAYING).length;
      const notifiedCount = allQueue.filter((e) => e.status === QueueEntryStatus.NOTIFIED).length;
      const confirmedCount = allQueue.filter((e) => e.status === QueueEntryStatus.CONFIRMED).length;
      const maxSlots = table.maxParallelGames || 1;
      const hasAvailableSlot = (playingCount + notifiedCount + confirmedCount) < maxSlots;

      if (hasAvailableSlot && entry.position === 1) {
        await notifyNextInQueue(data.tableId);
      }

      res.status(201).json(entry);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/queue/:entryId/confirm", async (req, res) => {
    try {
      const entry = await storage.getQueueEntry(req.params.entryId);
      if (!entry) return res.status(404).json({ message: "Запись не найдена" });

      if (entry.status !== QueueEntryStatus.NOTIFIED) {
        return res.status(400).json({ message: "Подтверждение невозможно в текущем статусе" });
      }

      const timer = confirmTimers.get(entry.id);
      if (timer) {
        clearTimeout(timer);
        confirmTimers.delete(entry.id);
      }

      const walkDeadline = new Date(Date.now() + WALK_TIMEOUT_MS).toISOString();

      const updated = await storage.updateQueueEntry(entry.id, {
        status: QueueEntryStatus.CONFIRMED,
        confirmedAt: new Date().toISOString(),
        walkDeadline,
      });

      // Start 3-minute walk timer
      startWalkTimer(entry.id, entry.tableId);

      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/queue/:entryId/cancel", async (req, res) => {
    try {
      const entry = await storage.getQueueEntry(req.params.entryId);
      if (!entry) return res.status(404).json({ message: "Запись не найдена" });

      const cTimer = confirmTimers.get(entry.id);
      if (cTimer) {
        clearTimeout(cTimer);
        confirmTimers.delete(entry.id);
      }
      const wTimer = walkTimers.get(entry.id);
      if (wTimer) {
        clearTimeout(wTimer);
        walkTimers.delete(entry.id);
      }

      const ok = await storage.removeFromQueue(entry.id);
      if (!ok) return res.status(400).json({ message: "Не удалось отменить" });

      // Notify next in queue
      await notifyNextInQueue(entry.tableId);

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // User: start own game (confirmed → playing)
  app.post("/api/queue/:entryId/start-playing", async (req, res) => {
    try {
      const entry = await storage.getQueueEntry(req.params.entryId);
      if (!entry) return res.status(404).json({ message: "Запись не найдена" });

      if (entry.status !== QueueEntryStatus.CONFIRMED) {
        return res.status(400).json({ message: "Начать игру можно только из статуса 'подтверждено'" });
      }

      // Clear walk timer
      const wTimer = walkTimers.get(entry.id);
      if (wTimer) {
        clearTimeout(wTimer);
        walkTimers.delete(entry.id);
      }

      await storage.updateQueueEntry(entry.id, {
        status: QueueEntryStatus.PLAYING,
        walkDeadline: null,
      });

      // Update table status to playing
      await storage.updateTable(entry.tableId, {
        status: TableStatus.PLAYING,
        currentSessionStart: new Date().toISOString(),
      });

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // User: finish own game (playing → completed)
  app.post("/api/queue/:entryId/finish-playing", async (req, res) => {
    try {
      const entry = await storage.getQueueEntry(req.params.entryId);
      if (!entry) return res.status(404).json({ message: "Запись не найдена" });

      if (entry.status !== QueueEntryStatus.PLAYING) {
        return res.status(400).json({ message: "Завершить можно только активную партию" });
      }

      await storage.updateQueueEntry(entry.id, {
        status: QueueEntryStatus.COMPLETED,
        completedAt: new Date().toISOString(),
      });

      // Check if anyone else is still playing at this table
      const allQueue = await storage.getActiveQueueForTableWithPlaying(entry.tableId);
      const stillPlaying = allQueue.filter((e) => e.status === QueueEntryStatus.PLAYING).length;
      const stillConfirmed = allQueue.filter((e) => e.status === QueueEntryStatus.CONFIRMED).length;

      if (stillPlaying === 0 && stillConfirmed === 0) {
        await storage.updateTable(entry.tableId, {
          status: TableStatus.FREE,
          currentSessionStart: null,
        });
      }

      // Reposition remaining
      const remaining = await storage.getActiveQueueForTable(entry.tableId);
      for (let i = 0; i < remaining.length; i++) {
        await storage.updateQueueEntry(remaining[i].id, { position: i + 1 });
      }

      // Notify next in queue
      await notifyNextInQueue(entry.tableId);

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Manager: start session (move confirmed → playing, respects maxParallelGames)
  app.post("/api/tables/:tableId/start-session", async (req, res) => {
    try {
      const table = await storage.getTable(req.params.tableId);
      if (!table) return res.status(404).json({ message: "Стол не найден" });

      const maxSlots = table.maxParallelGames || 1;
      const queue = await storage.getActiveQueueForTableWithPlaying(table.id);
      const playingCount = queue.filter((e) => e.status === QueueEntryStatus.PLAYING).length;
      if (playingCount >= maxSlots) {
        return res.status(400).json({ message: `Максимум ${maxSlots} параллельных партий на столе` });
      }

      await storage.updateTable(table.id, {
        status: TableStatus.PLAYING,
        currentSessionStart: new Date().toISOString(),
      });

      const confirmed = queue.find((e) => e.status === QueueEntryStatus.CONFIRMED);
      if (confirmed) {
        // Clear walk timer since manager is starting
        const wTimer = walkTimers.get(confirmed.id);
        if (wTimer) {
          clearTimeout(wTimer);
          walkTimers.delete(confirmed.id);
        }
        await storage.updateQueueEntry(confirmed.id, {
          status: QueueEntryStatus.PLAYING,
          walkDeadline: null,
        });
      }

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Manager: end a specific entry's session
  app.post("/api/queue/:entryId/end-session", async (req, res) => {
    try {
      const entry = await storage.getQueueEntry(req.params.entryId);
      if (!entry) return res.status(404).json({ message: "Запись не найдена" });

      if (entry.status !== QueueEntryStatus.PLAYING) {
        return res.status(400).json({ message: "Эта партия не в статусе 'играет'" });
      }

      await storage.updateQueueEntry(entry.id, {
        status: QueueEntryStatus.COMPLETED,
        completedAt: new Date().toISOString(),
      });

      // Check if anyone else is still playing at this table
      const allQueue = await storage.getActiveQueueForTableWithPlaying(entry.tableId);
      const stillPlaying = allQueue.filter((e) => e.status === QueueEntryStatus.PLAYING).length;
      const stillConfirmed = allQueue.filter((e) => e.status === QueueEntryStatus.CONFIRMED).length;

      if (stillPlaying === 0 && stillConfirmed === 0) {
        await storage.updateTable(entry.tableId, {
          status: TableStatus.FREE,
          currentSessionStart: null,
        });
      }

      // Reposition remaining
      const remaining = await storage.getActiveQueueForTable(entry.tableId);
      for (let i = 0; i < remaining.length; i++) {
        await storage.updateQueueEntry(remaining[i].id, { position: i + 1 });
      }

      // Notify next in queue
      await notifyNextInQueue(entry.tableId);

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Manager: end ALL playing sessions at a table
  app.post("/api/tables/:tableId/end-session", async (req, res) => {
    try {
      const table = await storage.getTable(req.params.tableId);
      if (!table) return res.status(404).json({ message: "Стол не найден" });

      const queue = await storage.getActiveQueueForTableWithPlaying(table.id);
      const playing = queue.filter((e) => e.status === QueueEntryStatus.PLAYING);

      for (const p of playing) {
        await storage.updateQueueEntry(p.id, {
          status: QueueEntryStatus.COMPLETED,
          completedAt: new Date().toISOString(),
        });
      }

      const remainingQueue = await storage.getActiveQueueForTableWithPlaying(table.id);
      const stillPlaying = remainingQueue.filter((e) => e.status === QueueEntryStatus.PLAYING).length;
      const stillConfirmed = remainingQueue.filter((e) => e.status === QueueEntryStatus.CONFIRMED).length;

      if (stillPlaying === 0 && stillConfirmed === 0) {
        await storage.updateTable(table.id, {
          status: TableStatus.FREE,
          currentSessionStart: null,
        });
      }

      // Reposition remaining
      const remaining = await storage.getActiveQueueForTable(table.id);
      for (let i = 0; i < remaining.length; i++) {
        await storage.updateQueueEntry(remaining[i].id, { position: i + 1 });
      }

      // Notify next in queue
      await notifyNextInQueue(table.id);

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Manager: force add user to queue (auto-creates user if not found)
  app.post("/api/queue/force-add", async (req, res) => {
    try {
      const { tableId, braceletId } = req.body;
      const table = await storage.getTable(tableId);
      if (!table) return res.status(404).json({ message: "Стол не найден" });
      const eventId = table.eventId;
      let user = await storage.getUserByBracelet(braceletId, eventId);
      if (!user) {
        user = await storage.createUser(braceletId, `Гость ${braceletId}`, UserRole.USER, eventId);
      }
      const alreadyInQueue = await storage.isUserInQueue(user.id, tableId);
      if (alreadyInQueue) return res.status(400).json({ message: "Пользователь уже в очереди" });
      const entry = await storage.addToQueue(tableId, user.id, eventId);

      // Check if table has available slots
      const allQueue = await storage.getActiveQueueForTableWithPlaying(tableId);
      const playingCount = allQueue.filter((e) => e.status === QueueEntryStatus.PLAYING).length;
      const notifiedCount = allQueue.filter((e) => e.status === QueueEntryStatus.NOTIFIED).length;
      const confirmedCount = allQueue.filter((e) => e.status === QueueEntryStatus.CONFIRMED).length;
      const maxSlots = table.maxParallelGames || 1;
      const hasAvailableSlot = (playingCount + notifiedCount + confirmedCount) < maxSlots;

      if (hasAvailableSlot && entry.position === 1) {
        await notifyNextInQueue(tableId);
      }
      res.status(201).json(entry);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Manager: reorder queue
  app.post("/api/tables/:tableId/reorder", async (req, res) => {
    const { entryIds } = req.body;
    if (!Array.isArray(entryIds)) return res.status(400).json({ message: "entryIds required" });
    await storage.reorderQueue(req.params.tableId, entryIds);
    res.json({ success: true });
  });

  // Manager: skip user
  app.post("/api/queue/:entryId/skip", async (req, res) => {
    try {
      const entry = await storage.getQueueEntry(req.params.entryId);
      if (!entry) return res.status(404).json({ message: "Запись не найдена" });

      const cTimer = confirmTimers.get(entry.id);
      if (cTimer) {
        clearTimeout(cTimer);
        confirmTimers.delete(entry.id);
      }
      const wTimer = walkTimers.get(entry.id);
      if (wTimer) {
        clearTimeout(wTimer);
        walkTimers.delete(entry.id);
      }

      await storage.updateQueueEntry(entry.id, {
        status: QueueEntryStatus.SKIPPED,
        completedAt: new Date().toISOString(),
      });

      const active = await storage.getActiveQueueForTable(entry.tableId);
      for (let i = 0; i < active.length; i++) {
        await storage.updateQueueEntry(active[i].id, { position: i + 1 });
      }

      // Notify next
      await notifyNextInQueue(entry.tableId);

      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ====== ANALYTICS ======
  app.get("/api/events/:eventId/analytics", async (req, res) => {
    const analytics = await storage.getAnalytics(req.params.eventId);
    res.json(analytics);
  });

  app.get("/api/events/:eventId/stats", async (req, res) => {
    const stats = await storage.getEventStats(req.params.eventId);
    res.json(stats);
  });

  // ====== QR CODE GENERATION ======
  app.get("/api/tables/:tableId/qr", async (req, res) => {
    const table = await storage.getTable(req.params.tableId);
    if (!table) return res.status(404).json({ message: "Стол не найден" });
    const qrMod = await import("qrcode");
    const QRCode = qrMod.default || qrMod;
    const baseUrl = req.query.baseUrl || `${req.protocol}://${req.get("host")}`;
    const url = `${baseUrl}/join/${table.id}`;
    const svg = await QRCode.toString(url, { type: "svg", width: 300 });
    res.type("image/svg+xml").send(svg);
  });

  app.get("/api/events/:eventId/qr-codes", async (req, res) => {
    const tables = await storage.getTables(req.params.eventId);
    const qrMod = await import("qrcode");
    const QRCode = qrMod.default || qrMod;
    const baseUrl = req.query.baseUrl || `${req.protocol}://${req.get("host")}`;
    const codes = await Promise.all(
      tables.map(async (t) => {
        const url = `${baseUrl}/join/${t.id}`;
        const dataUrl = await QRCode.toDataURL(url, { width: 300, margin: 2 });
        return {
          tableId: t.id,
          tableName: t.tableName,
          gameName: t.gameName,
          qrDataUrl: dataUrl,
          url,
        };
      })
    );
    res.json(codes);
  });

  // ====== TELEGRAM WEBHOOK ======
  // Receives updates from Telegram Bot API
  app.post("/api/telegram/webhook", async (req, res) => {
    try {
      const update = req.body;
      const message = update?.message;
      if (!message?.text) {
        return res.json({ ok: true });
      }

      const chatId = String(message.chat.id);
      const text = message.text.trim();

      // Handle /start with payload: /start user_<userId>
      if (text.startsWith("/start")) {
        const parts = text.split(" ");
        if (parts.length >= 2 && parts[1].startsWith("user_")) {
          const userId = parts[1].replace("user_", "");
          // Verify the user exists
          const user = await storage.getUser(userId);
          if (user) {
            await storage.saveSubscriptionForUser(userId, chatId, "telegram");
            await sendTelegramMessage(
              chatId,
              `✅ <b>Уведомления включены!</b>\n\nВы получите сообщение, когда подойдёт ваша очередь на любой из столов.\n\n🎲 Удачной игры на фестивале!`
            );
          } else {
            await sendTelegramMessage(
              chatId,
              `❌ Пользователь не найден. Попробуйте войти через приложение и нажать кнопку «Telegram».`
            );
          }
        } else {
          await sendTelegramMessage(
            chatId,
            `👋 <b>Добро пожаловать в QueueFest!</b>\n\nЯ уведомлю вас, когда подойдёт ваша очередь на фестивале настольных игр.\n\nЧтобы подписаться, войдите в приложение и нажмите кнопку «Уведомления в Telegram».`
          );
        }
      }

      res.json({ ok: true });
    } catch (e: any) {
      log(`Webhook error: ${e.message}`);
      res.json({ ok: true }); // Always return 200 to Telegram
    }
  });

  // ====== KEEP-ALIVE ======
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // No WebSocket — Supabase Realtime handles real-time updates on the client
  return httpServer;
}
