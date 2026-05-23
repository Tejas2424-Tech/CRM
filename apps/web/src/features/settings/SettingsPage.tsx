import { QRCodeSVG } from "qrcode.react";
import { SectionTitle } from "../../components";

interface Props {
  waStatus: string;
  waMetadata: { connectedAt?: string; lastDisconnectReason?: string; syncProgress?: { total: number; done: number } };
  waQr: string | null;
  waLogoutLoading: boolean;
  crmResetState: string;
  onLogout: () => void;
  onSync: () => void;
  onResetCrm: () => void;
  canAdmin: boolean;
}

export function SettingsPage({ waStatus, waMetadata, waQr, waLogoutLoading, crmResetState, onLogout, onSync, onResetCrm, canAdmin }: Props) {
  const isConnected = waStatus === "CONNECTED";
  const isQrPending = waStatus === "QR_REQUIRED";
  const isSyncing = waStatus === "SYNCING" || waStatus === "HYDRATING";
  const isLoading = waLogoutLoading || waStatus === "INITIALISING" || waStatus === "AUTHENTICATING" || isSyncing;

  const statusColor = isConnected ? "#25d366" : isQrPending ? "#f59e0b" : isSyncing ? "#3b82f6" : "#ef4444";
  const statusLabel = ({ 
    CONNECTED: "Connected", 
    QR_REQUIRED: "Waiting for QR scan", 
    AUTHENTICATING: "Authenticating…", 
    HYDRATING: "Hydrating Data…",
    SYNCING: "Syncing Chats…", 
    DISCONNECTED: "Disconnected", 
    INITIALISING: "Initialising…",
    FAILED: "Failed"
  } as Record<string, string>)[waStatus] ?? waStatus;

  return (
    <div className="settings-grid">
      {/* ── WhatsApp Connection ── */}
      <section className="panel" style={{ gridColumn: "span 2" }}>
        <SectionTitle title="WhatsApp Connection" />
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: statusColor, flexShrink: 0, boxShadow: `0 0 6px ${statusColor}` }} />
          <strong style={{ color: statusColor }}>{statusLabel}</strong>
        </div>

        {isQrPending && waQr && (
          <div style={{ background: "#fff", borderRadius: 8, padding: 16, display: "inline-block", marginBottom: 16 }}>
            <p style={{ color: "#111", marginBottom: 16, fontWeight: 600, fontSize: 13, textAlign: "center" }}>Scan with WhatsApp to connect</p>
            <div style={{ background: "#fff", padding: 8, display: "flex", justifyContent: "center" }}>
              <QRCodeSVG value={waQr} size={200} level="M" includeMargin={false} />
            </div>
            <p style={{ color: "#555", fontSize: 11, marginTop: 16, textAlign: "center" }}>Open WhatsApp › Linked Devices › Link a Device</p>
          </div>
        )}

        {(isConnected || isQrPending) && (
          <button id="wa-logout-btn" onClick={onLogout} disabled={isLoading} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 6, background: isLoading ? "#555" : "#dc2626", color: "#fff", border: "none", cursor: isLoading ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 13, transition: "background 0.2s" }}>
            {isLoading ? (
              <><span style={{ width: 14, height: 14, border: "2px solid #fff", borderTop: "2px solid transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite", display: "inline-block" }} />{waLogoutLoading ? "Logging out…" : statusLabel}</>
            ) : <>Logout WhatsApp</>}
          </button>
        )}

        {waStatus === "DISCONNECTED" && !waLogoutLoading && (
          <p style={{ color: "#f59e0b", fontSize: 13, marginTop: 8 }}>Disconnected — reconnecting automatically in exponential backoff…</p>
        )}

        {waStatus === "FAILED" && waMetadata.lastDisconnectReason && (
          <p style={{ color: "#ef4444", fontSize: 13, marginTop: 8 }}>Failure reason: {waMetadata.lastDisconnectReason}</p>
        )}

        {isSyncing && waMetadata.syncProgress && waMetadata.syncProgress.total > 0 && (
          <div style={{ marginTop: 12, background: "rgba(255,255,255,0.05)", borderRadius: 8, padding: 12 }}>
             <p style={{ fontSize: 12, color: "#aaa", marginBottom: 6 }}>WhatsApp is syncing your historical chats…</p>
             <div style={{ height: 4, background: "#333", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", background: "#3b82f6", width: `${(waMetadata.syncProgress.done / waMetadata.syncProgress.total) * 100}%`, transition: "width 0.3s" }} />
             </div>
             <p style={{ fontSize: 11, color: "#666", marginTop: 4 }}>{waMetadata.syncProgress.done} / {waMetadata.syncProgress.total} chats processed</p>
          </div>
        )}

        {isConnected && (
          <div style={{ marginTop: 16 }}>
            {waMetadata.connectedAt && <p style={{ fontSize: 11, color: "#666", marginBottom: 8 }}>Connected since: {new Date(waMetadata.connectedAt).toLocaleString()}</p>}
            <button id="wa-sync-btn" onClick={onSync} style={{ padding: "7px 14px", borderRadius: 6, background: "transparent", color: "#25d366", border: "1px solid #25d366", cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
              ↺  Re-sync Contacts & Chats
            </button>
          </div>
        )}
      </section>

      {/* ── Assignment Rules ── */}
      <section className="panel">
        <SectionTitle title="Assignment Rules" />
        <label><input type="checkbox" defaultChecked /> Round-robin new leads</label>
        <label><input type="checkbox" defaultChecked /> Tag support leads for support agents</label>
        <label><input type="checkbox" /> Require manager approval before marking lost</label>
      </section>

      {/* ── Notifications ── */}
      <section className="panel">
        <SectionTitle title="Notifications" />
        <label><input type="checkbox" defaultChecked /> New WhatsApp message alerts</label>
        <label><input type="checkbox" defaultChecked /> Follow-up reminders</label>
        <label><input type="checkbox" defaultChecked /> Overdue task escalation</label>
      </section>

      {/* ── Danger Zone ── */}
      {canAdmin && (
        <section className="panel span-3" style={{ border: "1px solid #ef4444" }}>
          <SectionTitle title="Danger Zone" />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <p style={{ margin: "0 0 4px", fontWeight: 600, color: "#111" }}>Factory Reset CRM</p>
              <p style={{ margin: 0, color: "#666", fontSize: 13 }}>Permanently deletes all contacts, chats, messages, and active WhatsApp sessions.</p>
            </div>
            <button onClick={onResetCrm} disabled={crmResetState !== "idle"} style={{ background: crmResetState !== "idle" ? "#fee2e2" : "#ef4444", color: crmResetState !== "idle" ? "#dc2626" : "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontWeight: 600, fontSize: 13, cursor: crmResetState !== "idle" ? "not-allowed" : "pointer" }}>
              {crmResetState === "idle" ? "Reset CRM" : `Resetting (${crmResetState})…`}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
