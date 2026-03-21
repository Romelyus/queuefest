// api/index.ts
import express from "express";
import { createServer } from "http";

// server/routes.ts
import { WebSocketServer, WebSocket } from "ws";

// server/storage.ts
import { randomUUID } from "crypto";

// shared/schema.ts
import { z } from "zod";
var UserRole = {
  USER: "user",
  MANAGER: "manager",
  ADMIN: "admin"
};
var QueueEntryStatus = {
  WAITING: "waiting",
  NOTIFIED: "notified",
  // user was notified it's their turn
  CONFIRMED: "confirmed",
  // user confirmed they're coming
  PLAYING: "playing",
  // currently at the table
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  // user cancelled
  EXPIRED: "expired",
  // user didn't confirm in time
  SKIPPED: "skipped"
  // manager skipped
};
var TableStatus = {
  FREE: "free",
  PLAYING: "playing",
  PAUSED: "paused"
};
var insertEventSchema = z.object({
  name: z.string().min(1, "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E"),
  description: z.string().default("")
});
var insertTableSchema = z.object({
  eventId: z.string().min(1),
  tableName: z.string().min(1, "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0441\u0442\u043E\u043B\u0430 \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E"),
  gameName: z.string().min(1, "\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0438\u0433\u0440\u044B \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E")
});
var loginSchema = z.object({
  braceletId: z.string().min(1, "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 ID \u0431\u0440\u0430\u0441\u043B\u0435\u0442\u0430").regex(/^\d+$/, "ID \u0434\u043E\u043B\u0436\u0435\u043D \u0441\u043E\u0434\u0435\u0440\u0436\u0430\u0442\u044C \u0442\u043E\u043B\u044C\u043A\u043E \u0446\u0438\u0444\u0440\u044B")
});
var joinQueueSchema = z.object({
  tableId: z.string().min(1),
  userId: z.string().min(1)
});

