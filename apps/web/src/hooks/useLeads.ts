import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LeadDTO } from "@crm/shared";
import { api, type Session } from "../api";
import { uniqueById } from "../utils";

export type FilterState = { search: string; status: string; tag: string; assignedTo: string; unread: string };

export function useLeads(session?: Session) {
  const [leads, setLeads] = useState<LeadDTO[]>([]);
  const [isLeadsLoading, setIsLeadsLoading] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string>();
  const [filters, setFilters] = useState<FilterState>({ search: "", status: "", tag: "", assignedTo: "", unread: "" });
  const [leadForm, setLeadForm] = useState({ name: "", phone: "", email: "" });
  const loadGenRef = useRef(0);
  const [error, setError] = useState<string>();

  const loadLeads = useCallback(() => {
    if (!session) return;
    const gen = ++loadGenRef.current;
    setIsLeadsLoading(true);
    api
      .leads(session.token, filters)
      .then((items) => {
        if (gen !== loadGenRef.current) return;
        setLeads(uniqueById(items));
        setSelectedLeadId((cur) => cur ?? items[0]?.id);
      })
      .catch((err) => { if (gen === loadGenRef.current) setError(err.message); })
      .finally(() => { if (gen === loadGenRef.current) setIsLeadsLoading(false); });
  }, [session, filters]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  const updateLead = useCallback(
    async (lead: LeadDTO, patch: Partial<LeadDTO>) => {
      if (!session) return;
      try {
        const payload: Record<string, any> = { ...patch };
        if (payload.status) {
          payload.stage = payload.status;
          delete payload.status;
        }
        const updated = await api.updateLead(session.token, lead.id, payload as Partial<LeadDTO>);
        setLeads((items) => items.map((i) => (i.id === updated.id ? updated : i)));
      } catch (err: any) {
        setError(err.message);
      }
    },
    [session]
  );

  const createLead = useCallback(async () => {
    if (!session || !leadForm.phone) return;
    try {
      const lead = await api.createLead(session.token, { ...leadForm, status: "new", tags: [], source: "manual" });
      setLeads((items) => uniqueById([lead, ...items]));
      setSelectedLeadId(lead.id);
      setLeadForm({ name: "", phone: "", email: "" });
      return lead;
    } catch (err: any) {
      setError(err.message);
      throw err;
    }
  }, [session, leadForm]);

  const socketEvents = useMemo(
    () => [
      {
        event: "lead:new",
        handler: (lead: any) => {
          const incoming = lead as LeadDTO;
          // Agents only own their assigned leads — drop updates for others
          if (session?.user.role === "agent" && incoming.assignedTo !== session.user.id) return;
          setLeads((items) => {
            const others = items.filter((i) => i.id !== incoming.id);
            return [incoming, ...others].sort((a, b) => {
              const aTime = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
              const bTime = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
              return bTime - aTime;
            });
          });
        },
      },
      {
        event: "lead:update",
        handler: (lead: any) => {
          const incoming = lead as LeadDTO;
          // Agents only own their assigned leads — drop updates for others
          if (session?.user.role === "agent" && incoming.assignedTo !== session.user.id) return;
          setLeads((items) => {
            const others = items.filter((i) => i.id !== incoming.id);
            return [incoming, ...others].sort((a, b) => {
              const aTime = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
              const bTime = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
              return bTime - aTime;
            });
          });
        },
      },
    ],
    [session?.user.role, session?.user.id]
  );

  return {
    leads,
    isLeadsLoading,
    selectedLeadId,
    setSelectedLeadId,
    filters,
    setFilters,
    leadForm,
    setLeadForm,
    updateLead,
    createLead,
    loadLeads,
    socketEvents,
    error,
    setError,
  };
}
