import { createContext,useContext,useEffect,useMemo,useState,ReactNode } from "react";
import { Role,User } from "../types";
import { demoUsers } from "../data/mockData";
import * as api from "../services/mockApi";
export type SignupKyc={kycRef:string;name:string;dob:string;pan:string};
interface AuthContextValue{user:User|null;loading:boolean;login:(email:string,password:string,role:Role)=>Promise<void>;signup:(name:string,email:string,password:string,professionalRole:User["professionalRole"],accountType:Role,kyc:SignupKyc)=>Promise<void>;logout:()=>void;can:(permission:string)=>boolean;refreshUser:(next:User)=>void;updateAccount:(data:{name:string;email:string;phone:string})=>Promise<void>;changePassword:(currentPassword:string,newPassword:string)=>Promise<void>;}
const AuthContext=createContext<AuthContextValue|null>(null);
const permissions:Record<Role,Set<string>>={
 "Professional User":new Set(["clients","projects","documents","ai","analysis","reports","tasks","compliance","knowledge","analytics","audit","settings"]),
 "Finance User":new Set(["projects","documents","ai","analysis","reports","tasks","analytics","settings"]),
 "Individual":new Set(["individual","assets","documents","ai","itr","settings"])
};
const individualRequest=async <T,>(path:string,body?:unknown):Promise<T>=>{
 const response=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||("Request failed ("+response.status+")"));return data as T;
};
export function AuthProvider({children}:{children:ReactNode}){
 const [user,setUser]=useState<User|null>(null);const [loading,setLoading]=useState(true);
 useEffect(()=>{try{const saved=localStorage.getItem("finotech_saas_user");if(saved)setUser(JSON.parse(saved));}catch{localStorage.removeItem("finotech_saas_user");}setLoading(false);},[]);
 const persist=(next:User|null)=>{setUser(next);if(next)localStorage.setItem("finotech_saas_user",JSON.stringify(next));else localStorage.removeItem("finotech_saas_user");};
 const login=async(email:string,password:string,role:Role)=>{if(!email||!password)throw new Error("Enter email and password.");if(role==="Individual"){try{const r=await individualRequest<{user:User}>("/api/individual/auth/login",{email,password});persist(r.user);return;}catch(e){const demo=email.toLowerCase()==="individual@finotech.demo"&&password==="demo123";if(demo){persist({id:"u-individual-demo",name:"Individual Demo",email,role:"Individual",professionalRole:"Other",organizationId:"individual-demo",organizationName:"Individual Demo Workspace"});return;}throw e;}}persist(await api.login(email,password,role));};
 const signup=async(name:string,email:string,password:string,professionalRole:User["professionalRole"],accountType:Role,kyc:SignupKyc)=>{if(!kyc?.kycRef)throw new Error("Complete Aadhaar and PAN verification with DigiLocker first.");if(accountType==="Individual"){const r=await individualRequest<{user:User}>("/api/individual/auth/signup",{name,email,password,professionalRole,kycRef:kyc.kycRef,kycName:kyc.name,kycDob:kyc.dob,kycPan:kyc.pan});persist(r.user);return;}persist(await api.signup(name,email,password,professionalRole,accountType,kyc));};
 const logout=()=>{persist(null);sessionStorage.removeItem("finotech_ai_conversation");sessionStorage.removeItem("finpro_kyc_ref");sessionStorage.removeItem("finpro_kyc_callback");};const can=(permission:string)=>!!user&&permissions[user.role].has(permission);const refreshUser=(next:User)=>persist(next);
 const updateAccount=async(data:{name:string;email:string;phone:string})=>{if(!user)throw new Error("You must be signed in.");const base=user.role==="Individual"?"/api/individual/account":"/api/account";const r=await fetch(base,{method:"PATCH",headers:{"Content-Type":"application/json","x-user-id":user.id},body:JSON.stringify(data)});const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.error||"Unable to update account.");persist(body as User);};
 const changePassword=async(currentPassword:string,newPassword:string)=>{if(!user)throw new Error("You must be signed in.");const base=user.role==="Individual"?"/api/individual/account/change-password":"/api/account/change-password";const r=await fetch(base,{method:"POST",headers:{"Content-Type":"application/json","x-user-id":user.id},body:JSON.stringify({currentPassword,newPassword})});const body=await r.json().catch(()=>({}));if(!r.ok)throw new Error(body.error||"Unable to change password.");};
 const value=useMemo(()=>({user,loading,login,signup,logout,can,refreshUser,updateAccount,changePassword}),[user,loading]);return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth(){const value=useContext(AuthContext);if(!value)throw new Error("useAuth must be used inside AuthProvider");return value;}
export const DEMO_ACCOUNTS=demoUsers;