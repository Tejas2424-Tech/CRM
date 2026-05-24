import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentDTO } from "@crm/shared";
import { api, ApiError, type Session } from "../api";
import { uniqueById } from "../utils";

const DEV_USERS_CACHE_KEY = "crm:dev-users";
const SESSION_CACHE_KEY = "crm:session";
const AUTH_429_UNTIL_KEY = "crm:auth-429-until";

type AuthCache = {
  devUsers?: AgentDTO[];
  devUsersRequest?: Promise<AgentDTO[]>;
};

function authCache(): AuthCache {
  const root = globalThis as typeof globalThis & { __crmAuthCache?: AuthCache };
  root.__crmAuthCache ??= {};
  return root.__crmAuthCache;
}

function readJsonCache<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJsonCache(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be disabled; auth still works through in-memory state.
  }
}

function authRetryBlocked() {
  const retryAt = Number(sessionStorage.getItem(AUTH_429_UNTIL_KEY) ?? 0);
  return Number.isFinite(retryAt) && retryAt > Date.now();
}

function rememberAuth429() {
  const until = Date.now() + 60_000;
  sessionStorage.setItem(AUTH_429_UNTIL_KEY, String(until));
  console.warn("[Auth] Rate limit hit — requests blocked until", new Date(until).toISOString());
}

function purgeStaleCaches() {
  // Remove an expired 429 block so stale cooldowns don't prevent the next load.
  const retryAt = Number(sessionStorage.getItem(AUTH_429_UNTIL_KEY) ?? 0);
  if (retryAt && retryAt <= Date.now()) {
    sessionStorage.removeItem(AUTH_429_UNTIL_KEY);
  }
  // If the in-memory cache was cleared (e.g. page reload) but sessionStorage still
  // holds data from a previous session, wipe it so users are re-fetched fresh.
  if (!authCache().devUsers) {
    sessionStorage.removeItem(DEV_USERS_CACHE_KEY);
  }
}

function loadDevUsersOnce() {
  const cache = authCache();
  if (cache.devUsers) return Promise.resolve(cache.devUsers);

  const stored = readJsonCache<AgentDTO[]>(DEV_USERS_CACHE_KEY);
  if (stored?.length) {
    cache.devUsers = stored;
    return Promise.resolve(stored);
  }

  if (authRetryBlocked()) {
    console.warn("[Auth] Skipping fetch — rate limit cooldown active");
    return Promise.reject(new Error("Auth rate limit is cooling down. Please wait a minute, then refresh."));
  }

  if (!cache.devUsersRequest) {
    cache.devUsersRequest = api
      .devUsers()
      .then((users) => {
        cache.devUsers = users;
        writeJsonCache(DEV_USERS_CACHE_KEY, users);
        sessionStorage.removeItem(AUTH_429_UNTIL_KEY);
        return users;
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 429) rememberAuth429();
        throw err;
      })
      .finally(() => {
        cache.devUsersRequest = undefined;
      });
  }
  return cache.devUsersRequest;
}

function authLoadErrorMessage(err: unknown) {
  if (err instanceof ApiError && err.status === 408) {
    return `Could not load users. Check that the API is running at ${api.apiUrl}.`;
  }
  return err instanceof Error ? err.message : "Failed to load dashboard data";
}

export function useAuth() {
  const [session, setSession] = useState<Session>();
  const [agents, setAgents] = useState<AgentDTO[]>([]);
  const [authLoading, setAuthLoading] = useState(false);
  const [error, setError] = useState<string>();
  const loginInFlightRef = useRef<string | null>(null);

  useEffect(() => {
    const bootstrap = async () => {
      purgeStaleCaches();
      const startedAt = Date.now();
      console.log(`[Auth] Bootstrap start: loading dev users from ${api.apiUrl}/auth/dev-users`);
      try {
        setAuthLoading(true);
        setError(undefined);
        const storedSession = readJsonCache<Session>(SESSION_CACHE_KEY);
        if (storedSession) {
          setSession(storedSession);
        }

        const users = await loadDevUsersOnce();
        console.log(`[Auth] Bootstrap success: ${users.length} users loaded in ${Date.now() - startedAt}ms`);
        setAgents(uniqueById(users));
      } catch (err: any) {
        console.error(`[Auth] Bootstrap failed after ${Date.now() - startedAt}ms`, err);
        setError(authLoadErrorMessage(err));
      } finally {
        setAuthLoading(false);
        console.log("[Auth] authLoading cleared");
      }
    };

    bootstrap();
  }, []);

  const loginAs = useCallback(
    async (email: string) => {
      if (authRetryBlocked()) {
        setError("Auth rate limit is cooling down. Please wait a minute, then try again.");
        return;
      }
      const targetAgent = agents.find((agent) => agent.email === email);
      if (loginInFlightRef.current === email || targetAgent?.id === session?.user.id) return;
      loginInFlightRef.current = email;
      setAuthLoading(true);
      setError(undefined);
      try {
        const nextSession = await api.login(email);
        setSession(nextSession);
        writeJsonCache(SESSION_CACHE_KEY, nextSession);
        sessionStorage.removeItem(AUTH_429_UNTIL_KEY);
      } catch (err: unknown) {
        if (err instanceof ApiError && err.status === 429) rememberAuth429();
        setError(authLoadErrorMessage(err));
      } finally {
        loginInFlightRef.current = null;
        setAuthLoading(false);
      }
    },
    [agents, session?.user.id]
  );

  const logout = useCallback(() => {
    sessionStorage.removeItem(SESSION_CACHE_KEY);
    setSession(undefined);
  }, []);

  const canManage = session?.user.role === "manager" || session?.user.role === "admin";
  const canAdmin = session?.user.role === "admin";
  const currentAgent = useMemo(
    () => agents.find((a) => a.id === session?.user.id),
    [agents, session?.user.id]
  );

  return {
    session,
    agents,
    setAgents, // Used by Team module to add agents
    authLoading,
    error,
    setError,
    loginAs,
    logout,
    canManage,
    canAdmin,
    currentAgent,
  };
}
