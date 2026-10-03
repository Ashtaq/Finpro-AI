import { FormEvent, useEffect, useState } from "react";
import { Mail, Plus, KeyRound, Trash2, Edit3 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { createManagedUser, deleteManagedUser, listManagedUsers, resetManagedUserPassword, updateManagedUser } from "../services/mockApi";
import { Badge, Button, Modal, PageHeader } from "../components/ui";
import { ProfessionalRole, Role, User } from "../types";

const professionalRoles: ProfessionalRole[] = ["CA","CS","CFA","Financial Analyst","Accountant","Auditor","Finance Manager","Investment Analyst","Consultant","Other"];

export default function Team() {
  const { user } = useAuth();
  const [rows,setRows]=useState<User[]>([]); const [open,setOpen]=useState(false); const [edit,setEdit]=useState<User|null>(null); const [error,setError]=useState("");
  const [form,setForm]=useState({name:"",email:"",professionalRole:"CA" as ProfessionalRole,role:"Finance User" as Role,password:"welcome123"});

  const load=async()=>{if(user)setRows(await listManagedUsers(user));};
  useEffect(()=>{void load();},[user]);

  const openCreate=()=>{setEdit(null);setError("");setForm({name:"",email:"",professionalRole:"CA",role:user?.role==="Professional User"?"Professional User":"Finance User",password:"welcome123"});setOpen(true);};
  const openEdit=(u:User)=>{setEdit(u);setError("");setForm({name:u.name,email:u.email,professionalRole:u.professionalRole,role:u.role,password:"welcome123"});setOpen(true);};

  const submit=async(e:FormEvent)=>{e.preventDefault();setError("");try{if(!user)return;if(edit)await updateManagedUser(user,edit.id,{name:form.name,email:form.email,professionalRole:form.professionalRole,role:form.role});else await createManagedUser(user,form);setOpen(false);await load();}catch(e){setError(e instanceof Error?e.message:"Unable to save user.");}};
  const remove=async(u:User)=>{if(!user||!window.confirm(`Delete ${u.name}'s account?`))return;try{await deleteManagedUser(user,u.id);await load();}catch(e){setError(e instanceof Error?e.message:"Unable to delete user.");}};
  const reset=async(u:User)=>{if(!user)return;const p=window.prompt(`New password for ${u.name}:`,"welcome123");if(!p)return;try{await resetManagedUserPassword(user,u.id,p);window.alert("Password reset successfully.");}catch(e){setError(e instanceof Error?e.message:"Unable to reset password.");}};

  const workspaceManager=user?.role==="Professional User";
  return <><PageHeader eyebrow={workspaceManager?"WORKSPACE ADMINISTRATION":"WORKSPACE ADMINISTRATION"} title="User Management" description={workspaceManager?"Manage Finance Users and Professional Users in your workspace.":"Manage workspace users in your organization."} action={<Button onClick={openCreate}><Plus size={15}/> Create user</Button>}/>
  {error&&<div className="error-box">{error}</div>}
  <div className="notice"><div><strong>Access hierarchy</strong><span>{workspaceManager?"Professional Users can create, edit, reset and delete workspace user accounts.":"Professional Users can create, edit, reset and delete workspace user accounts."}</span></div><Badge tone="info">RBAC enforced</Badge></div>
  <div className="team-grid">{rows.map(u=><div className="team-card" key={u.id}><div className="team-card-top"><div className="avatar large">{u.name.slice(0,1)}</div><Badge tone={u.role==="Professional User"?"info":"default"}>{u.role}</Badge></div><h3>{u.name}</h3><p>{u.professionalRole} · {u.organizationName}</p><span><Mail size={13}/> {u.email}</span><div className="team-actions"><button onClick={()=>openEdit(u)}><Edit3 size={14}/> Edit</button><button onClick={()=>reset(u)}><KeyRound size={14}/> Reset password</button><button onClick={()=>remove(u)}><Trash2 size={14}/> Delete</button></div></div>)}</div>
  <Modal open={open} title={edit?"Edit user":"Create user"} onClose={()=>setOpen(false)}><form onSubmit={submit} className="form-stack">
    <label>Full name<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} required/></label>
    <label>Email<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} required/></label>
    <label>Professional role<select value={form.professionalRole} onChange={e=>setForm({...form,professionalRole:e.target.value as ProfessionalRole})}>{professionalRoles.map(r=><option key={r}>{r}</option>)}</select></label>
    <label>Account role<select value={form.role} disabled={!workspaceManager} onChange={e=>setForm({...form,role:e.target.value as Role})}>{(workspaceManager?["Admin","Finance User"]:["Finance User"]).map(r=><option key={r}>{r}</option>)}</select></label>
    {!edit&&<label>Initial password<input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} minLength={6} required/></label>}
    <div className="modal-actions"><Button variant="secondary" onClick={()=>setOpen(false)}>Cancel</Button><Button type="submit">{edit?"Save changes":"Create account"}</Button></div>
  </form></Modal></>;
}