import { randomUUID } from "crypto";
import type {
  Event,
  GameTable,
  User,
  QueueEntry,
  InsertEvent,
  InsertTable,
  QueueEntryStatusType,
  TableStatusType,
  QueueAnalytics,
  UserRoleType,
} from "../shared/schema";
import { QueueEntryStatus, TableStatus } from "../shared/schema";

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
  getUserQueues(userId: string): Promise<(QueueEntry & { table?: GameTable })[]>;
  addToQueue(tableId: string, userId: string, eventId: string): Promise<QueueEntry>;
  removeFromQueue(entryId: string): Promise<boolean>;
  updateQueueEntry(id: string, data: Partial<QueueEntry>): Promise<QueueEntry | undefined>;
  getQueueEntry(id: string): Promise<QueueEntry | undefined>;
  isUserInQueue(userId: string, tableId: string): Promise<boolean>;
  reorderQueue(tableId: string, entryIds: string[]): Promise<void>;
  getNextInQueue(tableId: string): Promise<QueueEntry | undefined>;

  // Analytics
  getAnalytics(eventId: string): Promise<QueueAnalytics[]>;
  getEventStats(eventId: string): Promise<{
    totalVisitors: number;
    totalQueueEntries: number;
    activeQueues: number;
    avgWaitTime: number;
  }>;
}

export class MemStorage implements IStorage {
  private events: Map<string, Event> = new Map();
  private tables: Map<string, GameTable> = new Map();
  private users: Map<string, User> = new Map();
  private queueEntries: Map<string, QueueEntry> = new Map();

