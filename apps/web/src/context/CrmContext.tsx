import React, { createContext, useContext, useEffect, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { useLeads } from "../hooks/useLeads";
import { useInbox } from "../hooks/useInbox";
import { useTasks } from "../hooks/useTasks";
import { useWhatsApp } from "../hooks/useWhatsApp";
import { useAnalytics } from "../hooks/useAnalytics";
import { useFollowupPlans } from "../hooks/useFollowupPlans";
import { useBulkCampaigns } from "../hooks/useBulkCampaigns";
import { useSocket } from "../hooks/useSocket";
import { api } from "../api";

// We construct a type from the return types of our hooks
type AuthContextType = ReturnType<typeof useAuth>;
type LeadsContextType = ReturnType<typeof useLeads>;
type InboxContextType = ReturnType<typeof useInbox>;
type TasksContextType = ReturnType<typeof useTasks>;
type WhatsAppContextType = ReturnType<typeof useWhatsApp>;
type AnalyticsContextType = ReturnType<typeof useAnalytics>;
type FollowupPlansContextType = ReturnType<typeof useFollowupPlans>;
type BulkCampaignsContextType = ReturnType<typeof useBulkCampaigns>;

interface CrmContextType {
  auth: AuthContextType;
  leads: LeadsContextType;
  inbox: InboxContextType;
  tasks: TasksContextType;
  whatsapp: WhatsAppContextType;
  analytics: AnalyticsContextType;
  followupPlans: FollowupPlansContextType;
  campaigns: BulkCampaignsContextType;
  resetCrm: () => Promise<void>;
  crmResetState: string;
  globalError?: string;
  setGlobalError: (err: string | undefined) => void;
}

const CrmContext = createContext<CrmContextType | null>(null);

export function CrmProvider({ children }: { children: React.ReactNode }) {
  const [globalError, setGlobalError] = useState<string>();
  const [crmResetState, setCrmResetState] = useState<string>("idle");

  const auth = useAuth();
  const leads = useLeads(auth.session);
  const inbox = useInbox(
    auth.session,
    leads.selectedLeadId,
    (id) => leads.updateLead(leads.leads.find(l => l.id === id)!, { unreadCount: 0 })
  );
  const tasks = useTasks(auth.session, leads.filters, leads.selectedLeadId);
  const whatsapp = useWhatsApp(auth.session);
  const analytics = useAnalytics(auth.session, auth.canManage);
  const followupPlans = useFollowupPlans(auth.session);
  const campaigns = useBulkCampaigns(auth.session);

  // Wire socket events to the correct stores
  const socketEvents = [
    ...leads.socketEvents,
    ...inbox.socketEvents,
    ...tasks.socketEvents,
    ...whatsapp.socketEvents,
    ...followupPlans.socketEvents,
    ...campaigns.socketEvents,
    {
      event: "crm:reset",
      handler: (p: any) => {
        const ev = p as { phase: string; error?: string };
        if (ev.phase === "complete") window.location.reload();
        else if (ev.phase === "error") {
          setCrmResetState("idle");
          setGlobalError(ev.error ?? "Failed to reset CRM");
        } else {
          setCrmResetState(ev.phase);
        }
      },
    },
  ];

  useSocket(!!auth.session, socketEvents);

  // Propagate hook errors to global error
  useEffect(() => {
    if (auth.error) setGlobalError(auth.error);
    if (leads.error) setGlobalError(leads.error);
    if (inbox.error) setGlobalError(inbox.error);
    if (tasks.error) setGlobalError(tasks.error);
    if (whatsapp.error) setGlobalError(whatsapp.error);
    if (followupPlans.error) setGlobalError(followupPlans.error);
    if (campaigns.error) setGlobalError(campaigns.error);
  }, [auth.error, leads.error, inbox.error, tasks.error, whatsapp.error, followupPlans.error, campaigns.error]);

  const resetCrm = async () => {
    if (!auth.session || crmResetState !== "idle") return;
    if (
      !window.confirm(
        "DANGER: This will permanently delete ALL chats, contacts, messages, and WhatsApp sessions. The CRM will return to a clean state. Are you sure?"
      )
    )
      return;
    setCrmResetState("starting");
    try {
      await api.resetCrm(auth.session.token);
    } catch (err: unknown) {
      setGlobalError((err as Error).message);
      setCrmResetState("idle");
    }
  };

  return (
    <CrmContext.Provider
      value={{
        auth,
        leads,
        inbox,
        tasks,
        whatsapp,
        analytics,
        followupPlans,
        campaigns,
        resetCrm,
        crmResetState,
        globalError,
        setGlobalError,
      }}
    >
      {children}
    </CrmContext.Provider>
  );
}

export const useCrm = () => {
  const ctx = useContext(CrmContext);
  if (!ctx) throw new Error("useCrm must be used within CrmProvider");
  return ctx;
};
