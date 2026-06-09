import { useCallback, useEffect, useMemo, useState } from "react";
import type { CampaignDTO, CampaignProgress } from "@crm/shared";
import { api, type Session } from "../api";

export function useBulkCampaigns(session: Session | undefined) {
  const [campaigns, setCampaigns] = useState<CampaignDTO[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();

  const loadCampaigns = useCallback(async () => {
    if (!session) return;
    setIsLoading(true);
    try {
      const fetched = await api.campaigns(session.token);
      setCampaigns(fetched);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  const createCampaign = useCallback(
    async (body: object) => {
      if (!session) return;
      const campaign = await api.createCampaign(session.token, body);
      setCampaigns((prev) => [campaign, ...prev]);
      return campaign;
    },
    [session]
  );

  const updateCampaign = useCallback(
    async (id: string, body: Partial<CampaignDTO>) => {
      if (!session) return;
      const updated = await api.updateCampaign(session.token, id, body);
      setCampaigns((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      return updated;
    },
    [session]
  );

  const deleteCampaign = useCallback(
    async (id: string) => {
      if (!session) return;
      await api.deleteCampaign(session.token, id);
      setCampaigns((prev) => prev.filter((c) => c.id !== id));
    },
    [session]
  );

  const launchCampaign = useCallback(
    async (id: string) => {
      if (!session) return;
      const updated = await api.launchCampaign(session.token, id);
      setCampaigns((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      return updated;
    },
    [session]
  );

  const pauseCampaign = useCallback(
    async (id: string) => {
      if (!session) return;
      const updated = await api.pauseCampaign(session.token, id);
      setCampaigns((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      return updated;
    },
    [session]
  );

  const cancelCampaign = useCallback(
    async (id: string) => {
      if (!session) return;
      const updated = await api.cancelCampaign(session.token, id);
      setCampaigns((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
      return updated;
    },
    [session]
  );

  const socketEvents = useMemo(
    () => [
      {
        event: "campaign:started",
        handler: (payload: any) => {
          const c = payload as CampaignDTO;
          setCampaigns((prev) =>
            prev.some((x) => x.id === c.id)
              ? prev.map((x) => (x.id === c.id ? c : x))
              : [c, ...prev]
          );
        }
      },
      {
        event: "campaign:progress",
        handler: (payload: any) => {
          const { campaignId, progress } = payload as { campaignId: string; progress: CampaignProgress };
          setCampaigns((prev) =>
            prev.map((c) => (c.id === campaignId ? { ...c, progress } : c))
          );
        }
      },
      {
        event: "campaign:completed",
        handler: (payload: any) => {
          const c = payload as CampaignDTO;
          setCampaigns((prev) => prev.map((x) => (x.id === c.id ? c : x)));
        }
      },
      {
        event: "campaign:paused",
        handler: (payload: any) => {
          const c = payload as CampaignDTO;
          setCampaigns((prev) => prev.map((x) => (x.id === c.id ? c : x)));
        }
      },
      {
        event: "campaign:cancelled",
        handler: (payload: any) => {
          const c = payload as CampaignDTO;
          setCampaigns((prev) => prev.map((x) => (x.id === c.id ? c : x)));
        }
      }
    ],
    []
  );

  return {
    campaigns,
    isLoading,
    error,
    setError,
    loadCampaigns,
    createCampaign,
    updateCampaign,
    deleteCampaign,
    launchCampaign,
    pauseCampaign,
    cancelCampaign,
    socketEvents
  };
}
