import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { Role, User } from "../types";
import { demoUsers } from "../data/mockData";
import * as api from "../services/mockApi";

interface AuthContextValue {
  user: User | null; loading: boolean;
  login: (email:string,password:string,role:Role)=>Promise<void>;
  signup: (name:string,email:string,password:string,professionalRole:User["professionalRole"],accountType:Role)=>Promise<void>;
  logout: ()=>void; can:(permission:string)=>boolean; refreshUser:(next:User)=>void;
}
const AuthContext=createContext<AuthContextValue|null>(null);
const permissions:Record<Role,Set<string>>={
 "Super Admin":new Set(["platform","orgs","team","clients","projects","documents","ai","analysis","reports","tasks","compliance","knowledge","analytics","billing","audit","settings"]),
 "Admin":new Set(["team","clients","projects","documents","ai","analysis","reports","tasks","compliance","knowledge","analytics","audit","settings"]),
 "Finance User":new Set(["clients","projects","documents","ai","analysis","reports","tasks","compliance","knowledge","analytics","settings"]),
 "Individual":new Set(["individual","assets","documents","itr","settings"])
};
export function AuthProvider({children}:{children:ReactNode}){
 const [user,setUser]=useState<User|null>(null); const [loading,setLoading]=useState(true);
 useEffect(()=>{try{const saved=localStorage.getItem("finotech_saas_user");if(saved)setUser(JSON.parse(saved));}catch{localStorage.removeItem("finotech_saas_user");}setLoading(false);},[]);
 const persist=(next:User|null)=>{setUser(next);if(next)localStorage.setItem("finotech_saas_user",JSON.stringify(next));else localStorage.removeItem("finotech_saas_user");};
 const login=async(email:string,password:string,role:Role)=>{if(!email||!password)throw new Error("Enter email and password.");persist(await api.login(email,password,role));};
 const signup=async(name:string,email:string,password:string,professionalRole:User["professionalRole"],accountType:Role)=>{persist(await api.signup(name,email,password,professionalRole,accountType));};
 const logout=()=>{persist(null);sessionStorage.removeItem("finotech_ai_conversation");};
 const can=(permission:string)=>!!user&&permissions[user.role].has(permission);
 const refreshUser=(next:User)=>persist(next);
 const value=useMemo(()=>({user,loading,login,signup,logout,can,refreshUser}),[user,loading]);
 return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth(){const value=useContext(AuthContext);if(!value)throw new Error("useAuth must be used inside AuthProvider");return value;}
export const DEMO_ACCOUNTS=demoUsers;
