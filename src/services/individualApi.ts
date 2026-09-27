import { IndividualAsset, ITRReturn } from "../types";
const request=async<T>(path:string,options:RequestInit={})=>{const saved=localStorage.getItem("finotech_saas_user");const user=saved?JSON.parse(saved):null;const headers=new Headers(options.headers);headers.set("Content-Type","application/json");if(user?.id)headers.set("x-user-id",user.id);const r=await fetch(path,{...options,headers});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||("Request failed ("+r.status+")"));return data as T;};
export const listAssets=()=>request<IndividualAsset[]>("/api/individual/assets");
export const createAsset=(asset:Pick<IndividualAsset,"name"|"category"|"value"|"institution">)=>request<IndividualAsset>("/api/individual/assets",{method:"POST",body:JSON.stringify(asset)});
export const createITR=(assessmentYear="2026-27",itrType="ITR-1")=>request<{id:string;status:string}>("/api/individual/itr",{method:"POST",body:JSON.stringify({assessmentYear,itrType})});
export const validateITR=(id:string)=>request<{passed:boolean;errors:string[];message:string}>("/api/individual/itr/"+id+"/validate",{method:"POST",body:"{}"});
export const grantITRConsent=(id:string)=>request<{consentId:string;status:string}>("/api/individual/itr/"+id+"/consent",{method:"POST",body:"{}"});
export const listITRs=()=>request<ITRReturn[]>("/api/individual/itr");
