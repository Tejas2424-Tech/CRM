import { useEffect, useState } from "react";
import type { CampaignDTO, TemplateDTO } from "@crm/shared";
import { api, type Session } from "../api";

export function useAnalytics(session: Session | undefined, canManage: boolean) {
  const [templates, setTemplates] = useState<TemplateDTO[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignDTO[]>([]);
  const [analytics, setAnalytics] = useState<Awaited<ReturnType<typeof api.analytics>>>();
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(false);

  useEffect(() => {
    if (!session) return;
    api
      .templates(session.token)
      .then(setTemplates)
      .catch(() => undefined);

    if (canManage) {
      api
        .campaigns(session.token)
        .then(setCampaigns)
        .catch(() => undefined);
      
      setIsAnalyticsLoading(true);
      api
        .analytics(session.token)
        .then(setAnalytics)
        .catch(() => undefined)
        .finally(() => setIsAnalyticsLoading(false));
    }
  }, [session, canManage]);

  return {
    templates,
    campaigns,
    analytics,
    isAnalyticsLoading,
  };
}
