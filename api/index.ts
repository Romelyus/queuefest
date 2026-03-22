// @ts-nocheck
// api/index.ts
import express from "express";
import { createServer } from "http";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
var supabaseUrl = process.env.SUPABASE_URL || "";
var supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!supabaseUrl || !supabaseServiceKey) {
  console.error(
    "\u274C SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set!",
    "SUPABASE_URL length:",
    supabaseUrl.length,
    "KEY length:",
    supabaseServiceKey.length
  );
}
var supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});
var UserRole = {
  USER: "user",
  MANAGER: "manager",
  ADMIN: "admin"
};
var QueueEntryStatus = {
  WAITING: "waiting",
  NOTIFIED: "notified",
  CONFIRMED: "confirmed",
  PLAYING: "playing",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
  SKIPPED: "skipped"
};
var TableStatus = {
  FREE: "free",
  PLAYING: "playing",
  PAUSED: "paused"
};
function toEvent(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isActive: row.is_active,
    createdAt: row.created_at
  };
}
function toUser(row) {
  return {
    id: row.id,
    braceletId: row.bracelet_id,
    name: row.name,
    role: row.role,
    eventId: row.event_id,
    createdAt: row.created_at
  };
}
function toGameTable(row) {
  return {
    id: row.id,
    eventId: row.event_id,
    tableName: row.table_name,
    gameName: row.game_name,
    status: row.status,
    currentSessionStart: row.current_session_start,
    qrCode: row.qr_code
  };
}
function toQueueEntry(row) {
  return {
    id: row.id,
    tableId: row.table_id,
    userId: row.user_id,
    eventId: row.event_id,
    position: row.position,
    status: row.status,
    joinedAt: row.joined_at,
    notifiedAt: row.notified_at,
    confirmedAt: row.confirmed_at,
    completedAt: row.completed_at,
    confirmDeadline: row.confirm_deadline
  };
}
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
var db = supabaseAdmin;
var ACTIVE_STATUSES = [
  QueueEntryStatus.WAITING,
  QueueEntryStatus.NOTIFIED,
  QueueEntryStatus.CONFIRMED
];
var ACTIVE_STATUSES_WITH_PLAYING = [
  ...ACTIVE_STATUSES,
  QueueEntryStatus.PLAYING
];
var SupabaseStorage = class {
  // ============ Events ============
  async getEvents() {
    const { data, error } = await db.from("events").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(toEvent);
  }
  async getEvent(id) {
    const { data, error } = await db.from("events").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? toEvent(data) : void 0;
  }
  async getActiveEvent() {
    const { data, error } = await db.from("events").select("*").eq("is_active", true).maybeSingle();
    if (error) throw error;
    return data ? toEvent(data) : void 0;
  }
  async createEvent(input) {
    const { data, error } = await db.from("events").insert({ name: input.name, description: input.description || "", is_active: false }).select().single();
    if (error) throw error;
    return toEvent(data);
  }
  async updateEvent(id, updates) {
    const dbUpdates = {};
    if (updates.name !== void 0) dbUpdates.name = updates.name;
    if (updates.description !== void 0) dbUpdates.description = updates.description;
    if (updates.isActive !== void 0) dbUpdates.is_active = updates.isActive;
    const { data, error } = await db.from("events").update(dbUpdates).eq("id", id).select().maybeSingle();
    if (error) throw error;
    return data ? toEvent(data) : void 0;
  }
  async activateEvent(id) {
    await db.from("events").update({ is_active: false }).neq("id", id);
    const { data, error } = await db.from("events").update({ is_active: true }).eq("id", id).select().single();
    if (error) throw error;
    return data ? toEvent(data) : void 0;
  }
  async deleteEvent(id) {
    const { error } = await db.from("events").delete().eq("id", id);
    return !error;
  }
  // ============ Tables ============
  async getTables(eventId) {
    const { data, error } = await db.from("game_tables").select("*").eq("event_id", eventId);
    if (error) throw error;
    return (data || []).map(toGameTable);
  }
  async getTable(id) {
    const { data, error } = await db.from("game_tables").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? toGameTable(data) : void 0;
  }
  async createTable(input) {
    const { data, error } = await db.from("game_tables").insert({
      event_id: input.eventId,
      table_name: input.tableName,
      game_name: input.gameName,
      status: TableStatus.FREE,
      current_session_start: null,
      qr_code: ""
      // Will be updated after insert with the ID
    }).select().single();
    if (error) throw error;
    const qrCode = `/join/${data.id}`;
    await db.from("game_tables").update({ qr_code: qrCode }).eq("id", data.id);
    return toGameTable({ ...data, qr_code: qrCode });
  }
  async updateTable(id, updates) {
    const dbUpdates = {};
    if (updates.tableName !== void 0) dbUpdates.table_name = updates.tableName;
    if (updates.gameName !== void 0) dbUpdates.game_name = updates.gameName;
    if (updates.status !== void 0) dbUpdates.status = updates.status;
    if (updates.currentSessionStart !== void 0) dbUpdates.current_session_start = updates.currentSessionStart;
    const { data, error } = await db.from("game_tables").update(dbUpdates).eq("id", id).select().maybeSingle();
    if (error) throw error;
    return data ? toGameTable(data) : void 0;
  }
  async deleteTable(id) {
    const { error } = await db.from("game_tables").delete().eq("id", id);
    return !error;
  }
  // ============ Users ============
  async getUser(id) {
    const { data, error } = await db.from("users").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? toUser(data) : void 0;
  }
  async getUserByBracelet(braceletId, eventId) {
    const { data, error } = await db.from("users").select("*").eq("bracelet_id", braceletId).eq("event_id", eventId).maybeSingle();
    if (error) throw error;
    return data ? toUser(data) : void 0;
  }
  async createUser(braceletId, name, role, eventId) {
    const { data, error } = await db.from("users").insert({ bracelet_id: braceletId, name, role, event_id: eventId }).select().single();
    if (error) throw error;
    return toUser(data);
  }
  async getUsers(eventId) {
    const { data, error } = await db.from("users").select("*").eq("event_id", eventId);
    if (error) throw error;
    return (data || []).map(toUser);
  }
  // ============ Queue ============
  async getQueueForTable(tableId) {
    const { data, error } = await db.from("queue_entries").select("*").eq("table_id", tableId).order("position", { ascending: true });
    if (error) throw error;
    return (data || []).map(toQueueEntry);
  }
  async getActiveQueueForTable(tableId) {
    const { data, error } = await db.from("queue_entries").select("*").eq("table_id", tableId).in("status", ACTIVE_STATUSES).order("position", { ascending: true });
    if (error) throw error;
    return (data || []).map(toQueueEntry);
  }
  async getUserQueues(userId) {
    const { data, error } = await db.from("queue_entries").select("*, game_tables(*)").eq("user_id", userId).in("status", ACTIVE_STATUSES_WITH_PLAYING).order("joined_at", { ascending: true });
    if (error) throw error;
    return (data || []).map((row) => {
      const entry = toQueueEntry(row);
      const table = row.game_tables ? toGameTable(row.game_tables) : void 0;
      return { ...entry, table };
    });
  }
  async addToQueue(tableId, userId, eventId) {
    const active = await this.getActiveQueueForTable(tableId);
    const position = active.length + 1;
    const { data, error } = await db.from("queue_entries").insert({
      table_id: tableId,
      user_id: userId,
      event_id: eventId,
      position,
      status: QueueEntryStatus.WAITING,
      notified_at: null,
      confirmed_at: null,
      completed_at: null,
      confirm_deadline: null
    }).select().single();
    if (error) throw error;
    return toQueueEntry(data);
  }
  async removeFromQueue(entryId) {
    const entry = await this.getQueueEntry(entryId);
    if (!entry) return false;
    await this.updateQueueEntry(entryId, {
      status: QueueEntryStatus.CANCELLED,
      completedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    const active = await this.getActiveQueueForTable(entry.tableId);
    for (let i = 0; i < active.length; i++) {
      await this.updateQueueEntry(active[i].id, { position: i + 1 });
    }
    return true;
  }
  async updateQueueEntry(id, updates) {
    const dbUpdates = {};
    if (updates.status !== void 0) dbUpdates.status = updates.status;
    if (updates.position !== void 0) dbUpdates.position = updates.position;
    if (updates.notifiedAt !== void 0) dbUpdates.notified_at = updates.notifiedAt;
    if (updates.confirmedAt !== void 0) dbUpdates.confirmed_at = updates.confirmedAt;
    if (updates.completedAt !== void 0) dbUpdates.completed_at = updates.completedAt;
    if (updates.confirmDeadline !== void 0) dbUpdates.confirm_deadline = updates.confirmDeadline;
    const { data, error } = await db.from("queue_entries").update(dbUpdates).eq("id", id).select().maybeSingle();
    if (error) throw error;
    return data ? toQueueEntry(data) : void 0;
  }
  async getQueueEntry(id) {
    const { data, error } = await db.from("queue_entries").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? toQueueEntry(data) : void 0;
  }
  async isUserInQueue(userId, tableId) {
    const { data, error } = await db.from("queue_entries").select("id").eq("user_id", userId).eq("table_id", tableId).in("status", ACTIVE_STATUSES_WITH_PLAYING).limit(1);
    if (error) throw error;
    return (data || []).length > 0;
  }
  async reorderQueue(tableId, entryIds) {
    for (let i = 0; i < entryIds.length; i++) {
      await db.from("queue_entries").update({ position: i + 1 }).eq("id", entryIds[i]).eq("table_id", tableId);
    }
  }
  async getNextInQueue(tableId) {
    const { data, error } = await db.from("queue_entries").select("*").eq("table_id", tableId).eq("status", QueueEntryStatus.WAITING).order("position", { ascending: true }).limit(1).maybeSingle();
    if (error) throw error;
    return data ? toQueueEntry(data) : void 0;
  }
  // ============ Subscriptions ============
  async getSubscription(queueEntryId) {
    const { data, error } = await db.from("users_subscriptions").select("chat_id, messenger").eq("queue_entry_id", queueEntryId).maybeSingle();
    if (error) throw error;
    return data || void 0;
  }
  async saveSubscription(queueEntryId, chatId, messenger) {
    const { error } = await db.from("users_subscriptions").upsert(
      { queue_entry_id: queueEntryId, chat_id: chatId, messenger },
      { onConflict: "queue_entry_id,messenger" }
    );
    if (error) throw error;
  }
  // ============ Analytics ============
  async getAnalytics(eventId) {
    const tables = await this.getTables(eventId);
    const results = [];
    for (const table of tables) {
      const { data: entries } = await db.from("queue_entries").select("*").eq("table_id", table.id);
      const all = (entries || []).map(toQueueEntry);
      const completed = all.filter((e) => e.status === QueueEntryStatus.COMPLETED);
      const cancelled = all.filter((e) => e.status === QueueEntryStatus.CANCELLED);
      const expired = all.filter((e) => e.status === QueueEntryStatus.EXPIRED);
      const skipped = all.filter((e) => e.status === QueueEntryStatus.SKIPPED);
      const waitTimes = completed.filter((e) => e.confirmedAt && e.joinedAt).map((e) => (new Date(e.confirmedAt).getTime() - new Date(e.joinedAt).getTime()) / 6e4);
      const sessionTimes = completed.filter((e) => e.completedAt && e.confirmedAt).map((e) => (new Date(e.completedAt).getTime() - new Date(e.confirmedAt).getTime()) / 6e4);
      results.push({
        tableId: table.id,
        tableName: table.tableName,
        gameName: table.gameName,
        totalEntries: all.length,
        completedEntries: completed.length,
        cancelledEntries: cancelled.length,
        expiredEntries: expired.length,
        skippedEntries: skipped.length,
        avgWaitMinutes: waitTimes.length ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length) : 0,
        avgSessionMinutes: sessionTimes.length ? Math.round(sessionTimes.reduce((a, b) => a + b, 0) / sessionTimes.length) : 0,
        peakQueueSize: all.length
      });
    }
    return results;
  }
  async getEventStats(eventId) {
    const users = await this.getUsers(eventId);
    const { data: allEntries } = await db.from("queue_entries").select("*").eq("event_id", eventId);
    const all = (allEntries || []).map(toQueueEntry);
    const active = all.filter((e) => ACTIVE_STATUSES.includes(e.status));
    const completedWithConfirm = all.filter(
      (e) => e.status === QueueEntryStatus.COMPLETED && e.confirmedAt
    );
    const waitTimes = completedWithConfirm.map(
      (e) => (new Date(e.confirmedAt).getTime() - new Date(e.joinedAt).getTime()) / 6e4
    );
    return {
      totalVisitors: users.filter((u) => u.role === "user").length,
      totalQueueEntries: all.length,
      activeQueues: active.length,
      avgWaitTime: waitTimes.length ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length) : 0
    };
  }
};
var storage = new SupabaseStorage();
function log(message, source = "express") {
  const formattedTime = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}
