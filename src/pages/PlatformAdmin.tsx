import { Activity, Building2, Database, Gauge, ShieldCheck, Users, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { organizations } from "../data/mockData";
import { createManagedUser, listManagedUsers } from "../services/mockApi";
import { Badge, MetricCard, PageHeader, Button, Modal } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { ProfessionalRole, Role, User } from "../types";

export default function PlatformAdmin(){
 const {user}=useAuth(); const [users,setUsers]=useState<User[]>([]); const [open,setOpen]=useState(false); const [error,setError]=useState("");
 const [form,setForm]=useState({name:"",email:"",professionalRole:"CA" as ProfessionalRole,role:"Professional User" as Role,password:"welcome123",organizationId:"org-1"});
 const load=async()=>{if(user)setUsers(await listManagedUsers(user));}; useEffect(()=>{void load();},[user]);
 const create=async()=>{try{if(!user)return;await createManagedUser(user,form);setOpen(false);setError("");await load();}catch(e){setError(e instanceof Error?e.message:"Unable to create account.");}};
 return <><PageHeader eyebrow="PLATFORM" title="Professional Workspace Administration" description="Workspace management of Finance Users and Professional Users." action={<Button onClick={()=>setOpen(true)}><Plus size={15}/> Create account</Button>}/>
 {error&&<div className="error-box">{error}</div>}
 <div className="metric-grid"><MetricCard label="Organizations" value={organizations.length} icon={<Building2 size={18}/>} delta="multi-tenant"/><MetricCard label="Platform Users" value={users.length} icon={<Users size={18}/>} delta="managed accounts"/><MetricCard label="AI Requests" value="28.0k" icon={<Gauge size={18}/>} delta="current cycle"/><MetricCard label="Storage" value="184 GB" icon={<Database size={18}/>} delta="across tenants"/><MetricCard label="System Health" value="99.98%" icon={<Activity size={18}/>} delta="demo monitor"/><MetricCard label="Security Events" value="14" icon={<ShieldCheck size={18}/>} delta="last 7 days"/></div>
 <div className="table-panel"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Organization</th><th>Status</th></tr></thead><tbody>{users.map(u=><tr key={u.id}><td><strong>{u.name}</strong></td><td>{u.email}</td><td><Badge tone={u.role==="Admin"?"info":"default"}>{u.role}</Badge></td><td>{u.organizationName}</td><td><Badge tone="success">Active</Badge></td></tr>)}</tbody></table></div>
 <Modal open={open} title="Create Admin or Finance User" onClose={()=>setOpen(false)}><div className="form-stack">
 <label>Full name<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label><label>Email<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label>
 <label>Professional role<select value={form.professionalRole} onChange={e=>setForm({...form,professionalRole:e.target.value as ProfessionalRole})}>{["CA","CS","CFA","Financial Analyst","Accountant","Auditor","Finance Manager","Investment Analyst","Consultant","Other"].map(r=><option key={r}>{r}</option>)}</select></label>
 <label>Role<select value={form.role} onChange={e=>setForm({...form,role:e.target.value as Role})}><option>Admin</option><option>Finance User</option></select></label>
 <label>Organization<select value={form.organizationId} onChange={e=>setForm({...form,organizationId:e.target.value})}>{organizations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
 <label>Initial password<input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} minLength={6}/></label>
 <div className="modal-actions"><Button variant="secondary" onClick={()=>setOpen(false)}>Cancel</Button><Button onClick={()=>void create()}>Create account</Button></div></div></Modal></>;
}