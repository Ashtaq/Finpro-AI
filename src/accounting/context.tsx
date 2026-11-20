import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { Company, companyApi, CompanyApi, Me } from "./lib";

interface AccountingValue {
  me: Me | null;
  companies: Company[];
  company: Company | null;
  capi: CompanyApi | null;
  loading: boolean;
  error: string;
  selectCompany: (id: string) => void;
  reloadCompanies: () => Promise<void>;
  reloadCompany: () => Promise<void>;
  can: (cap: "read" | "write" | "approve" | "admin") => boolean;
}

const Ctx = createContext<AccountingValue | null>(null);
const KEY = "finpro.accounting.company";
const remember = (id: string) => {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* storage unavailable — selection just isn't remembered */
  }
};
const recall = () => {
  try {
    return localStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
};

export function AccountingProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [selected, setSelected] = useState(recall());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reloadCompanies = useCallback(async () => {
    const list = await api.get<Company[]>("/accounting/companies");
    setCompanies(list);
    setSelected((cur) => (list.some((c) => c.id === cur) ? cur : list[0]?.id || ""));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [m] = await Promise.all([api.get<Me>("/accounting/me"), reloadCompanies()]);
        setMe(m);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load the accounting workspace.");
      } finally {
        setLoading(false);
      }
    })();
  }, [reloadCompanies]);

  const reloadCompany = useCallback(async () => {
    if (!selected) return setCompany(null);
    try {
      setCompany(await api.get<Company>(`/accounting/companies/${selected}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the company.");
    }
  }, [selected]);

  useEffect(() => {
    void reloadCompany();
  }, [reloadCompany]);

  const value = useMemo<AccountingValue>(
    () => ({
      me,
      companies,
      company,
      capi: company ? companyApi(company.id) : null,
      loading,
      error,
      selectCompany: (id) => {
        remember(id);
        setSelected(id);
      },
      reloadCompanies,
      reloadCompany,
      can: (cap) => !!me?.capabilities.includes(cap),
    }),
    [me, companies, company, loading, error, reloadCompanies, reloadCompany],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAccounting() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAccounting must be used inside AccountingProvider");
  return v;
}

/** For pages that require a selected company. */
export function useCompany() {
  const v = useAccounting();
  if (!v.company || !v.capi) throw new Error("No company selected");
  return { ...v, company: v.company, capi: v.capi };
}