var BOT_TOKEN = process.env.BOT_TOKEN || "";
async function sendTelegramMessage(chatId, text) {
  if (!BOT_TOKEN) {
    log("\u26A0\uFE0F  BOT_TOKEN not set, skipping Telegram notification");
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" })
    });
    const result = await res.json();
    if (!result.ok) {
      log(`Telegram error: ${JSON.stringify(result)}`);
      return false;
    }
    return true;
  } catch (e) {
    log(`Telegram send error: ${e.message}`);
    return false;
  }
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
  const sub = await storage.getSubscription(next.id);
  if (sub?.chat_id) {
    const table = await storage.getTable(next.tableId);
    const gameName = table?.gameName || "\u0438\u0433\u0440\u0430";
    const tableName = table?.tableName || "\u0441\u0442\u043E\u043B";
    await sendTelegramMessage(
      sub.chat_id,
      `\u{1F3B2} <b>\u0412\u0430\u0448\u0430 \u043E\u0447\u0435\u0440\u0435\u0434\u044C \u043F\u043E\u0434\u043E\u0448\u043B\u0430!</b>

\u0418\u0433\u0440\u0430: ${gameName}
\u0421\u0442\u043E\u043B: ${tableName}

\u041F\u043E\u0434\u043E\u0439\u0434\u0438\u0442\u0435 \u043A \u0441\u0442\u043E\u043B\u0443 \u0432 \u0442\u0435\u0447\u0435\u043D\u0438\u0435 3 \u043C\u0438\u043D\u0443\u0442.`
    );
  }
  const timer = setTimeout(async () => {
    const entry = await storage.getQueueEntry(next.id);
    if (entry && entry.status === QueueEntryStatus.NOTIFIED) {
      await storage.updateQueueEntry(next.id, {
        status: QueueEntryStatus.EXPIRED,
        completedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      const active = await storage.getActiveQueueForTable(tableId);
      for (let i = 0; i < active.length; i++) {
        await storage.updateQueueEntry(active[i].id, { position: i + 1 });
      }
      await notifyNextInQueue(tableId);
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
    try {
      const { password } = req.body;
      if (password !== "admin2026" && password !== "manager2026") {
        return res.status(401).json({ message: "\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u043F\u0430\u0440\u043E\u043B\u044C" });
      }
      const role = password === "admin2026" ? UserRole.ADMIN : UserRole.MANAGER;
      const braceletId = password === "admin2026" ? "ADMIN" : "MANAGER";
      const name = password === "admin2026" ? "\u0410\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440" : "\u041C\u0435\u043D\u0435\u0434\u0436\u0435\u0440";
      let activeEvent = await storage.getActiveEvent();
      if (!activeEvent) {
        activeEvent = await storage.createEvent({ name: "\u0424\u0435\u0441\u0442\u0438\u0432\u0430\u043B\u044C", description: "" });
        await storage.activateEvent(activeEvent.id);
      }
      let user = await storage.getUserByBracelet(braceletId, activeEvent.id);
      if (!user) {
        user = await storage.createUser(braceletId, name, role, activeEvent.id);
      }
      res.json(user);
    } catch (e) {
      res.status(500).json({ message: e.message });
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
    for (let i = 0; i < remaining.length; i++) {
      await storage.updateQueueEntry(remaining[i].id, { position: i + 1 });
    }
    await notifyNextInQueue(table.id);
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
    if (table.status === TableStatus.FREE && entry.position === 1) {
      await notifyNextInQueue(tableId);
    }
    res.status(201).json(entry);
  });
  app2.post("/api/tables/:tableId/reorder", async (req, res) => {
    const { entryIds } = req.body;
    if (!Array.isArray(entryIds)) return res.status(400).json({ message: "entryIds required" });
    await storage.reorderQueue(req.params.tableId, entryIds);
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
    for (let i = 0; i < active.length; i++) {
      await storage.updateQueueEntry(active[i].id, { position: i + 1 });
    }
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
  app2.post("/api/telegram/webhook", async (req, res) => {
    try {
      const update = req.body;
      const message = update?.message;
      if (!message?.text) {
        return res.json({ ok: true });
      }
      const chatId = String(message.chat.id);
      const text = message.text.trim();
      if (text.startsWith("/start")) {
        const parts = text.split(" ");
        if (parts.length >= 2 && parts[1].startsWith("queue_")) {
          const queueEntryId = parts[1].replace("queue_", "");
          const entry = await storage.getQueueEntry(queueEntryId);
          if (entry) {
            await storage.saveSubscription(queueEntryId, chatId, "telegram");
            await sendTelegramMessage(
              chatId,
              `\u2705 <b>\u0423\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F \u0432\u043A\u043B\u044E\u0447\u0435\u043D\u044B!</b>

\u0412\u044B \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435, \u043A\u043E\u0433\u0434\u0430 \u043F\u043E\u0434\u043E\u0439\u0434\u0451\u0442 \u0432\u0430\u0448\u0430 \u043E\u0447\u0435\u0440\u0435\u0434\u044C.

\u{1F3B2} \u0423\u0434\u0430\u0447\u043D\u043E\u0439 \u0438\u0433\u0440\u044B \u043D\u0430 \u0444\u0435\u0441\u0442\u0438\u0432\u0430\u043B\u0435!`
            );
          } else {
            await sendTelegramMessage(
              chatId,
              `\u274C \u0417\u0430\u043F\u0438\u0441\u044C \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u0438 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u0437\u0430\u043F\u0438\u0441\u0430\u0442\u044C\u0441\u044F \u0437\u0430\u043D\u043E\u0432\u043E \u0447\u0435\u0440\u0435\u0437 QR-\u043A\u043E\u0434 \u043D\u0430 \u0441\u0442\u043E\u043B\u0435.`
            );
          }
        } else {
          await sendTelegramMessage(
            chatId,
            `\u{1F44B} <b>\u0414\u043E\u0431\u0440\u043E \u043F\u043E\u0436\u0430\u043B\u043E\u0432\u0430\u0442\u044C \u0432 QueueFest!</b>

\u042F \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u044E \u0432\u0430\u0441, \u043A\u043E\u0433\u0434\u0430 \u043F\u043E\u0434\u043E\u0439\u0434\u0451\u0442 \u0432\u0430\u0448\u0430 \u043E\u0447\u0435\u0440\u0435\u0434\u044C \u043D\u0430 \u0444\u0435\u0441\u0442\u0438\u0432\u0430\u043B\u0435 \u043D\u0430\u0441\u0442\u043E\u043B\u044C\u043D\u044B\u0445 \u0438\u0433\u0440.

\u0427\u0442\u043E\u0431\u044B \u043F\u043E\u0434\u043F\u0438\u0441\u0430\u0442\u044C\u0441\u044F, \u0437\u0430\u043F\u0438\u0448\u0438\u0442\u0435\u0441\u044C \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u044C \u0447\u0435\u0440\u0435\u0437 \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u0438 \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \u043A\u043D\u043E\u043F\u043A\u0443 \xAB\u0423\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F \u0432 Telegram\xBB.`
          );
        }
      }
      res.json({ ok: true });
    } catch (e) {
      log(`Webhook error: ${e.message}`);
      res.json({ ok: true });
    }
  });
  app2.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  });
  return httpServer2;
}
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
