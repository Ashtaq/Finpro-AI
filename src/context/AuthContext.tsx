import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../lib/api";
import { Meta, ProfessionalRole, Role, User } from "../types";

export type Permission =
  | "dashboard"
  | "clients"
  | "projects"
  | "documents"
  | "ai"
  | "analysis"
  | "reports"
  | "tasks"
  | "compliance"
  | "knowledge"
  | "analytics"
  | "team"
  | "audit"
  | "settings"
  | "individual"
  | "assets"
  | "itr";

// Mirrors server-side role checks; the server is the source of truth.
const PERMISSIONS: Record<Role, Set<Permission>> = {
  "Professional User": new Set([
    "dashboard",
    "clients",
    "projects",
    "documents",
    "ai",
    "analysis",
    "reports",
    "tasks",
    "compliance",
    "knowledge",
    "analytics",
    "team",
    "audit",
    "settings",
  ]),
  "Finance User": new Set(["dashboard", "projects", "documents", "ai", "analysis", "reports", "tasks", "analytics", "settings"]),
  Individual: new Set(["individual", "assets", "documents", "ai", "itr", "reports", "settings"]),
};

/** True when this user must finish DigiLocker verification before using tax features. */
export const needsKyc = (user: User | null, meta: Meta | null) =>
  Boolean(user && meta?.kyc.required && user.role === "Individual" && user.kycStatus !== "VERIFIED");

export interface SignupInput {
  name: string;
  email: string;
  password: string;
  role: Role;
  professionalRole: ProfessionalRole;
  organizationName?: string;
  acceptTerms: boolean;
  pan?: string;
  dob?: string;
}

interface AuthValue {
  user: User | null;
  meta: Meta | null;
  loading: boolean;
  /** True while the API is unreachable during start-up; the app keeps retrying. */
  offline: boolean;
  login: (email: string, password: string) => Promise<User>;
  signup: (input: SignupInput) => Promise<User>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
  refreshUser: () => Promise<void>;
  can: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Only a 401 means "signed out". If the API is unreachable (restarting, deploy, network blip)
    // keep retrying instead of dropping the user on the login page.
    const bootstrap = async (attempt = 0) => {
      const [me, m] = await Promise.allSettled([api.get<{ user: User }>("/auth/me"), api.get<Meta>("/meta")]);
      if (!alive) return;
      const transient = me.status === "rejected" && me.reason instanceof ApiError && (me.reason.status === 0 || me.reason.status >= 500);
      if (transient) {
        setOffline(true);
        timer = setTimeout(() => void bootstrap(attempt + 1), Math.min(1000 * 2 ** attempt, 8000));
        return;
      }
      setOffline(false);
      if (me.status === "fulfilled") setUser(me.value.user);
      if (m.status === "fulfilled") setMeta(m.value);
      setLoading(false);
    };
    void bootstrap();
    const onUnauthorized = () => setUser(null);
    window.addEventListener("finpro:unauthorized", onUnauthorized);
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener("finpro:unauthorized", onUnauthorized);
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { user } = await api.post<{ user: User }>("/auth/login", { email, password });
    setUser(user);
    return user;
  }, []);

  const signup = useCallback(async (input: SignupInput) => {
    const { user } = await api.post<{ user: User }>("/auth/signup", { ...input });
    setUser(user);
    return user;
  }, []);

  const refreshUser = useCallback(async () => {
    const { user } = await api.get<{ user: User }>("/auth/me");
    setUser(user);
  }, []);

  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => undefined);
    setUser(null);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ user, meta, loading, offline, login, signup, logout, setUser, refreshUser, can: (p) => !!user && PERMISSIONS[user.role].has(p) }),
    [user, meta, loading, offline, login, signup, logout, refreshUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export const homePath = (role: Role) => (role === "Individual" ? "/individual" : "/");

/** Where to send a user after sign-in: identity verification first when it is required. */
export const landingPath = (user: User, meta: Meta | null) => (needsKyc(user, meta) ? "/verify-identity" : homePath(user.role));
