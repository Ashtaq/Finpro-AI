import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, ArrowUpRight, FolderKanban } from "lucide-react";
import { Badge, Button, Modal, PageHeader } from "../components/ui";
import { Client, Project } from "../types";
import { useAuth } from "../context/AuthContext";

const API=(import.meta.env.VITE_API_URL||"").replace(/\/$/,"");
export default function Projects(){
 const {user}=useAuth();const [rows,setRows]=useState<Project[]>([]);const [clients,setClients]=useState<Client[]>([]);const [open,setOpen]=useState(false);const [error,setError]=useState("");
 const [form,setForm]=useState({name:"",clientId:"",type:"Financial Analysis",fy:"FY 2025-26",currency:"INR",priority:"Medium",startDate:"",endDate:"",tags:""});
 useEffect(()=>{if(!user)return;Promise.all([fetch(`${API}/api/projects`,{headers:{"x-user-id":user.id}}).then(r=>r.ok?r.json():Promise.reject()),fetch(`${API}/api/clients`,{headers:{"x-user-id":user.id}}).then(r=>r.ok?r.json():Promise.reject())]).then(([p,c])=>{setRows(p);setClients(c);setForm(f=>({...f,clientId:f.clientId||c[0]?.id||""}));}).catch(()=>{setRows([]);setClients([]);});},[user]);
 const set=(key:keyof typeof form,value:string)=>setForm(f=>({...f,[key]:value}));
 const create=async()=>{if(!user||!form.name.trim()||!form.clientId)return;setError("");try{const r=await fetch(`${API}/api/projects`,{method:"POST",headers:{"Content-Type":"application/json","x-user-id":user.id},body:JSON.stringify({...form,tags:form.tags.split(",").map(x=>x.trim()).filter(Boolean)})});if(!r.ok){const b=await r.json().catch(()=>({}));throw new Error(b.error||"Unable to create project.");}const p=await r.json();setRows(x=>[p,...x]);setOpen(false);setForm(f=>({...f,name:"",tags:""}));}catch(e){setError(e instanceof Error?e.message:"Unable to create project.");}};
 return <><PageHeader eyebrow="WORK MANAGEMENT" title="Projects" description="Create financial engagements and keep clients, documents, AI conversations, analyses and reports isolated by project." action={<Button onClick={()=>setOpen(true)} disabled={!clients.length}><Plus size={16}/> New project</Button>}/>{error&&<div className="error-box">{error}</div>}<div className="project-grid">{rows.map(p=><Link to={`/projects/${p.id}`} className="project-card" key={p.id}><div className="project-top"><div className="project-icon"><FolderKanban size={20}/></div><Badge tone={p.status==="Active"?"success":p.status==="Under Review"?"warning":"default"}>{p.status}</Badge></div><h3>{p.name}</h3><p>{p.clientName}</p><div className="project-meta"><span>{p.type}</span><span>{p.fy}</span><span>{p.currency}</span></div><div className="tag-row">{p.tags.map(t=><span className="tag" key={t}>{t}</span>)}</div><div className="project-footer"><span>Priority: {p.priority}</span><ArrowUpRight size={16}/></div></Link>)}</div>{!rows.length&&<div className="panel"><p>No projects are available for this organization.</p></div>}
 <Modal open={open} onClose={()=>setOpen(false)} title="Create project"><div className="form-grid">
  <label>Project name<input value={form.name} onChange={e=>set("name",e.target.value)} required/></label>
  <label>Client<select value={form.clientId} onChange={e=>set("clientId",e.target.value)}>{clients.map(c=><option key={c.id} value={c.id}>{c.company}</option>)}</select></label>
  <label>Project type<select value={form.type} onChange={e=>set("type",e.target.value)}><option>Financial Analysis</option><option>Tax Analysis</option><option>Audit</option><option>Accounting</option><option>Valuation</option><option>Due Diligence</option><option>Advisory</option><option>Other</option></select></label>
  <label>Financial year<input value={form.fy} onChange={e=>set("fy",e.target.value)}/></label>
  <label>Currency<input value={form.currency} onChange={e=>set("currency",e.target.value.toUpperCase())}/></label>
  <label>Priority<select value={form.priority} onChange={e=>set("priority",e.target.value)}><option>High</option><option>Medium</option><option>Low</option></select></label>
  <label>Start date<input type="date" value={form.startDate} onChange={e=>set("startDate",e.target.value)}/></label>
  <label>Due date<input type="date" value={form.endDate} onChange={e=>set("endDate",e.target.value)}/></label>
  <label className="full">Tags<input value={form.tags} onChange={e=>set("tags",e.target.value)} placeholder="Tax, Annual, Ratios"/></label>
  <div className="modal-actions full"><Button variant="secondary" onClick={()=>setOpen(false)}>Cancel</Button><Button onClick={()=>void create()}>Create project</Button></div>
 </div></Modal></>;
}
