import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Session } from "../api";

export type SyncState = { status: "idle" | "syncing" | "done"; done: number; total: number };

export function useWhatsApp(session?: Session, onSyncComplete?: () => void) {
  const [waStatus, setWaStatus] = useState<string>("UNKNOWN");
  const [waMetadata, setWaMetadata] = useState<Record<string, any>>({});
  const [waQr, setWaQr] = useState<string | null>(null);
  const [waLogoutLoading, setWaLogoutLoading] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>({ status: "idle", done: 0, total: 0 });
  const [error, setError] = useState<string>();

  const refreshWhatsappStatus = useCallback(async (token: string) => {
    try {
      const { status, connectedAt, lastDisconnectReason, syncProgress } = await api.whatsappStatus(token);
      setWaStatus(status);
      setWaMetadata({ connectedAt, lastDisconnectReason, syncProgress });
      if (syncProgress && syncProgress.total > 0) {
        setSyncState({ status: "syncing", ...syncProgress });
      }
      if (status === "QR_REQUIRED") {
        api.whatsappQr(token)
          .then((qr) => setWaQr(qr.qr))
          .catch(() => undefined);
      }
    } catch (err) {
      // Ignored initially
    }
  }, []);

  // Fetch status automatically when session is established
  useEffect(() => {
    if (session?.token) {
      refreshWhatsappStatus(session.token);
      const pollId = window.setInterval(() => {
        refreshWhatsappStatus(session.token);
      }, 10_000);
      return () => window.clearInterval(pollId);
    } else {
      setWaStatus("UNKNOWN");
      setWaMetadata({});
      setWaQr(null);
      setSyncState({ status: "idle", done: 0, total: 0 });
    }
  }, [session?.token, refreshWhatsappStatus]);

  const handleWaLogout = useCallback(async () => {
    if (!session || waLogoutLoading) return;
    setWaLogoutLoading(true);
    try {
      await api.logoutWhatsApp(session.token);
      setWaLogoutLoading(false);
    } catch (err: unknown) {
      setError((err as Error).message);
      setWaLogoutLoading(false);
    }
  }, [session, waLogoutLoading]);

  const canSyncWhatsapp = waStatus === "CONNECTED" && syncState.status !== "syncing";

  const handleSyncWhatsapp = useCallback(async () => {
    if (!session) return false;
    if (waStatus !== "CONNECTED") {
      setError("Connect WhatsApp before syncing chats");
      return false;
    }
    if (syncState.status === "syncing") return false;

    try {
      setError(undefined);
      setSyncState({ status: "syncing", done: 0, total: 0 });
      await api.triggerSync(session.token);
      return true;
    } catch (err: unknown) {
      setSyncState({ status: "idle", done: 0, total: 0 });
      setError((err as Error).message || "Failed to sync WhatsApp chats");
      return false;
    }
  }, [session, waStatus, syncState.status]);

  const waUiStatus = useMemo((): "ready" | "busy" | "offline" | "unknown" => {
    switch (waStatus) {
      case "CONNECTED":
        return "ready";
      case "INITIALISING":
      case "AUTHENTICATING":
      case "HYDRATING":
      case "SYNCING":
        return "busy";
      case "DISCONNECTED":
      case "FAILED":
        return "offline";
      default:
        return "unknown";
    }
  }, [waStatus]);

  const socketEvents = useMemo(
    () => [
      { event: "sync:started", handler: () => setSyncState({ status: "syncing", done: 0, total: 0 }) },
      {
        event: "sync:progress",
        handler: (p: any) => setSyncState({ status: "syncing", ...(p as { total: number; done: number }) }),
      },
      {
        event: "sync:complete",
        handler: (p: any) => {
          setSyncState({ status: "done", ...(p as { total: number; done: number }) });
          onSyncComplete?.();
        },
      },
      {
        event: "wajs:status",
        handler: (p: any) => {
          setWaStatus(p.status);
          setWaMetadata({
            connectedAt: p.connectedAt,
            lastDisconnectReason: p.lastDisconnectReason,
            syncProgress: p.syncProgress,
          });
          if (p.syncProgress && p.syncProgress.total > 0) {
            setSyncState({ status: "syncing", ...p.syncProgress });
          }
          if (p.status === "CONNECTED" || p.status === "DISCONNECTED" || p.status === "FAILED") {
            setWaQr(null);
          }
        },
      },
      {
        event: "wajs:qr",
        handler: (p: any) => {
          setWaQr((p as { qr: string }).qr);
          setWaStatus("QR_REQUIRED");
          setWaLogoutLoading(false);
        },
      },
      {
        event: "wajs:logout",
        handler: () => {
          setWaStatus("DISCONNECTED");
          setWaQr(null);
          setWaMetadata({});
        },
      },
    ],
    [onSyncComplete]
  );

  return {
    waStatus,
    waUiStatus,
    waMetadata,
    waQr,
    waLogoutLoading,
    syncState,
    canSyncWhatsapp,
    handleWaLogout,
    handleSyncWhatsapp,
    socketEvents,
    error,
    setError,
  };
}