// server/storage.ts
var MemStorage = class {
  events = /* @__PURE__ */ new Map();
  tables = /* @__PURE__ */ new Map();
  users = /* @__PURE__ */ new Map();
  queueEntries = /* @__PURE__ */ new Map();
  // Events
  async getEvents() {
    return Array.from(this.events.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }
  async getEvent(id) {
    return this.events.get(id);
  }
  async getActiveEvent() {
    return Array.from(this.events.values()).find((e) => e.isActive);
  }
  async createEvent(data) {
    const event = {
      id: randomUUID(),
      ...data,
      isActive: false,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.events.set(event.id, event);
    return event;
  }
  async updateEvent(id, data) {
    const event = this.events.get(id);
    if (!event) return void 0;
    const updated = { ...event, ...data };
    this.events.set(id, updated);
    return updated;
  }
  async activateEvent(id) {
    const event = this.events.get(id);
    if (!event) return void 0;
    for (const [eid, ev] of this.events) {
      if (ev.isActive && eid !== id) {
        this.events.set(eid, { ...ev, isActive: false });
      }
    }
    const updated = { ...event, isActive: true };
    this.events.set(id, updated);
    return updated;
  }
  async deleteEvent(id) {
    return this.events.delete(id);
  }
  // Tables
  async getTables(eventId) {
    return Array.from(this.tables.values()).filter((t) => t.eventId === eventId);
  }
  async getTable(id) {
    return this.tables.get(id);
  }
  async createTable(data) {
    const id = randomUUID();
    const table = {
      id,
      ...data,
      status: TableStatus.FREE,
      currentSessionStart: null,
      qrCode: `/join/${id}`
    };
    this.tables.set(id, table);
    return table;
  }
  async updateTable(id, data) {
    const table = this.tables.get(id);
    if (!table) return void 0;
    const updated = { ...table, ...data };
    this.tables.set(id, updated);
    return updated;
  }
  async deleteTable(id) {
    return this.tables.delete(id);
  }
  // Users
  async getUser(id) {
    return this.users.get(id);
  }
  async getUserByBracelet(braceletId, eventId) {
    return Array.from(this.users.values()).find(
      (u) => u.braceletId === braceletId && u.eventId === eventId
    );
  }
  async createUser(braceletId, name, role, eventId) {
    const user = {
      id: randomUUID(),
      braceletId,
      name,
      role,
      eventId,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.users.set(user.id, user);
    return user;
  }
  async getUsers(eventId) {
    return Array.from(this.users.values()).filter((u) => u.eventId === eventId);
  }
  // Queue
  async getQueueForTable(tableId) {
    return Array.from(this.queueEntries.values()).filter((e) => e.tableId === tableId).sort((a, b) => a.position - b.position);
  }
  async getActiveQueueForTable(tableId) {
    const activeStatuses = [
      QueueEntryStatus.WAITING,
      QueueEntryStatus.NOTIFIED,
      QueueEntryStatus.CONFIRMED
    ];
    return Array.from(this.queueEntries.values()).filter((e) => e.tableId === tableId && activeStatuses.includes(e.status)).sort((a, b) => a.position - b.position);
  }
  async getUserQueues(userId) {
    const activeStatuses = [
      QueueEntryStatus.WAITING,
      QueueEntryStatus.NOTIFIED,
      QueueEntryStatus.CONFIRMED,
      QueueEntryStatus.PLAYING
    ];
    const entries = Array.from(this.queueEntries.values()).filter((e) => e.userId === userId && activeStatuses.includes(e.status)).sort((a, b) => new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime());
    return entries.map((e) => ({ ...e, table: this.tables.get(e.tableId) }));
  }
  async addToQueue(tableId, userId, eventId) {
    const existing = await this.getActiveQueueForTable(tableId);
    const position = existing.length + 1;
    const entry = {
      id: randomUUID(),
      tableId,
      userId,
      eventId,
      position,
      status: QueueEntryStatus.WAITING,
      joinedAt: (/* @__PURE__ */ new Date()).toISOString(),
      notifiedAt: null,
      confirmedAt: null,
      completedAt: null,
      confirmDeadline: null
    };
    this.queueEntries.set(entry.id, entry);
    return entry;
  }
  async removeFromQueue(entryId) {
    const entry = this.queueEntries.get(entryId);
    if (!entry) return false;
    entry.status = QueueEntryStatus.CANCELLED;
    entry.completedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.queueEntries.set(entryId, entry);
    const active = await this.getActiveQueueForTable(entry.tableId);
    active.forEach((e, i) => {
      e.position = i + 1;
      this.queueEntries.set(e.id, e);
    });
    return true;
  }
  async updateQueueEntry(id, data) {
    const entry = this.queueEntries.get(id);
    if (!entry) return void 0;
    const updated = { ...entry, ...data };
    this.queueEntries.set(id, updated);
    return updated;
  }
  async getQueueEntry(id) {
    return this.queueEntries.get(id);
  }
  async isUserInQueue(userId, tableId) {
    const activeStatuses = [
      QueueEntryStatus.WAITING,
      QueueEntryStatus.NOTIFIED,
      QueueEntryStatus.CONFIRMED,
      QueueEntryStatus.PLAYING
    ];
    return Array.from(this.queueEntries.values()).some(
      (e) => e.userId === userId && e.tableId === tableId && activeStatuses.includes(e.status)
    );
  }
  async reorderQueue(tableId, entryIds) {
    entryIds.forEach((id, index) => {
      const entry = this.queueEntries.get(id);
      if (entry && entry.tableId === tableId) {
        entry.position = index + 1;
        this.queueEntries.set(id, entry);
      }
    });
  }
  async getNextInQueue(tableId) {
    const active = await this.getActiveQueueForTable(tableId);
    return active.find((e) => e.status === QueueEntryStatus.WAITING);
  }
  // Analytics
  async getAnalytics(eventId) {
    const tables = await this.getTables(eventId);
    return tables.map((table) => {
      const entries = Array.from(this.queueEntries.values()).filter(
        (e) => e.tableId === table.id
      );
      const completed = entries.filter((e) => e.status === QueueEntryStatus.COMPLETED);
      const cancelled = entries.filter((e) => e.status === QueueEntryStatus.CANCELLED);
      const expired = entries.filter((e) => e.status === QueueEntryStatus.EXPIRED);
      const skipped = entries.filter((e) => e.status === QueueEntryStatus.SKIPPED);
      const waitTimes = completed.filter((e) => e.confirmedAt && e.joinedAt).map((e) => (new Date(e.confirmedAt).getTime() - new Date(e.joinedAt).getTime()) / 6e4);
      const sessionTimes = completed.filter((e) => e.completedAt && e.confirmedAt).map((e) => (new Date(e.completedAt).getTime() - new Date(e.confirmedAt).getTime()) / 6e4);
      return {
        tableId: table.id,
        tableName: table.tableName,
        gameName: table.gameName,
        totalEntries: entries.length,
        completedEntries: completed.length,
        cancelledEntries: cancelled.length,
        expiredEntries: expired.length,
        skippedEntries: skipped.length,
        avgWaitMinutes: waitTimes.length ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length) : 0,
        avgSessionMinutes: sessionTimes.length ? Math.round(sessionTimes.reduce((a, b) => a + b, 0) / sessionTimes.length) : 0,
        peakQueueSize: entries.length
        // simplified
      };
    });
  }
  async getEventStats(eventId) {
    const users = await this.getUsers(eventId);
    const allEntries = Array.from(this.queueEntries.values()).filter(
      (e) => e.eventId === eventId
    );
    const activeStatuses = [
      QueueEntryStatus.WAITING,
      QueueEntryStatus.NOTIFIED,
      QueueEntryStatus.CONFIRMED
    ];
    const active = allEntries.filter((e) => activeStatuses.includes(e.status));
    const completedEntries = allEntries.filter(
      (e) => e.status === QueueEntryStatus.COMPLETED && e.confirmedAt
    );
    const waitTimes = completedEntries.map(
      (e) => (new Date(e.confirmedAt).getTime() - new Date(e.joinedAt).getTime()) / 6e4
    );
    return {
      totalVisitors: users.filter((u) => u.role === "user").length,
      totalQueueEntries: allEntries.length,
      activeQueues: active.length,
      avgWaitTime: waitTimes.length ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length) : 0
    };
  }
};
var storage = new MemStorage();

// server/log.ts
function log(message, source = "express") {
  const formattedTime = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}

// server/routes.ts
var wsClients = /* @__PURE__ */ new Map();
function broadcastToUser(userId, message) {
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
function broadcastToTable(tableId, message) {
  storage.getQueueForTable(tableId).then((entries) => {
    entries.forEach((entry) => {
      broadcastToUser(entry.userId, message);
    });
  });
}
var CONFIRM_TIMEOUT_MS = 3 * 60 * 1e3;
var confirmTimers = /* @__PURE__ */ new Map();
async function notifyNextInQueue(tableId) {
  const next = await storage.getNextInQueue(tableId);
  if (!next) return;
  const deadline = new Date(Date.now() + CONFIRM_TIMEOUT_MS).toISOString();
  await storage.updateQueueEntry(next.id, {
    status: QueueEntryStatus.NOTIFIED,
    notifiedAt: (/* @__PURE__ */ new Date()).toISOString(),
    confirmDeadline: deadline
  });
  broadcastToUser(next.userId, {
    type: "your_turn",
    payload: { entryId: next.id, tableId, deadline },
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
  const timer = setTimeout(async () => {
    const entry = await storage.getQueueEntry(next.id);
    if (entry && entry.status === QueueEntryStatus.NOTIFIED) {
      await storage.updateQueueEntry(next.id, {
        status: QueueEntryStatus.EXPIRED,
        completedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      broadcastToUser(next.userId, {
        type: "confirm_timeout",
        payload: { entryId: next.id, tableId },
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      const active = await storage.getActiveQueueForTable(tableId);
      active.forEach((e, i) => {
        storage.updateQueueEntry(e.id, { position: i + 1 });
      });
      await notifyNextInQueue(tableId);
      broadcastToTable(tableId, {
        type: "queue_updated",
        payload: { tableId },
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    confirmTimers.delete(next.id);
  }, CONFIRM_TIMEOUT_MS);
  confirmTimers.set(next.id, timer);
}
async function registerRoutes(httpServer2, app2) {
  app2.post("/api/auth/login", async (req, res) => {
    try {
      const data = loginSchema.parse(req.body);
      const activeEvent = await storage.getActiveEvent();
      if (!activeEvent) {
        return res.status(400).json({ message: "\u041D\u0435\u0442 \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0433\u043E \u0441\u043E\u0431\u044B\u0442\u0438\u044F. \u041E\u0431\u0440\u0430\u0442\u0438\u0442\u0435\u0441\u044C \u043A \u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440\u0443." });
      }
      let user = await storage.getUserByBracelet(data.braceletId, activeEvent.id);
      if (!user) {
        user = await storage.createUser(
          data.braceletId,
          `\u0413\u043E\u0441\u0442\u044C ${data.braceletId}`,
          UserRole.USER,
          activeEvent.id
        );
      }
      res.json(user);
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  });
  app2.post("/api/auth/admin-login", async (req, res) => {
    const { password } = req.body;
    const activeEvent = await storage.getActiveEvent();
    const eventId = activeEvent?.id || "global";
    if (password === "admin2026") {
      let user = await storage.getUserByBracelet("ADMIN", eventId);
      if (!user) {
        user = await storage.createUser("ADMIN", "\u0410\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440", UserRole.ADMIN, eventId);
      }
      res.json(user);
    } else if (password === "manager2026") {
      let user = await storage.getUserByBracelet("MANAGER", eventId);
      if (!user) {
        user = await storage.createUser("MANAGER", "\u041C\u0435\u043D\u0435\u0434\u0436\u0435\u0440", UserRole.MANAGER, eventId);
      }
      res.json(user);
    } else {
      res.status(401).json({ message: "\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u043F\u0430\u0440\u043E\u043B\u044C" });
    }
  });
  app2.get("/api/auth/user/:id", async (req, res) => {
    const user = await storage.getUser(req.params.id);
    if (!user) return res.status(404).json({ message: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D" });
    res.json(user);
  });
  app2.get("/api/events", async (_req, res) => {
    const events = await storage.getEvents();
    res.json(events);
  });
  app2.get("/api/events/active", async (_req, res) => {
    const active = await storage.getActiveEvent();
    res.json(active || null);
  });
  app2.get("/api/events/:id", async (req, res) => {
    const event = await storage.getEvent(req.params.id);
    if (!event) return res.status(404).json({ message: "\u0421\u043E\u0431\u044B\u0442\u0438\u0435 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E" });
    res.json(event);
  });
  app2.post("/api/events", async (req, res) => {
    try {
      const data = insertEventSchema.parse(req.body);
      const event = await storage.createEvent(data);
      res.status(201).json(event);
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  });
  app2.patch("/api/events/:id", async (req, res) => {
    const event = await storage.updateEvent(req.params.id, req.body);
    if (!event) return res.status(404).json({ message: "\u0421\u043E\u0431\u044B\u0442\u0438\u0435 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E" });
    res.json(event);
  });
  app2.post("/api/events/:id/activate", async (req, res) => {
    const event = await storage.activateEvent(req.params.id);
    if (!event) return res.status(404).json({ message: "\u0421\u043E\u0431\u044B\u0442\u0438\u0435 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E" });
    res.json(event);
  });
  app2.post("/api/events/:id/deactivate", async (req, res) => {
    const event = await storage.updateEvent(req.params.id, { isActive: false });
    if (!event) return res.status(404).json({ message: "\u0421\u043E\u0431\u044B\u0442\u0438\u0435 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E" });
    res.json(event);
  });
  app2.delete("/api/events/:id", async (req, res) => {
    const ok = await storage.deleteEvent(req.params.id);
    if (!ok) return res.status(404).json({ message: "\u0421\u043E\u0431\u044B\u0442\u0438\u0435 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E" });
    res.json({ success: true });
  });
  app2.get("/api/events/:eventId/tables", async (req, res) => {
    const tables = await storage.getTables(req.params.eventId);
    const tablesWithQueue = await Promise.all(
      tables.map(async (t) => {
        const queue = await storage.getActiveQueueForTable(t.id);
        return { ...t, queueLength: queue.length, queue };
      })
    );
    res.json(tablesWithQueue);
  });
  app2.get("/api/tables/:id", async (req, res) => {
    const table = await storage.getTable(req.params.id);
    if (!table) return res.status(404).json({ message: "\u0421\u0442\u043E\u043B \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D" });
    const queue = await storage.getActiveQueueForTable(table.id);
    res.json({ ...table, queueLength: queue.length, queue });
  });
  app2.post("/api/tables", async (req, res) => {
    try {
      const data = insertTableSchema.parse(req.body);
      const table = await storage.createTable(data);
      res.status(201).json(table);
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  });
  app2.patch("/api/tables/:id", async (req, res) => {
    const table = await storage.updateTable(req.params.id, req.body);
    if (!table) return res.status(404).json({ message: "\u0421\u0442\u043E\u043B \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D" });
    broadcastToTable(table.id, {
      type: "table_status_changed",
      payload: { tableId: table.id, status: table.status },
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    res.json(table);
  });
  app2.delete("/api/tables/:id", async (req, res) => {
    const ok = await storage.deleteTable(req.params.id);
    if (!ok) return res.status(404).json({ message: "\u0421\u0442\u043E\u043B \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D" });
    res.json({ success: true });
  });
  app2.get("/api/tables/:tableId/queue", async (req, res) => {
    const queue = await storage.getActiveQueueForTable(req.params.tableId);
    const enriched = await Promise.all(
      queue.map(async (e) => {
        const user = await storage.getUser(e.userId);
        return { ...e, userName: user?.name, braceletId: user?.braceletId };
      })
    );
    res.json(enriched);
  });
  app2.get("/api/users/:userId/queues", async (req, res) => {
    const queues = await storage.getUserQueues(req.params.userId);
    res.json(queues);
  });
  app2.post("/api/queue/join", async (req, res) => {
    try {
      const data = joinQueueSchema.parse(req.body);
      const user = await storage.getUser(data.userId);
      if (!user) return res.status(404).json({ message: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D" });
      const table = await storage.getTable(data.tableId);
      if (!table) return res.status(404).json({ message: "\u0421\u0442\u043E\u043B \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D" });
      const alreadyInQueue = await storage.isUserInQueue(data.userId, data.tableId);
      if (alreadyInQueue)
        return res.status(400).json({ message: "\u0412\u044B \u0443\u0436\u0435 \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u0438 \u043D\u0430 \u044D\u0442\u043E\u0442 \u0441\u0442\u043E\u043B" });
      const entry = await storage.addToQueue(data.tableId, data.userId, table.eventId);
      broadcastToTable(data.tableId, {
        type: "queue_updated",
        payload: { tableId: data.tableId },
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      if (table.status === TableStatus.FREE && entry.position === 1) {
        await notifyNextInQueue(data.tableId);
      }
      res.status(201).json(entry);
    } catch (e) {
      res.status(400).json({ message: e.message });
    }
  });
  app2.post("/api/queue/:entryId/confirm", async (req, res) => {
    const entry = await storage.getQueueEntry(req.params.entryId);
    if (!entry) return res.status(404).json({ message: "\u0417\u0430\u043F\u0438\u0441\u044C \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430" });
    if (entry.status !== QueueEntryStatus.NOTIFIED) {
      return res.status(400).json({ message: "\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u0435 \u043D\u0435\u0432\u043E\u0437\u043C\u043E\u0436\u043D\u043E \u0432 \u0442\u0435\u043A\u0443\u0449\u0435\u043C \u0441\u0442\u0430\u0442\u0443\u0441\u0435" });
    }
    const timer = confirmTimers.get(entry.id);
    if (timer) {
      clearTimeout(timer);
      confirmTimers.delete(entry.id);
    }
    const updated = await storage.updateQueueEntry(entry.id, {
      status: QueueEntryStatus.CONFIRMED,
      confirmedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    broadcastToUser(entry.userId, {
      type: "queue_updated",
      payload: { entryId: entry.id, status: QueueEntryStatus.CONFIRMED },
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    res.json(updated);
  });
  app2.post("/api/queue/:entryId/cancel", async (req, res) => {
    const entry = await storage.getQueueEntry(req.params.entryId);
    if (!entry) return res.status(404).json({ message: "\u0417\u0430\u043F\u0438\u0441\u044C \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430" });
    const timer = confirmTimers.get(entry.id);
    if (timer) {
      clearTimeout(timer);
      confirmTimers.delete(entry.id);
    }
    const ok = await storage.removeFromQueue(entry.id);
    if (!ok) return res.status(400).json({ message: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0442\u043C\u0435\u043D\u0438\u0442\u044C" });
    broadcastToUser(entry.userId, {
      type: "removed_from_queue",
      payload: { entryId: entry.id, tableId: entry.tableId },
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    broadcastToTable(entry.tableId, {
      type: "queue_updated",
      payload: { tableId: entry.tableId },
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    res.json({ success: true });
  });
  app2.post("/api/tables/:tableId/start-session", async (req, res) => {
    const table = await storage.getTable(req.params.tableId);
    if (!table) return res.status(404).json({ message: "\u0421\u0442\u043E\u043B \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D" });
    const queue = await storage.getActiveQueueForTable(table.id);
    const playingCount = queue.filter((e) => e.status === QueueEntryStatus.PLAYING).length;
    if (playingCount >= 2) {
      return res.status(400).json({ message: "\u041C\u0430\u043A\u0441\u0438\u043C\u0443\u043C 2 \u043F\u0430\u0440\u0430\u043B\u043B\u0435\u043B\u044C\u043D\u044B\u0445 \u043F\u0430\u0440\u0442\u0438\u0438 \u043D\u0430 \u0441\u0442\u043E\u043B\u0435" });
    }
    await storage.updateTable(table.id, {
      status: TableStatus.PLAYING,
      currentSessionStart: (/* @__PURE__ */ new Date()).toISOString()
    });
    const confirmed = queue.find((e) => e.status === QueueEntryStatus.CONFIRMED);
    if (confirmed) {
      await storage.updateQueueEntry(confirmed.id, {
        status: QueueEntryStatus.PLAYING
      });
    }
    broadcastToTable(table.id, {
      type: "session_started",
      payload: { tableId: table.id },
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    res.json({ success: true });
  });
  app2.post("/api/tables/:tableId/end-session", async (req, res) => {
    const table = await storage.getTable(req.params.tableId);
    if (!table) return res.status(404).json({ message: "\u0421\u0442\u043E\u043B \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D" });
    const queue = await storage.getActiveQueueForTable(table.id);
    const playing = queue.filter((e) => e.status === QueueEntryStatus.PLAYING);
    for (const p of playing) {
      await storage.updateQueueEntry(p.id, {
        status: QueueEntryStatus.COMPLETED,
        completedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    const remainingQueue = await storage.getActiveQueueForTable(table.id);
    const stillPlaying = remainingQueue.filter((e) => e.status === QueueEntryStatus.PLAYING).length;
    if (stillPlaying === 0) {
      await storage.updateTable(table.id, {
        status: TableStatus.FREE,
        currentSessionStart: null
      });
    }
    const remaining = await storage.getActiveQueueForTable(table.id);
    remaining.forEach((e, i) => {
      storage.updateQueueEntry(e.id, { position: i + 1 });
    });
    broadcastToTable(table.id, {
      type: "session_ended",
      payload: { tableId: table.id },
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    await notifyNextInQueue(table.id);
    broadcastToTable(table.id, {
      type: "queue_updated",
      payload: { tableId: table.id },
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    res.json({ success: true });
  });
  app2.post("/api/queue/force-add", async (req, res) => {
    const { tableId, braceletId } = req.body;
    const table = await storage.getTable(tableId);
    if (!table) return res.status(404).json({ message: "\u0421\u0442\u043E\u043B \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D" });
    const eventId = table.eventId;
    let user = await storage.getUserByBracelet(braceletId, eventId);
    if (!user) {
      user = await storage.createUser(braceletId, `\u0413\u043E\u0441\u0442\u044C ${braceletId}`, UserRole.USER, eventId);
    }
    const alreadyInQueue = await storage.isUserInQueue(user.id, tableId);
    if (alreadyInQueue) return res.status(400).json({ message: "\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u0443\u0436\u0435 \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u0438" });
    const entry = await storage.addToQueue(tableId, user.id, eventId);
    broadcastToTable(tableId, {
      type: "queue_updated",
      payload: { tableId },
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    if (table.status === TableStatus.FREE && entry.position === 1) {
      await notifyNextInQueue(tableId);
    }
    res.status(201).json(entry);
  });
  app2.post("/api/tables/:tableId/reorder", async (req, res) => {
    const { entryIds } = req.body;
    if (!Array.isArray(entryIds)) return res.status(400).json({ message: "entryIds required" });
    await storage.reorderQueue(req.params.tableId, entryIds);
    broadcastToTable(req.params.tableId, {
      type: "queue_updated",
      payload: { tableId: req.params.tableId },
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    res.json({ success: true });
  });
  app2.post("/api/queue/:entryId/skip", async (req, res) => {
    const entry = await storage.getQueueEntry(req.params.entryId);
    if (!entry) return res.status(404).json({ message: "\u0417\u0430\u043F\u0438\u0441\u044C \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430" });
    const timer = confirmTimers.get(entry.id);
    if (timer) {
      clearTimeout(timer);
      confirmTimers.delete(entry.id);
    }
    await storage.updateQueueEntry(entry.id, {
      status: QueueEntryStatus.SKIPPED,
      completedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    const active = await storage.getActiveQueueForTable(entry.tableId);
    active.forEach((e, i) => {
      storage.updateQueueEntry(e.id, { position: i + 1 });
    });
    broadcastToUser(entry.userId, {
      type: "removed_from_queue",
      payload: { entryId: entry.id, tableId: entry.tableId, reason: "skipped" },
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    broadcastToTable(entry.tableId, {
      type: "queue_updated",
      payload: { tableId: entry.tableId },
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    res.json({ success: true });
  });
  app2.get("/api/events/:eventId/analytics", async (req, res) => {
    const analytics = await storage.getAnalytics(req.params.eventId);
    res.json(analytics);
  });
  app2.get("/api/events/:eventId/stats", async (req, res) => {
    const stats = await storage.getEventStats(req.params.eventId);
    res.json(stats);
  });
  app2.get("/api/tables/:tableId/qr", async (req, res) => {
    const table = await storage.getTable(req.params.tableId);
    if (!table) return res.status(404).json({ message: "\u0421\u0442\u043E\u043B \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D" });
    const qrMod = await import("qrcode");
    const QRCode = qrMod.default || qrMod;
    const baseUrl = req.query.baseUrl || `${req.protocol}://${req.get("host")}`;
    const url = `${baseUrl}/join/${table.id}`;
    const svg = await QRCode.toString(url, { type: "svg", width: 300 });
    res.type("image/svg+xml").send(svg);
  });
  app2.get("/api/events/:eventId/qr-codes", async (req, res) => {
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
          url
        };
      })
    );
    res.json(codes);
  });
  app2.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  });
  const wss = new WebSocketServer({ server: httpServer2, path: "/ws" });
  wss.on("connection", (ws, req) => {
    let userId = null;
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "auth" && msg.userId) {
          userId = msg.userId;
          if (!wsClients.has(userId)) {
            wsClients.set(userId, /* @__PURE__ */ new Set());
          }
          wsClients.get(userId).add(ws);
          log(`WS client connected: ${userId}`);
        }
      } catch (e) {
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
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 3e4);
    ws.on("close", () => clearInterval(pingInterval));
  });
  return httpServer2;
}

// api/index.ts
var app = express();
var httpServer = createServer(app);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
await registerRoutes(httpServer, app);
app.use((err, _req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || "Internal Server Error";
  console.error("Internal Server Error:", err);
  if (res.headersSent) return next(err);
  return res.status(status).json({ message });
});
var index_default = app;
export {
  index_default as default
};
