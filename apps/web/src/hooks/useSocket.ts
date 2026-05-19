import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { api } from "../api";

type SocketEvent = {
  event: string;
  handler: (payload: unknown) => void;
};

/**
 * Creates a singleton Socket.IO connection for the lifetime of the component
 * that mounts it (App). Subscribers register event→handler pairs; the hook
 * connects on mount and disconnects on unmount.
 *
 * Using a ref for the socket prevents React StrictMode double-mount from
 * opening two connections.
 */
export function useSocket(
  enabled: boolean,
  events: SocketEvent[]
): void {
  const socketRef = useRef<Socket | null>(null);
  // Keep a stable ref to the events array so the effect doesn't re-run on
  // every render when the parent re-renders with a new inline array literal.
  const eventsRef = useRef(events);
  eventsRef.current = events;

  useEffect(() => {
    if (!enabled) return;

    const socket = io(api.apiUrl, { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    const attach = () => {
      for (const { event, handler } of eventsRef.current) {
        socket.on(event, handler as (...args: unknown[]) => void);
      }
    };

    attach();

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [enabled]);
}
