import { useEffect, useRef, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * useRealtimeWithFallback
 *
 * Основной способ: Supabase Realtime (WebSocket).
 * Фолбек: REST-поллинг каждые 10-15 секунд если WS недоступен.
 *
 * При изменении данных в указанных таблицах — инвалидирует TanStack Query кэш.
 */

interface UseRealtimeOptions {
  /** Таблицы Supabase для подписки (snake_case) */
  tables: string[];
  /** Ключи TanStack Query для инвалидации при изменениях */
  queryKeys: (string | string[])[];
  /** Включить подписку (по умолчанию true) */
  enabled?: boolean;
  /** Интервал поллинга в мс (по умолчанию 12000 — 12 сек) */
  pollInterval?: number;
}

export function useRealtimeWithFallback({
  tables,
  queryKeys,
  enabled = true,
  pollInterval = 12000,
}: UseRealtimeOptions) {
  const queryClient = useQueryClient();
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const invalidateAll = useCallback(() => {
    for (const key of queryKeys) {
      queryClient.invalidateQueries({
        queryKey: Array.isArray(key) ? key : [key],
      });
    }
  }, [queryClient, queryKeys]);

  // Supabase Realtime subscription
  useEffect(() => {
    if (!enabled) return;

    const channelName = `queuefest-${tables.join("-")}-${Date.now()}`;
    const channel = supabase.channel(channelName);

    for (const table of tables) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          invalidateAll();
        }
      );
    }

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        setIsRealtimeConnected(true);
      } else if (status === "CLOSED" || status === "CHANNEL_ERROR") {
        setIsRealtimeConnected(false);
      }
    });

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
      channelRef.current = null;
      setIsRealtimeConnected(false);
    };
  }, [enabled, tables.join(","), invalidateAll]);

  // Fallback polling: activate when Realtime is disconnected
  useEffect(() => {
    if (!enabled) return;

    if (!isRealtimeConnected) {
      // Start polling
      const poll = () => {
        invalidateAll();
      };
      pollingRef.current = setInterval(poll, pollInterval);
      // Also immediately refetch once on fallback start
      invalidateAll();
    } else {
      // Stop polling — Realtime is handling it
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      // Refetch once to sync after reconnect
      invalidateAll();
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [isRealtimeConnected, enabled, pollInterval, invalidateAll]);

  return { isRealtimeConnected };
}

/**
 * Simplified hook for subscribing to a single table's changes.
 */
export function useTableRealtime(
  table: string,
  queryKeys: (string | string[])[],
  enabled = true
) {
  return useRealtimeWithFallback({
    tables: [table],
    queryKeys,
    enabled,
  });
}
