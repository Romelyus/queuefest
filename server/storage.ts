import { supabaseAdmin } from "./supabase";
import {
  toEvent,
  toUser,
  toGameTable,
  toQueueEntry,
  QueueEntryStatus,
  TableStatus,
} from "../shared/schema";
import type {
  Event,
  GameTable,
  User,
  QueueEntry,
  InsertEvent,
  InsertTable,
  QueueEntryStatusType,
  QueueAnalytics,
  UserRoleType,
} from "../shared/schema";

const db = supabaseAdmin;

const ACTIVE_STATUSES: QueueEntryStatusType[] = [
  QueueEntryStatus.WAITING,
  QueueEntryStatus.NOTIFIED,
  QueueEntryStatus.CONFIRMED,
];

const ACTIVE_STATUSES_WITH_PLAYING: QueueEntryStatusType[] = [
  ...ACTIVE_STATUSES,
  QueueEntryStatus.PLAYING,
];

export interface IStorage {
  // Events
  getEvents(): Promise<Event[]>;
  getEvent(id: string): Promise<Event | undefined>;
  getActiveEvent(): Promise<Event | undefined>;
  createEvent(data: InsertEvent): Promise<Event>;
  updateEvent(id: string, data: Partial<Event>): Promise<Event | undefined>;
  activateEvent(id: string): Promise<Event | undefined>;
  deleteEvent(id: string): Promise<boolean>;

  // Tables
  getTables(eventId: string): Promise<GameTable[]>;
  getTable(id: string): Promise<GameTable | undefined>;
  createTable(data: InsertTable): Promise<GameTable>;
  updateTable(id: string, data: Partial<GameTable>): Promise<GameTable | undefined>;
  deleteTable(id: string): Promise<boolean>;

  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByBracelet(braceletId: string, eventId: string): Promise<User | undefined>;
  createUser(braceletId: string, name: string, role: UserRoleType, eventId: string): Promise<User>;
  getUsers(eventId: string): Promise<User[]>;

  // Queue
  getQueueForTable(tableId: string): Promise<QueueEntry[]>;
  getActiveQueueForTable(tableId: string): Promise<QueueEntry[]>;
  getActiveQueueForTableWithPlaying(tableId: string): Promise<QueueEntry[]>;
  getUserQueues(userId: string): Promise<(QueueEntry & { table?: GameTable })[]>;
  addToQueue(tableId: string, userId: string, eventId: string): Promise<QueueEntry>;
  removeFromQueue(entryId: string): Promise<boolean>;
  updateQueueEntry(id: string, data: Partial<QueueEntry>): Promise<QueueEntry | undefined>;
  getQueueEntry(id: string): Promise<QueueEntry | undefined>;
  isUserInQueue(userId: string, tableId: string): Promise<boolean>;
  reorderQueue(tableId: string, entryIds: string[]): Promise<void>;
  getNextInQueue(tableId: string): Promise<QueueEntry | undefined>;

  // Subscriptions (now per-user, not per-queue-entry)
  getSubscriptionByUserId(userId: string): Promise<{ chat_id: string; messenger: string } | undefined>;
  saveSubscriptionForUser(userId: string, chatId: string, messenger: string): Promise<void>;

  // Analytics
  getAnalytics(eventId: string): Promise<QueueAnalytics[]>;
  getEventStats(eventId: string): Promise<{
    totalVisitors: number;
    totalQueueEntries: number;
    activeQueues: number;
    avgWaitTime: number;
  }>;
}

export class SupabaseStorage implements IStorage {
  // ============ Events ============

  async getEvents(): Promise<Event[]> {
    const { data, error } = await db
      .from("events")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(toEvent);
  }

  async getEvent(id: string): Promise<Event | undefined> {
    const { data, error } = await db.from("events").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? toEvent(data) : undefined;
  }

  async getActiveEvent(): Promise<Event | undefined> {
    const { data, error } = await db
      .from("events")
      .select("*")
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw error;
    return data ? toEvent(data) : undefined;
  }

