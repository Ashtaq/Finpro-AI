import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
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

export interface SignupInput {
  name: string;
  email: string;
  password: string;
  role: Role;
  professionalRole: ProfessionalRole;
  organizationName?: string;
  acceptTerms: boolean;
}

interface AuthValue {
  user: User | null;
  meta: Meta | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  signup: (input: SignupInput) => Promise<User>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
  can: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([api.get<{ user: User }>("/auth/me"), api.get<Meta>("/meta")]).then(([me, m]) => {
      if (!alive) return;
      if (me.status === "fulfilled") setUser(me.value.user);
      if (m.status === "fulfilled") setMeta(m.value);
      setLoading(false);
    });
    const onUnauthorized = () => setUser(null);
    window.addEventListener("finpro:unauthorized", onUnauthorized);
    return () => {
      alive = false;
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

  const logout = useCallback(async () => {
    await api.post("/auth/logout").catch(() => undefined);
    setUser(null);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ user, meta, loading, login, signup, logout, setUser, can: (p) => !!user && PERMISSIONS[user.role].has(p) }),
    [user, meta, loading, login, signup, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export const homePath = (role: Role) => (role === "Individual" ? "/individual" : "/");
