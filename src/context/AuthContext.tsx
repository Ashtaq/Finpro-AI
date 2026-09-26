import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { Role, User } from "../types";
import { demoUsers } from "../data/mockData";
import * as api from "../services/mockApi";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string, role: Role) => Promise<void>;
  signup: (name: string, email: string, professionalRole: User["professionalRole"]) => Promise<void>;
  logout: () => void;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const permissions: Record<Role, Set<string>> = {
  "Super Admin": new Set(["platform", "orgs", "team", "clients", "projects", "documents", "ai", "analysis", "reports", "tasks", "compliance", "knowledge", "analytics", "billing", "audit", "settings"]),
  "Admin": new Set(["team", "clients", "projects", "documents", "ai", "analysis", "reports", "tasks", "compliance", "knowledge", "analytics", "audit", "settings"]),
  "Finance User": new Set(["clients", "projects", "documents", "ai", "analysis", "reports", "tasks", "compliance", "knowledge", "analytics", "settings"])
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("finotech_saas_user");
    if (saved) setUser(JSON.parse(saved));
    setLoading(false);
  }, []);

  const login = async (email: string, password: string, role: Role) => {
    if (!email || !password) throw new Error("Enter email and password.");
    const next = await api.login(email, password, role);
    setUser(next);
    localStorage.setItem("finotech_saas_user", JSON.stringify(next));
  };

  const signup = async (name: string, email: string, professionalRole: User["professionalRole"]) => {
    const next = await api.signup(name, email, professionalRole);
    setUser(next);
    localStorage.setItem("finotech_saas_user", JSON.stringify(next));
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem("finotech_saas_user");
  };

  const can = (permission: string) => !!user && permissions[user.role].has(permission);

  const value = useMemo(() => ({ user, loading, login, signup, logout, can }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export const DEMO_ACCOUNTS = demoUsers;