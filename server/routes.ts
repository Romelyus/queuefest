import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
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
import type { WSMessage } from "../shared/schema";

// WebSocket connections mapped by userId
const wsClients = new Map<string, Set<WebSocket>>();

function broadcastToUser(userId: string, message: WSMessage) {
  const clients = wsClients.get(userId);
  if (clients) {
    const data = JSON.stringify(message);
    clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
  }
}

function broadcastToTable(tableId: string, message: WSMessage) {
  // Send to all users in queue for this table
  storage.getQueueForTable(tableId).then((entries) => {
    entries.forEach((entry) => {
      broadcastToUser(entry.userId, message);
    });
  });
}

// Confirmation timeout: 3 minutes
const CONFIRM_TIMEOUT_MS = 3 * 60 * 1000;
const confirmTimers = new Map<string, NodeJS.Timeout>();

async function notifyNextInQueue(tableId: string) {
  const next = await storage.getNextInQueue(tableId);
  if (!next) return;

  const deadline = new Date(Date.now() + CONFIRM_TIMEOUT_MS).toISOString();
  await storage.updateQueueEntry(next.id, {
    status: QueueEntryStatus.NOTIFIED,
    notifiedAt: new Date().toISOString(),
    confirmDeadline: deadline,
  });

  broadcastToUser(next.userId, {
    type: "your_turn",
    payload: { entryId: next.id, tableId, deadline },
    timestamp: new Date().toISOString(),
  });

  // Set confirmation timeout
  const timer = setTimeout(async () => {
    const entry = await storage.getQueueEntry(next.id);
    if (entry && entry.status === QueueEntryStatus.NOTIFIED) {
      await storage.updateQueueEntry(next.id, {
        status: QueueEntryStatus.EXPIRED,
        completedAt: new Date().toISOString(),
      });
      broadcastToUser(next.userId, {
        type: "confirm_timeout",
        payload: { entryId: next.id, tableId },
        timestamp: new Date().toISOString(),
      });
      // Reposition remaining and notify next person
      const active = await storage.getActiveQueueForTable(tableId);
      active.forEach((e, i) => {
        storage.updateQueueEntry(e.id, { position: i + 1 });
      });
      await notifyNextInQueue(tableId);
      broadcastToTable(tableId, {
        type: "queue_updated",
        payload: { tableId },
        timestamp: new Date().toISOString(),
      });
    }
    confirmTimers.delete(next.id);
  }, CONFIRM_TIMEOUT_MS);

  confirmTimers.set(next.id, timer);
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
    const { password } = req.body;
    const activeEvent = await storage.getActiveEvent();
    const eventId = activeEvent?.id || "global";
    if (password === "admin2026") {
      let user = await storage.getUserByBracelet("ADMIN", eventId);
      if (!user) {
        user = await storage.createUser("ADMIN", "Администратор", UserRole.ADMIN, eventId);
      }
      res.json(user);
    } else if (password === "manager2026") {
      let user = await storage.getUserByBracelet("MANAGER", eventId);
      if (!user) {
        user = await storage.createUser("MANAGER", "Менеджер", UserRole.MANAGER, eventId);
      }
      res.json(user);
    } else {
      res.status(401).json({ message: "Неверный пароль" });
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

  // Activate an event (deactivates all others)
  app.post("/api/events/:id/activate", async (req, res) => {
    const event = await storage.activateEvent(req.params.id);
    if (!event) return res.status(404).json({ message: "Событие не найдено" });
    res.json(event);
  });

  // Deactivate an event
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
    // Attach queue info
    const tablesWithQueue = await Promise.all(
      tables.map(async (t) => {
        const queue = await storage.getActiveQueueForTable(t.id);
        return { ...t, queueLength: queue.length, queue };
      })
    );
    res.json(tablesWithQueue);
  });

  app.get("/api/tables/:id", async (req, res) => {
    const table = await storage.getTable(req.params.id);
    if (!table) return res.status(404).json({ message: "Стол не найден" });
    const queue = await storage.getActiveQueueForTable(table.id);
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
    const table = await storage.updateTable(req.params.id, req.body);
    if (!table) return res.status(404).json({ message: "Стол не найден" });
    // Broadcast table status change
    broadcastToTable(table.id, {
      type: "table_status_changed",
      payload: { tableId: table.id, status: table.status },
      timestamp: new Date().toISOString(),
    });
    res.json(table);
  });

  app.delete("/api/tables/:id", async (req, res) => {
    const ok = await storage.deleteTable(req.params.id);
    if (!ok) return res.status(404).json({ message: "Стол не найден" });
    res.json({ success: true });
  });

  // ====== QUEUE ======
  app.get("/api/tables/:tableId/queue", async (req, res) => {
    const queue = await storage.getActiveQueueForTable(req.params.tableId);
    // Enrich with user names
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

  app.post("/api/queue/join", async (req, res) => {
    try {
      const data = joinQueueSchema.parse(req.body);
      // Check if user exists
      const user = await storage.getUser(data.userId);
      if (!user) return res.status(404).json({ message: "Пользователь не найден" });

      // Check if table exists
      const table = await storage.getTable(data.tableId);
      if (!table) return res.status(404).json({ message: "Стол не найден" });

      // Check if already in queue
      const alreadyInQueue = await storage.isUserInQueue(data.userId, data.tableId);
      if (alreadyInQueue)
        return res.status(400).json({ message: "Вы уже в очереди на этот стол" });

      const entry = await storage.addToQueue(data.tableId, data.userId, table.eventId);

      // Broadcast queue update
      broadcastToTable(data.tableId, {
        type: "queue_updated",
        payload: { tableId: data.tableId },
        timestamp: new Date().toISOString(),
      });

      // If table is free and this is first in queue, notify immediately
      if (table.status === TableStatus.FREE && entry.position === 1) {
        await notifyNextInQueue(data.tableId);
      }

      res.status(201).json(entry);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/queue/:entryId/confirm", async (req, res) => {
    const entry = await storage.getQueueEntry(req.params.entryId);
    if (!entry) return res.status(404).json({ message: "Запись не найдена" });

    if (entry.status !== QueueEntryStatus.NOTIFIED) {
      return res.status(400).json({ message: "Подтверждение невозможно в текущем статусе" });
    }

    // Clear timeout
    const timer = confirmTimers.get(entry.id);
    if (timer) {
      clearTimeout(timer);
      confirmTimers.delete(entry.id);
    }

    const updated = await storage.updateQueueEntry(entry.id, {
      status: QueueEntryStatus.CONFIRMED,
      confirmedAt: new Date().toISOString(),
    });

    broadcastToUser(entry.userId, {
      type: "queue_updated",
      payload: { entryId: entry.id, status: QueueEntryStatus.CONFIRMED },
      timestamp: new Date().toISOString(),
    });

    res.json(updated);
  });

  app.post("/api/queue/:entryId/cancel", async (req, res) => {
    const entry = await storage.getQueueEntry(req.params.entryId);
    if (!entry) return res.status(404).json({ message: "Запись не найдена" });

    // Clear any pending timeout
    const timer = confirmTimers.get(entry.id);
    if (timer) {
      clearTimeout(timer);
      confirmTimers.delete(entry.id);
    }

    const ok = await storage.removeFromQueue(entry.id);
    if (!ok) return res.status(400).json({ message: "Не удалось отменить" });

    broadcastToUser(entry.userId, {
      type: "removed_from_queue",
      payload: { entryId: entry.id, tableId: entry.tableId },
      timestamp: new Date().toISOString(),
    });

    broadcastToTable(entry.tableId, {
      type: "queue_updated",
      payload: { tableId: entry.tableId },
      timestamp: new Date().toISOString(),
    });

    res.json({ success: true });
  });

  // Manager: start session (supports up to 2 parallel games per table)
  app.post("/api/tables/:tableId/start-session", async (req, res) => {
    const table = await storage.getTable(req.params.tableId);
    if (!table) return res.status(404).json({ message: "Стол не найден" });

    // Count current playing entries
    const queue = await storage.getActiveQueueForTable(table.id);
    const playingCount = queue.filter((e) => e.status === QueueEntryStatus.PLAYING).length;
    if (playingCount >= 2) {
      return res.status(400).json({ message: "Максимум 2 параллельных партии на столе" });
    }

    await storage.updateTable(table.id, {
      status: TableStatus.PLAYING,
      currentSessionStart: new Date().toISOString(),
    });

    // Mark confirmed user as playing
    const confirmed = queue.find((e) => e.status === QueueEntryStatus.CONFIRMED);
    if (confirmed) {
      await storage.updateQueueEntry(confirmed.id, {
        status: QueueEntryStatus.PLAYING,
      });
    }

    broadcastToTable(table.id, {
      type: "session_started",
      payload: { tableId: table.id },
      timestamp: new Date().toISOString(),
    });

    res.json({ success: true });
  });

  // Manager: end session (completes all playing entries, table becomes "free" if no more playing)
  app.post("/api/tables/:tableId/end-session", async (req, res) => {
    const table = await storage.getTable(req.params.tableId);
    if (!table) return res.status(404).json({ message: "Стол не найден" });

    // Complete all playing entries
    const queue = await storage.getActiveQueueForTable(table.id);
    const playing = queue.filter((e) => e.status === QueueEntryStatus.PLAYING);
    for (const p of playing) {
      await storage.updateQueueEntry(p.id, {
        status: QueueEntryStatus.COMPLETED,
        completedAt: new Date().toISOString(),
      });
    }

    // Check if any playing entries remain (shouldn't after completing all)
    const remainingQueue = await storage.getActiveQueueForTable(table.id);
    const stillPlaying = remainingQueue.filter((e) => e.status === QueueEntryStatus.PLAYING).length;

    if (stillPlaying === 0) {
      await storage.updateTable(table.id, {
        status: TableStatus.FREE,
        currentSessionStart: null,
      });
    }

    // Reposition remaining
    const remaining = await storage.getActiveQueueForTable(table.id);
    remaining.forEach((e, i) => {
      storage.updateQueueEntry(e.id, { position: i + 1 });
    });

    broadcastToTable(table.id, {
      type: "session_ended",
      payload: { tableId: table.id },
      timestamp: new Date().toISOString(),
    });

    // Notify next in queue
    await notifyNextInQueue(table.id);

    broadcastToTable(table.id, {
      type: "queue_updated",
      payload: { tableId: table.id },
      timestamp: new Date().toISOString(),
    });

    res.json({ success: true });
  });

  // Manager: force add user to queue (auto-creates user if not found)
  app.post("/api/queue/force-add", async (req, res) => {
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
    broadcastToTable(tableId, {
      type: "queue_updated",
      payload: { tableId },
      timestamp: new Date().toISOString(),
    });
    if (table.status === TableStatus.FREE && entry.position === 1) {
      await notifyNextInQueue(tableId);
    }
    res.status(201).json(entry);
  });

  // Manager: reorder queue
  app.post("/api/tables/:tableId/reorder", async (req, res) => {
    const { entryIds } = req.body;
    if (!Array.isArray(entryIds)) return res.status(400).json({ message: "entryIds required" });
    await storage.reorderQueue(req.params.tableId, entryIds);
    broadcastToTable(req.params.tableId, {
      type: "queue_updated",
      payload: { tableId: req.params.tableId },
      timestamp: new Date().toISOString(),
    });
    res.json({ success: true });
  });

  // Manager: skip user (force remove)
  app.post("/api/queue/:entryId/skip", async (req, res) => {
    const entry = await storage.getQueueEntry(req.params.entryId);
    if (!entry) return res.status(404).json({ message: "Запись не найдена" });

    const timer = confirmTimers.get(entry.id);
    if (timer) {
      clearTimeout(timer);
      confirmTimers.delete(entry.id);
    }

    await storage.updateQueueEntry(entry.id, {
      status: QueueEntryStatus.SKIPPED,
      completedAt: new Date().toISOString(),
    });

    // Reposition
    const active = await storage.getActiveQueueForTable(entry.tableId);
    active.forEach((e, i) => {
      storage.updateQueueEntry(e.id, { position: i + 1 });
    });

    broadcastToUser(entry.userId, {
      type: "removed_from_queue",
      payload: { entryId: entry.id, tableId: entry.tableId, reason: "skipped" },
      timestamp: new Date().toISOString(),
    });

    broadcastToTable(entry.tableId, {
      type: "queue_updated",
      payload: { tableId: entry.tableId },
      timestamp: new Date().toISOString(),
    });

    res.json({ success: true });
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

  // Bulk QR generation for printing
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

  // ====== KEEP-ALIVE ======
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // ====== WEBSOCKET ======
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws, req) => {
    let userId: string | null = null;

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "auth" && msg.userId) {
          userId = msg.userId;
          if (!wsClients.has(userId!)) {
            wsClients.set(userId!, new Set());
          }
          wsClients.get(userId!)!.add(ws);
          log(`WS client connected: ${userId}`);
        }
      } catch (e) {
        // ignore
      }
    });

    ws.on("close", () => {
      if (userId) {
        const clients = wsClients.get(userId);
        if (clients) {
          clients.delete(ws);
          if (clients.size === 0) {
            wsClients.delete(userId);
          }
        }
        log(`WS client disconnected: ${userId}`);
      }
    });

    // Keepalive ping
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30000);

    ws.on("close", () => clearInterval(pingInterval));
  });

  return httpServer;
}
