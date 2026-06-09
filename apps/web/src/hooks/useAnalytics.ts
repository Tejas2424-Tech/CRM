import { useEffect, useState } from "react";
import { api, type Session } from "../api";

export function useAnalytics(session: Session | undefined, canManage: boolean) {
  const [analytics, setAnalytics] = useState<Awaited<ReturnType<typeof api.analytics>>>();
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(false);

  useEffect(() => {
    if (!session) return;

    if (canManage) {
      setIsAnalyticsLoading(true);
      api
        .analytics(session.token)
        .then(setAnalytics)
        .catch(() => undefined)
        .finally(() => setIsAnalyticsLoading(false));
    }
  }, [session, canManage]);

  return {
    analytics,
    isAnalyticsLoading,
  };
}
