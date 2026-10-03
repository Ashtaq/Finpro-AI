import { useEffect, useState } from "react";
import { Plus, Search, MoreHorizontal, Building2 } from "lucide-react";
import { Badge, Button, Modal, PageHeader, EmptyState } from "../components/ui";
import { Client } from "../types";
import { useAuth } from "../context/AuthContext";

const API_BASE=(import.meta.env.VITE_API_URL||"").replace(/\/$/,"");
async function loadClients(userId:string){const r=await fetch(`${API_BASE}/api/clients`,{headers:{"x-user-id":userId}});if(!r.ok)throw new Error("Unable to load clients.");return r.json() as Promise<Client[]>;}
async function createClient(userId:string,payload:Partial<Client>){const r=await fetch(`${API_BASE}/api/clients`,{method:"POST",headers:{"Content-Type":"application/json","x-user-id":userId},body:JSON.stringify(payload)});if(!r.ok){const b=await r.json().catch(()=>({}));throw new Error(b.error||"Unable to create client.");}return r.json() as Promise<Client>;}

export default function Clients(){
 const {user}=useAuth();const [rows,setRows]=useState<Client[]>([]);const [q,setQ]=useState("");const [open,setOpen]=useState(false);const [error,setError]=useState("");
 const [form,setForm]=useState<Partial<Client>>({clientType:"Business",country:"India",priority:"Medium",communicationPreference:"Email",industry:"Technology"});
 useEffect(()=>{if(!user)return;void loadClients(user.id).then(setRows).catch(()=>setRows([]));},[user]);
 const set=(key:keyof Client,value:string)=>setForm(f=>({...f,[key]:value}));
 const add=async()=>{if(!user||!String(form.company||"").trim())return;try{const next=await createClient(user.id,form);setRows(r=>[next,...r]);setForm({clientType:"Business",country:"India",priority:"Medium",communicationPreference:"Email",industry:"Technology"});setOpen(false);setError("");}catch(e){setError(e instanceof Error?e.message:"Unable to create client.");}};
 const filtered=rows.filter(c=>(c.company+" "+c.name+" "+c.industry+" "+(c.pan||"")+" "+(c.gstin||"")).toLowerCase().includes(q.toLowerCase()));
 return <><PageHeader eyebrow="CRM" title="Clients" description="Manage client identity, tax registrations, projects, documents and engagement history." action={<Button onClick={()=>setOpen(true)}><Plus size={16}/> New client</Button>}/>{error&&<div className="error-box">{error}</div>}<div className="toolbar"><div className="search-box light"><Search size={16}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search clients, PAN, GSTIN..."/></div><Button variant="secondary">Import CSV</Button></div>
 <div className="table-panel"><table><thead><tr><th>Client</th><th>Industry</th><th>PAN / GSTIN</th><th>Financial year</th><th>Status</th><th>Projects</th><th>Documents</th><th></th></tr></thead><tbody>{filtered.map(c=><tr key={c.id}><td><div className="table-primary"><div className="table-avatar"><Building2 size={15}/></div><div><strong>{c.company}</strong><span>{c.contactPerson||c.name} · {c.email}</span></div></div></td><td>{c.industry}</td><td><span>{c.pan||"—"}</span><br/><span>{c.gstin||"—"}</span></td><td>{c.fy}</td><td><Badge tone={c.status==="Active"?"success":c.status==="Onboarding"?"warning":"default"}>{c.status}</Badge></td><td>{c.projects}</td><td>{c.documents}</td><td><button className="icon-btn"><MoreHorizontal size={17}/></button></td></tr>)}</tbody></table>{!filtered.length&&<EmptyState title="No clients found" description="Try a different search."/ >}</div>
 <Modal open={open} onClose={()=>setOpen(false)} title="Create client"><div className="form-grid">
  <label>Client / contact name<input value={String(form.name||"")} onChange={e=>set("name",e.target.value)}/></label>
  <label>Company / legal name<input value={String(form.company||"")} onChange={e=>set("company",e.target.value)} required/></label>
  <label>Client type<select value={String(form.clientType||"Business")} onChange={e=>set("clientType",e.target.value)}><option>Individual</option><option>Business</option><option>Company</option><option>LLP</option><option>Trust</option><option>Other</option></select></label>
  <label>Industry<select value={String(form.industry||"Technology")} onChange={e=>set("industry",e.target.value)}><option>Technology</option><option>Manufacturing</option><option>Retail</option><option>Infrastructure</option><option>Professional Services</option><option>Other</option></select></label>
  <label>Email<input type="email" value={String(form.email||"")} onChange={e=>set("email",e.target.value)}/></label>
  <label>Phone<input value={String(form.phone||"")} onChange={e=>set("phone",e.target.value)}/></label>
  <label>Alternate phone<input value={String(form.alternatePhone||"")} onChange={e=>set("alternatePhone",e.target.value)}/></label>
  <label>PAN<input value={String(form.pan||"")} onChange={e=>set("pan",e.target.value.toUpperCase())}/></label>
  <label>GSTIN<input value={String(form.gstin||"")} onChange={e=>set("gstin",e.target.value.toUpperCase())}/></label>
  <label>CIN / LLPIN<input value={String(form.cin||"")} onChange={e=>set("cin",e.target.value.toUpperCase())}/></label>
  <label>Business / profession activity<input value={String(form.professionActivity||"")} onChange={e=>set("professionActivity",e.target.value)}/></label>
  <label>GST registration type<select value={String(form.gstRegistrationType||"")} onChange={e=>set("gstRegistrationType",e.target.value)}><option value="">Select</option><option>Regular</option><option>Composition</option><option>Unregistered</option><option>Other</option></select></label>
  <label>Tax regime<select value={String(form.taxRegime||"")} onChange={e=>set("taxRegime",e.target.value)}><option value="">Select</option><option>Old Regime</option><option>New Regime</option><option>Corporate</option><option>Not Applicable</option></select></label>
  <label>Financial year<input value={String(form.fy||"FY 2025-26")} onChange={e=>set("fy",e.target.value)}/></label>
  <label>Priority<select value={String(form.priority||"Medium")} onChange={e=>set("priority",e.target.value)}><option>High</option><option>Medium</option><option>Low</option></select></label>
  <label>City<input value={String(form.city||"")} onChange={e=>set("city",e.target.value)}/></label>
  <label>State<input value={String(form.state||"")} onChange={e=>set("state",e.target.value)}/></label>
  <label className="full">Address<textarea value={String(form.address||"")} onChange={e=>set("address",e.target.value)}/></label>
  <label className="full">Notes<textarea value={String(form.notes||"")} onChange={e=>set("notes",e.target.value)}/></label>
  <div className="modal-actions full"><Button variant="secondary" onClick={()=>setOpen(false)}>Cancel</Button><Button onClick={()=>void add()}>Create client</Button></div>
 </div></Modal></>;
}
