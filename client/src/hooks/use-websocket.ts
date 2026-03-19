import { useEffect, useRef, useCallback, useState } from "react";
import type { WSMessage } from "@shared/schema";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

export function useWebSocket(userId: string | null | undefined) {
  const wsRef = useRef<WebSocket | null>(null);
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const reconnectTimerRef = useRef<NodeJS.Timeout>();
  const listenersRef = useRef<Map<string, Set<(msg: WSMessage) => void>>>(new Map());

  const connect = useCallback(() => {
    if (!userId) return;

    // Build WS URL
    let wsUrl: string;
    if (API_BASE) {
      // Deployed: use proxy path
      const loc = window.location;
      const proto = loc.protocol === "https:" ? "wss:" : "ws:";
      const basePath = loc.pathname.replace(/\/[^/]*$/, "");
      wsUrl = `${proto}//${loc.host}${basePath}/${API_BASE}/ws`;
    } else {
      // Local dev
      const loc = window.location;
      const proto = loc.protocol === "https:" ? "wss:" : "ws:";
      wsUrl = `${proto}//${loc.host}/ws`;
    }

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      ws.send(JSON.stringify({ type: "auth", userId }));
    };

    ws.onmessage = (event) => {
      try {
        const msg: WSMessage = JSON.parse(event.data);
        setLastMessage(msg);
        // Notify type-specific listeners
        const listeners = listenersRef.current.get(msg.type);
        if (listeners) {
          listeners.forEach((cb) => cb(msg));
        }
        // Notify wildcard listeners
        const wildcardListeners = listenersRef.current.get("*");
        if (wildcardListeners) {
          wildcardListeners.forEach((cb) => cb(msg));
        }
      } catch (e) {
        // ignore non-JSON
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      // Auto-reconnect after 10s (polling handles updates in the meantime)
      reconnectTimerRef.current = setTimeout(connect, 10000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [userId]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

  const on = useCallback((type: string, callback: (msg: WSMessage) => void) => {
    if (!listenersRef.current.has(type)) {
      listenersRef.current.set(type, new Set());
    }
    listenersRef.current.get(type)!.add(callback);
    return () => {
      listenersRef.current.get(type)?.delete(callback);
    };
  }, []);

  return { lastMessage, isConnected, on };
}
