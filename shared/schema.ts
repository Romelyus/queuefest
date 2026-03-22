import { z } from "zod";

// === Enums ===
export const UserRole = {
  USER: "user",
  MANAGER: "manager",
  ADMIN: "admin",
} as const;

export type UserRoleType = (typeof UserRole)[keyof typeof UserRole];

export const QueueEntryStatus = {
  WAITING: "waiting",
  NOTIFIED: "notified",
  CONFIRMED: "confirmed",
  PLAYING: "playing",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
  SKIPPED: "skipped",
} as const;

export type QueueEntryStatusType =
  (typeof QueueEntryStatus)[keyof typeof QueueEntryStatus];

export const TableStatus = {
  FREE: "free",
  PLAYING: "playing",
  PAUSED: "paused",
} as const;

export type TableStatusType = (typeof TableStatus)[keyof typeof TableStatus];

// === Database Row Types (snake_case, matching Supabase) ===

export interface DbEvent {
  id: string;
  name: string;
  description: string;
  is_active: boolean;
  created_at: string;
}

export interface DbUser {
  id: string;
  bracelet_id: string;
  name: string;
  role: UserRoleType;
  event_id: string;
  created_at: string;
}

export interface DbGameTable {
  id: string;
  event_id: string;
  table_name: string;
  game_name: string;
  status: TableStatusType;
  current_session_start: string | null;
  qr_code: string;
  max_parallel_games: number;
}

export interface DbQueueEntry {
  id: string;
  table_id: string;
  user_id: string;
  event_id: string;
  position: number;
  status: QueueEntryStatusType;
  joined_at: string;
  notified_at: string | null;
  confirmed_at: string | null;
  completed_at: string | null;
  confirm_deadline: string | null;
  walk_deadline: string | null;
}

export interface DbUserSubscription {
  id: string;
  user_id: string;
  messenger: "telegram" | "max";
  chat_id: string;
  created_at: string;
}

// === Frontend-Friendly Types (camelCase, used in UI) ===

export interface Event {
  id: string;
  name: string;
  description: string;
  isActive: boolean;
  createdAt: string;
}

export interface GameTable {
  id: string;
  eventId: string;
  tableName: string;
  gameName: string;
  status: TableStatusType;
  currentSessionStart: string | null;
  qrCode: string;
  maxParallelGames: number;
}

export interface User {
  id: string;
  braceletId: string;
  name: string;
  role: UserRoleType;
  eventId: string;
  createdAt: string;
}

export interface QueueEntry {
  id: string;
  tableId: string;
  userId: string;
  eventId: string;
  position: number;
  status: QueueEntryStatusType;
  joinedAt: string;
  notifiedAt: string | null;
  confirmedAt: string | null;
  completedAt: string | null;
  confirmDeadline: string | null;
  walkDeadline: string | null;
}

// Analytics aggregates
export interface QueueAnalytics {
  tableId: string;
  tableName: string;
  gameName: string;
  totalEntries: number;
  completedEntries: number;
  cancelledEntries: number;
  expiredEntries: number;
  skippedEntries: number;
  avgWaitMinutes: number;
  avgSessionMinutes: number;
  peakQueueSize: number;
}

// === Converters: DB → Frontend ===

export function toEvent(row: DbEvent): Event {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export function toUser(row: DbUser): User {
  return {
    id: row.id,
    braceletId: row.bracelet_id,
    name: row.name,
    role: row.role,
    eventId: row.event_id,
    createdAt: row.created_at,
  };
}

export function toGameTable(row: DbGameTable): GameTable {
  return {
    id: row.id,
    eventId: row.event_id,
    tableName: row.table_name,
    gameName: row.game_name,
    status: row.status as TableStatusType,
    currentSessionStart: row.current_session_start,
    qrCode: row.qr_code,
    maxParallelGames: row.max_parallel_games ?? 1,
  };
}

export function toQueueEntry(row: DbQueueEntry): QueueEntry {
  return {
    id: row.id,
    tableId: row.table_id,
    userId: row.user_id,
    eventId: row.event_id,
    position: row.position,
    status: row.status as QueueEntryStatusType,
    joinedAt: row.joined_at,
    notifiedAt: row.notified_at,
    confirmedAt: row.confirmed_at,
    completedAt: row.completed_at,
    confirmDeadline: row.confirm_deadline,
    walkDeadline: row.walk_deadline,
  };
}

// === Zod Schemas for validation ===

export const insertEventSchema = z.object({
  name: z.string().min(1, "Название обязательно"),
  description: z.string().default(""),
});

export type InsertEvent = z.infer<typeof insertEventSchema>;

export const insertTableSchema = z.object({
  eventId: z.string().min(1),
  tableName: z.string().min(1, "Название стола обязательно"),
  gameName: z.string().min(1, "Название игры обязательно"),
  maxParallelGames: z.number().int().min(1).max(10).default(1),
});

export type InsertTable = z.infer<typeof insertTableSchema>;

export const loginSchema = z.object({
  braceletId: z
    .string()
    .min(1, "Введите ID браслета")
    .regex(/^\d+$/, "ID должен содержать только цифры"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const joinQueueSchema = z.object({
  tableId: z.string().min(1),
  userId: z.string().min(1),
});

export type JoinQueueInput = z.infer<typeof joinQueueSchema>;

// Supabase Database type helper (for supabase client typing)
export interface Database {
  public: {
    Tables: {
      events: { Row: DbEvent; Insert: Omit<DbEvent, "id" | "created_at">; Update: Partial<Omit<DbEvent, "id">> };
      users: { Row: DbUser; Insert: Omit<DbUser, "id" | "created_at">; Update: Partial<Omit<DbUser, "id">> };
      game_tables: { Row: DbGameTable; Insert: Omit<DbGameTable, "id">; Update: Partial<Omit<DbGameTable, "id">> };
      queue_entries: { Row: DbQueueEntry; Insert: Omit<DbQueueEntry, "id" | "joined_at">; Update: Partial<Omit<DbQueueEntry, "id">> };
      users_subscriptions: { Row: DbUserSubscription; Insert: Omit<DbUserSubscription, "id" | "created_at">; Update: Partial<Omit<DbUserSubscription, "id">> };
    };
  };
}
