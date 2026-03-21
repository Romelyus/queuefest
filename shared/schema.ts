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
  NOTIFIED: "notified", // user was notified it's their turn
  CONFIRMED: "confirmed", // user confirmed they're coming
  PLAYING: "playing", // currently at the table
  COMPLETED: "completed",
  CANCELLED: "cancelled", // user cancelled
  EXPIRED: "expired", // user didn't confirm in time
  SKIPPED: "skipped", // manager skipped
} as const;

export type QueueEntryStatusType =
  (typeof QueueEntryStatus)[keyof typeof QueueEntryStatus];

export const TableStatus = {
  FREE: "free",
  PLAYING: "playing",
  PAUSED: "paused",
} as const;

export type TableStatusType = (typeof TableStatus)[keyof typeof TableStatus];

// === Types ===

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
  qrCode: string; // URL to join queue
}

export interface User {
  id: string;
  braceletId: string; // numeric ID on bracelet
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
  confirmDeadline: string | null; // when the confirmation times out
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

// WebSocket message types
export type WSMessageType =
  | "queue_updated" // queue position changed
  | "your_turn" // it's this user's turn
  | "confirm_timeout" // confirmation deadline approaching
  | "session_started" // table session started
  | "session_ended" // table session ended
  | "queue_position" // position update
  | "removed_from_queue" // removed by manager
  | "table_status_changed"; // table status changed

export interface WSMessage {
  type: WSMessageType;
  payload: Record<string, unknown>;
  timestamp: string;
}
