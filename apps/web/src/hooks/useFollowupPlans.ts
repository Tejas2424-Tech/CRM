import { useCallback, useEffect, useMemo, useState } from "react";
import type { FollowupEnrollmentDTO, FollowupPlanDTO } from "@crm/shared";
import { api, type Session } from "../api";
import { uniqueById } from "../utils";

export function useFollowupPlans(session: Session | undefined) {
  const [plans, setPlans] = useState<FollowupPlanDTO[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();
  // Map of leadId → enrollment (undefined = not yet fetched, null = no active enrollment)
  const [enrollmentCache, setEnrollmentCache] = useState<
    Map<string, FollowupEnrollmentDTO | null>
  >(new Map());

  const loadPlans = useCallback(async () => {
    if (!session) return;
    setIsLoading(true);
    try {
      const fetched = await api.followupPlans(session.token);
      setPlans(uniqueById(fetched));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  const createPlan = useCallback(
    async (body: Omit<FollowupPlanDTO, "id" | "createdBy" | "createdAt" | "updatedAt">) => {
      if (!session) return;
      try {
        const plan = await api.createFollowupPlan(session.token, body);
        setPlans((prev) => uniqueById([plan, ...prev]));
        return plan;
      } catch (err: any) {
        setError(err.message);
        throw err;
      }
    },
    [session]
  );

  const updatePlan = useCallback(
    async (id: string, body: Partial<FollowupPlanDTO>) => {
      if (!session) return;
      try {
        const updated = await api.updateFollowupPlan(session.token, id, body);
        setPlans((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        return updated;
      } catch (err: any) {
        setError(err.message);
        throw err;
      }
    },
    [session]
  );

  const deletePlan = useCallback(
    async (id: string) => {
      if (!session) return;
      try {
        await api.deleteFollowupPlan(session.token, id);
        setPlans((prev) => prev.filter((p) => p.id !== id));
      } catch (err: any) {
        setError(err.message);
        throw err;
      }
    },
    [session]
  );

  const loadEnrollmentForLead = useCallback(
    async (leadId: string) => {
      if (!session) return null;
      try {
        const enrollment = await api.getEnrollmentForLead(session.token, leadId);
        setEnrollmentCache((prev) => new Map(prev).set(leadId, enrollment));
        return enrollment;
      } catch (err: any) {
        setError(err.message);
        return null;
      }
    },
    [session]
  );

  const enrollLead = useCallback(
    async (leadId: string, planId: string) => {
      if (!session) return;
      try {
        const enrollment = await api.enrollLead(session.token, leadId, planId);
        setEnrollmentCache((prev) => new Map(prev).set(leadId, enrollment));
        return enrollment;
      } catch (err: any) {
        setError(err.message);
        throw err;
      }
    },
    [session]
  );

  const stopLeadEnrollment = useCallback(
    async (leadId: string) => {
      if (!session) return;
      try {
        await api.stopLeadEnrollment(session.token, leadId);
        setEnrollmentCache((prev) => new Map(prev).set(leadId, null));
      } catch (err: any) {
        setError(err.message);
        throw err;
      }
    },
    [session]
  );

  const socketEvents = useMemo(
    () => [
      {
        event: "followup:stopped",
        handler: (payload: any) => {
          const { leadId } = payload as { leadId: string };
          setEnrollmentCache((prev) => new Map(prev).set(leadId, null));
        }
      },
      {
        event: "followup:step_sent",
        handler: (payload: any) => {
          const { leadId } = payload as { leadId: string };
          // Invalidate — next time EnrollmentPanel renders it will re-fetch
          setEnrollmentCache((prev) => {
            const next = new Map(prev);
            next.delete(leadId);
            return next;
          });
        }
      }
    ],
    []
  );

  return {
    plans,
    isLoading,
    error,
    setError,
    loadPlans,
    createPlan,
    updatePlan,
    deletePlan,
    enrollmentCache,
    loadEnrollmentForLead,
    enrollLead,
    stopLeadEnrollment,
    socketEvents
  };
}