  // Events
  async getEvents(): Promise<Event[]> {
    return Array.from(this.events.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async getEvent(id: string): Promise<Event | undefined> {
    return this.events.get(id);
  }

  async getActiveEvent(): Promise<Event | undefined> {
    return Array.from(this.events.values()).find((e) => e.isActive);
  }

  async createEvent(data: InsertEvent): Promise<Event> {
    const event: Event = {
      id: randomUUID(),
      ...data,
      isActive: false,
      createdAt: new Date().toISOString(),
    };
    this.events.set(event.id, event);
    return event;
  }

  async updateEvent(id: string, data: Partial<Event>): Promise<Event | undefined> {
    const event = this.events.get(id);
    if (!event) return undefined;
    const updated = { ...event, ...data };
    this.events.set(id, updated);
    return updated;
  }

  async activateEvent(id: string): Promise<Event | undefined> {
    const event = this.events.get(id);
    if (!event) return undefined;
    // Deactivate all others first
    for (const [eid, ev] of this.events) {
      if (ev.isActive && eid !== id) {
        this.events.set(eid, { ...ev, isActive: false });
      }
    }
    const updated = { ...event, isActive: true };
    this.events.set(id, updated);
    return updated;
  }

  async deleteEvent(id: string): Promise<boolean> {
    return this.events.delete(id);
  }

  // Tables
  async getTables(eventId: string): Promise<GameTable[]> {
    return Array.from(this.tables.values()).filter((t) => t.eventId === eventId);
  }

  async getTable(id: string): Promise<GameTable | undefined> {
    return this.tables.get(id);
  }

  async createTable(data: InsertTable): Promise<GameTable> {
    const id = randomUUID();
    const table: GameTable = {
      id,
      ...data,
      status: TableStatus.FREE,
      currentSessionStart: null,
      qrCode: `/join/${id}`,
    };
    this.tables.set(id, table);
    return table;
  }

  async updateTable(id: string, data: Partial<GameTable>): Promise<GameTable | undefined> {
    const table = this.tables.get(id);
    if (!table) return undefined;
    const updated = { ...table, ...data };
    this.tables.set(id, updated);
    return updated;
  }

  async deleteTable(id: string): Promise<boolean> {
    return this.tables.delete(id);
  }

  // Users
  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByBracelet(braceletId: string, eventId: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (u) => u.braceletId === braceletId && u.eventId === eventId
    );
  }

  async createUser(braceletId: string, name: string, role: UserRoleType, eventId: string): Promise<User> {
    const user: User = {
      id: randomUUID(),
      braceletId,
      name,
      role,
      eventId,
      createdAt: new Date().toISOString(),
    };
    this.users.set(user.id, user);
    return user;
  }

  async getUsers(eventId: string): Promise<User[]> {
    return Array.from(this.users.values()).filter((u) => u.eventId === eventId);
  }

  // Queue
  async getQueueForTable(tableId: string): Promise<QueueEntry[]> {
    return Array.from(this.queueEntries.values())
      .filter((e) => e.tableId === tableId)
      .sort((a, b) => a.position - b.position);
  }

  async getActiveQueueForTable(tableId: string): Promise<QueueEntry[]> {
    const activeStatuses: QueueEntryStatusType[] = [
      QueueEntryStatus.WAITING,
      QueueEntryStatus.NOTIFIED,
      QueueEntryStatus.CONFIRMED,
    ];
    return Array.from(this.queueEntries.values())
      .filter((e) => e.tableId === tableId && activeStatuses.includes(e.status))
      .sort((a, b) => a.position - b.position);
  }

  async getUserQueues(userId: string): Promise<(QueueEntry & { table?: GameTable })[]> {
    const activeStatuses: QueueEntryStatusType[] = [
      QueueEntryStatus.WAITING,
      QueueEntryStatus.NOTIFIED,
      QueueEntryStatus.CONFIRMED,
      QueueEntryStatus.PLAYING,
    ];
    const entries = Array.from(this.queueEntries.values())
      .filter((e) => e.userId === userId && activeStatuses.includes(e.status))
      .sort((a, b) => new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime());
    return entries.map((e) => ({ ...e, table: this.tables.get(e.tableId) }));
  }

  async addToQueue(tableId: string, userId: string, eventId: string): Promise<QueueEntry> {
    const existing = await this.getActiveQueueForTable(tableId);
    const position = existing.length + 1;
    const entry: QueueEntry = {
      id: randomUUID(),
      tableId,
      userId,
      eventId,
      position,
      status: QueueEntryStatus.WAITING,
      joinedAt: new Date().toISOString(),
      notifiedAt: null,
      confirmedAt: null,
      completedAt: null,
      confirmDeadline: null,
    };
    this.queueEntries.set(entry.id, entry);
    return entry;
  }

  async removeFromQueue(entryId: string): Promise<boolean> {
    const entry = this.queueEntries.get(entryId);
    if (!entry) return false;
    entry.status = QueueEntryStatus.CANCELLED;
    entry.completedAt = new Date().toISOString();
    this.queueEntries.set(entryId, entry);
    // Reposition remaining
    const active = await this.getActiveQueueForTable(entry.tableId);
    active.forEach((e, i) => {
      e.position = i + 1;
      this.queueEntries.set(e.id, e);
    });
    return true;
  }

  async updateQueueEntry(id: string, data: Partial<QueueEntry>): Promise<QueueEntry | undefined> {
    const entry = this.queueEntries.get(id);
    if (!entry) return undefined;
    const updated = { ...entry, ...data };
    this.queueEntries.set(id, updated);
    return updated;
  }

  async getQueueEntry(id: string): Promise<QueueEntry | undefined> {
    return this.queueEntries.get(id);
  }

  async isUserInQueue(userId: string, tableId: string): Promise<boolean> {
    const activeStatuses: QueueEntryStatusType[] = [
      QueueEntryStatus.WAITING,
      QueueEntryStatus.NOTIFIED,
      QueueEntryStatus.CONFIRMED,
      QueueEntryStatus.PLAYING,
    ];
    return Array.from(this.queueEntries.values()).some(
      (e) => e.userId === userId && e.tableId === tableId && activeStatuses.includes(e.status)
    );
  }

  async reorderQueue(tableId: string, entryIds: string[]): Promise<void> {
    entryIds.forEach((id, index) => {
      const entry = this.queueEntries.get(id);
      if (entry && entry.tableId === tableId) {
        entry.position = index + 1;
        this.queueEntries.set(id, entry);
      }
    });
  }

  async getNextInQueue(tableId: string): Promise<QueueEntry | undefined> {
    const active = await this.getActiveQueueForTable(tableId);
    return active.find((e) => e.status === QueueEntryStatus.WAITING);
  }

  // Analytics
  async getAnalytics(eventId: string): Promise<QueueAnalytics[]> {
    const tables = await this.getTables(eventId);
    return tables.map((table) => {
      const entries = Array.from(this.queueEntries.values()).filter(
        (e) => e.tableId === table.id
      );
      const completed = entries.filter((e) => e.status === QueueEntryStatus.COMPLETED);
      const cancelled = entries.filter((e) => e.status === QueueEntryStatus.CANCELLED);
      const expired = entries.filter((e) => e.status === QueueEntryStatus.EXPIRED);
      const skipped = entries.filter((e) => e.status === QueueEntryStatus.SKIPPED);

      const waitTimes = completed
        .filter((e) => e.confirmedAt && e.joinedAt)
        .map((e) => (new Date(e.confirmedAt!).getTime() - new Date(e.joinedAt).getTime()) / 60000);

      const sessionTimes = completed
        .filter((e) => e.completedAt && e.confirmedAt)
        .map((e) => (new Date(e.completedAt!).getTime() - new Date(e.confirmedAt!).getTime()) / 60000);

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
        peakQueueSize: entries.length, // simplified
      };
    });
  }

  async getEventStats(eventId: string): Promise<{
    totalVisitors: number;
    totalQueueEntries: number;
    activeQueues: number;
    avgWaitTime: number;
  }> {
    const users = await this.getUsers(eventId);
    const allEntries = Array.from(this.queueEntries.values()).filter(
      (e) => e.eventId === eventId
    );
    const activeStatuses: QueueEntryStatusType[] = [
      QueueEntryStatus.WAITING,
      QueueEntryStatus.NOTIFIED,
      QueueEntryStatus.CONFIRMED,
    ];
    const active = allEntries.filter((e) => activeStatuses.includes(e.status));

    const completedEntries = allEntries.filter(
      (e) => e.status === QueueEntryStatus.COMPLETED && e.confirmedAt
    );
    const waitTimes = completedEntries.map(
      (e) => (new Date(e.confirmedAt!).getTime() - new Date(e.joinedAt).getTime()) / 60000
    );

    return {
      totalVisitors: users.filter((u) => u.role === "user").length,
      totalQueueEntries: allEntries.length,
      activeQueues: active.length,
      avgWaitTime: waitTimes.length
        ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length)
        : 0,
    };
  }
}

export const storage = new MemStorage();