  async createEvent(input: InsertEvent): Promise<Event> {
    const { data, error } = await db
      .from("events")
      .insert({ name: input.name, description: input.description || "", is_active: false })
      .select()
      .single();
    if (error) throw error;
    return toEvent(data);
  }

  async updateEvent(id: string, updates: Partial<Event>): Promise<Event | undefined> {
    const dbUpdates: Record<string, unknown> = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.description !== undefined) dbUpdates.description = updates.description;
    if (updates.isActive !== undefined) dbUpdates.is_active = updates.isActive;

    const { data, error } = await db
      .from("events")
      .update(dbUpdates)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data ? toEvent(data) : undefined;
  }

  async activateEvent(id: string): Promise<Event | undefined> {
    // Deactivate all events first
    await db.from("events").update({ is_active: false }).neq("id", id);
    // Activate this one
    const { data, error } = await db
      .from("events")
      .update({ is_active: true })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data ? toEvent(data) : undefined;
  }

  async deleteEvent(id: string): Promise<boolean> {
    const { error } = await db.from("events").delete().eq("id", id);
    return !error;
  }

  // ============ Tables ============

  async getTables(eventId: string): Promise<GameTable[]> {
    const { data, error } = await db
      .from("game_tables")
      .select("*")
      .eq("event_id", eventId);
    if (error) throw error;
    return (data || []).map(toGameTable);
  }

  async getTable(id: string): Promise<GameTable | undefined> {
    const { data, error } = await db.from("game_tables").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? toGameTable(data) : undefined;
  }

  async createTable(input: InsertTable): Promise<GameTable> {
    const { data, error } = await db
      .from("game_tables")
      .insert({
        event_id: input.eventId,
        table_name: input.tableName,
        game_name: input.gameName,
        status: TableStatus.FREE,
        current_session_start: null,
        qr_code: "", // Will be updated after insert with the ID
        max_parallel_games: input.maxParallelGames ?? 1,
      })
      .select()
      .single();
    if (error) throw error;

    // Update qr_code with the actual ID
    const qrCode = `/join/${data.id}`;
    await db.from("game_tables").update({ qr_code: qrCode }).eq("id", data.id);

    return toGameTable({ ...data, qr_code: qrCode });
  }

  async updateTable(id: string, updates: Partial<GameTable>): Promise<GameTable | undefined> {
    const dbUpdates: Record<string, unknown> = {};
    if (updates.tableName !== undefined) dbUpdates.table_name = updates.tableName;
    if (updates.gameName !== undefined) dbUpdates.game_name = updates.gameName;
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.currentSessionStart !== undefined) dbUpdates.current_session_start = updates.currentSessionStart;
    if (updates.maxParallelGames !== undefined) dbUpdates.max_parallel_games = updates.maxParallelGames;

    const { data, error } = await db
      .from("game_tables")
      .update(dbUpdates)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data ? toGameTable(data) : undefined;
  }

  async deleteTable(id: string): Promise<boolean> {
    const { error } = await db.from("game_tables").delete().eq("id", id);
    return !error;
  }

  // ============ Users ============

  async getUser(id: string): Promise<User | undefined> {
    const { data, error } = await db.from("users").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? toUser(data) : undefined;
  }

  async getUserByBracelet(braceletId: string, eventId: string): Promise<User | undefined> {
    const { data, error } = await db
      .from("users")
      .select("*")
      .eq("bracelet_id", braceletId)
      .eq("event_id", eventId)
      .maybeSingle();
    if (error) throw error;
    return data ? toUser(data) : undefined;
  }

  async createUser(braceletId: string, name: string, role: UserRoleType, eventId: string): Promise<User> {
    const { data, error } = await db
      .from("users")
      .insert({ bracelet_id: braceletId, name, role, event_id: eventId })
      .select()
      .single();
    if (error) throw error;
    return toUser(data);
  }

  async getUsers(eventId: string): Promise<User[]> {
    const { data, error } = await db.from("users").select("*").eq("event_id", eventId);
    if (error) throw error;
    return (data || []).map(toUser);
  }

  // ============ Queue ============

  async getQueueForTable(tableId: string): Promise<QueueEntry[]> {
    const { data, error } = await db
      .from("queue_entries")
      .select("*")
      .eq("table_id", tableId)
      .order("position", { ascending: true });
    if (error) throw error;
    return (data || []).map(toQueueEntry);
  }

  async getActiveQueueForTable(tableId: string): Promise<QueueEntry[]> {
    const { data, error } = await db
      .from("queue_entries")
      .select("*")
      .eq("table_id", tableId)
      .in("status", ACTIVE_STATUSES)
      .order("position", { ascending: true });
    if (error) throw error;
    return (data || []).map(toQueueEntry);
  }

  async getActiveQueueForTableWithPlaying(tableId: string): Promise<QueueEntry[]> {
    const { data, error } = await db
      .from("queue_entries")
      .select("*")
      .eq("table_id", tableId)
      .in("status", ACTIVE_STATUSES_WITH_PLAYING)
      .order("position", { ascending: true });
    if (error) throw error;
    return (data || []).map(toQueueEntry);
  }

  async getUserQueues(userId: string): Promise<(QueueEntry & { table?: GameTable })[]> {
    const { data, error } = await db
      .from("queue_entries")
      .select("*, game_tables(*)")
      .eq("user_id", userId)
      .in("status", ACTIVE_STATUSES_WITH_PLAYING)
      .order("joined_at", { ascending: true });
    if (error) throw error;

    return (data || []).map((row: any) => {
      const entry = toQueueEntry(row);
      const table = row.game_tables ? toGameTable(row.game_tables) : undefined;
      return { ...entry, table };
    });
  }

  async addToQueue(tableId: string, userId: string, eventId: string): Promise<QueueEntry> {
    // Get current max position
    const active = await this.getActiveQueueForTable(tableId);
    const position = active.length + 1;

    const { data, error } = await db
      .from("queue_entries")
      .insert({
        table_id: tableId,
        user_id: userId,
        event_id: eventId,
        position,
        status: QueueEntryStatus.WAITING,
        notified_at: null,
        confirmed_at: null,
        completed_at: null,
        confirm_deadline: null,
        walk_deadline: null,
      })
      .select()
      .single();
    if (error) throw error;
    return toQueueEntry(data);
  }

  async removeFromQueue(entryId: string): Promise<boolean> {
    const entry = await this.getQueueEntry(entryId);
    if (!entry) return false;

    await this.updateQueueEntry(entryId, {
      status: QueueEntryStatus.CANCELLED,
      completedAt: new Date().toISOString(),
    });

    // Reposition remaining
    const active = await this.getActiveQueueForTable(entry.tableId);
    for (let i = 0; i < active.length; i++) {
      await this.updateQueueEntry(active[i].id, { position: i + 1 });
    }
    return true;
  }

  async updateQueueEntry(id: string, updates: Partial<QueueEntry>): Promise<QueueEntry | undefined> {
    const dbUpdates: Record<string, unknown> = {};
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.position !== undefined) dbUpdates.position = updates.position;
    if (updates.notifiedAt !== undefined) dbUpdates.notified_at = updates.notifiedAt;
    if (updates.confirmedAt !== undefined) dbUpdates.confirmed_at = updates.confirmedAt;
    if (updates.completedAt !== undefined) dbUpdates.completed_at = updates.completedAt;
    if (updates.confirmDeadline !== undefined) dbUpdates.confirm_deadline = updates.confirmDeadline;
    if (updates.walkDeadline !== undefined) dbUpdates.walk_deadline = updates.walkDeadline;

    const { data, error } = await db
      .from("queue_entries")
      .update(dbUpdates)
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data ? toQueueEntry(data) : undefined;
  }

  async getQueueEntry(id: string): Promise<QueueEntry | undefined> {
    const { data, error } = await db.from("queue_entries").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data ? toQueueEntry(data) : undefined;
  }

  async isUserInQueue(userId: string, tableId: string): Promise<boolean> {
    const { data, error } = await db
      .from("queue_entries")
      .select("id")
      .eq("user_id", userId)
      .eq("table_id", tableId)
      .in("status", ACTIVE_STATUSES_WITH_PLAYING)
      .limit(1);
    if (error) throw error;
    return (data || []).length > 0;
  }

  async reorderQueue(tableId: string, entryIds: string[]): Promise<void> {
    for (let i = 0; i < entryIds.length; i++) {
      await db
        .from("queue_entries")
        .update({ position: i + 1 })
        .eq("id", entryIds[i])
        .eq("table_id", tableId);
    }
  }

  async getNextInQueue(tableId: string): Promise<QueueEntry | undefined> {
    const { data, error } = await db
      .from("queue_entries")
      .select("*")
      .eq("table_id", tableId)
      .eq("status", QueueEntryStatus.WAITING)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? toQueueEntry(data) : undefined;
  }

  // ============ Subscriptions (per-user) ============

  async getSubscriptionByUserId(userId: string): Promise<{ chat_id: string; messenger: string } | undefined> {
    const { data, error } = await db
      .from("users_subscriptions")
      .select("chat_id, messenger")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw error;
    return data || undefined;
  }

  async saveSubscriptionForUser(userId: string, chatId: string, messenger: string): Promise<void> {
    const { error } = await db
      .from("users_subscriptions")
      .upsert(
        { user_id: userId, chat_id: chatId, messenger },
        { onConflict: "user_id,messenger" }
      );
    if (error) throw error;
  }

  // ============ Analytics ============

  async getAnalytics(eventId: string): Promise<QueueAnalytics[]> {
    const tables = await this.getTables(eventId);
    const results: QueueAnalytics[] = [];

    for (const table of tables) {
      const { data: entries } = await db
        .from("queue_entries")
        .select("*")
        .eq("table_id", table.id);

      const all = (entries || []).map(toQueueEntry);
      const completed = all.filter((e) => e.status === QueueEntryStatus.COMPLETED);
      const cancelled = all.filter((e) => e.status === QueueEntryStatus.CANCELLED);
      const expired = all.filter((e) => e.status === QueueEntryStatus.EXPIRED);
      const skipped = all.filter((e) => e.status === QueueEntryStatus.SKIPPED);

      const waitTimes = completed
        .filter((e) => e.confirmedAt && e.joinedAt)
        .map((e) => (new Date(e.confirmedAt!).getTime() - new Date(e.joinedAt).getTime()) / 60000);

      const sessionTimes = completed
        .filter((e) => e.completedAt && e.confirmedAt)
        .map((e) => (new Date(e.completedAt!).getTime() - new Date(e.confirmedAt!).getTime()) / 60000);

      results.push({
        tableId: table.id,
        tableName: table.tableName,
        gameName: table.gameName,
        totalEntries: all.length,
        completedEntries: completed.length,
        cancelledEntries: cancelled.length,
        expiredEntries: expired.length,
        skippedEntries: skipped.length,
        avgWaitMinutes: waitTimes.length
          ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length)
          : 0,
        avgSessionMinutes: sessionTimes.length
          ? Math.round(sessionTimes.reduce((a, b) => a + b, 0) / sessionTimes.length)
          : 0,
        peakQueueSize: all.length,
      });
    }
    return results;
  }

  async getEventStats(eventId: string): Promise<{
    totalVisitors: number;
    totalQueueEntries: number;
    activeQueues: number;
    avgWaitTime: number;
  }> {
    const users = await this.getUsers(eventId);
    const { data: allEntries } = await db
      .from("queue_entries")
      .select("*")
      .eq("event_id", eventId);

    const all = (allEntries || []).map(toQueueEntry);
    const active = all.filter((e) => ACTIVE_STATUSES.includes(e.status));

    const completedWithConfirm = all.filter(
      (e) => e.status === QueueEntryStatus.COMPLETED && e.confirmedAt
    );
    const waitTimes = completedWithConfirm.map(
      (e) => (new Date(e.confirmedAt!).getTime() - new Date(e.joinedAt).getTime()) / 60000
    );

    return {
      totalVisitors: users.filter((u) => u.role === "user").length,
      totalQueueEntries: all.length,
      activeQueues: active.length,
      avgWaitTime: waitTimes.length
        ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length)
        : 0,
    };
  }
}

export const storage = new SupabaseStorage();
