import { useEffect, useMemo, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import { api } from "../api";

type SocketEvent = {
  event: string;
  handler: (payload: unknown) => void;
};

const debugSockets = import.meta.env.DEV && localStorage.getItem("crm:debug:sockets") === "1";

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
  
  // We use a ref to hold the latest events so that our socket listeners 
  // always call the freshest handler without needing to re-bind the socket
  // on every single render (which would happen if we passed inline arrays).
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const eventSignature = useMemo(
    () => Array.from(new Set(events.map((item) => item.event))).sort().join("|"),
    [events]
  );

  useEffect(() => {
    if (!enabled) return;

    const socket = io(api.apiUrl, { transports: ["websocket", "polling"] });
    socketRef.current = socket;
    socket.on("connect", () => {
      if (debugSockets) console.debug(`[Socket] connected ${socket.id}`);
    });
    socket.on("disconnect", (reason) => {
      if (debugSockets) console.debug(`[Socket] disconnected: ${reason}`);
    });

    // Create a stable callback for each event that dispatches to the current handler
    // We bind once, and dispatch dynamically.
    const boundListeners: Record<string, (payload: any) => void> = {};

    // We extract unique event names from the initial mount.
    // If dynamic event registration is needed, this would need to depend on event names.
    const eventNames = eventSignature ? eventSignature.split("|") : [];

    for (const eventName of eventNames) {
      const listener = (payload: any) => {
        // Find the latest handler for this event
        const evt = eventsRef.current.find(e => e.event === eventName);
        if (evt && evt.handler) {
          evt.handler(payload);
        }
      };
      boundListeners[eventName] = listener;
      if (debugSockets) console.debug(`[Socket] listen ${eventName}`);
      socket.on(eventName, listener);
    }

    return () => {
      // Clean up properly
      for (const eventName of Object.keys(boundListeners)) {
        if (debugSockets) console.debug(`[Socket] unlisten ${eventName}`);
        socket.off(eventName, boundListeners[eventName]);
      }
      socket.off("connect");
      socket.off("disconnect");
      socket.close();
      socketRef.current = null;
    };
  }, [enabled, eventSignature]);
}
