import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, ArrowUpRight, FolderKanban } from "lucide-react";
import { Badge, Button, PageHeader } from "../components/ui";
import { Project } from "../types";
import { useAuth } from "../context/AuthContext";

const API=(import.meta.env.VITE_API_URL||"").replace(/\/$/,"");
export default function Projects(){
 const {user}=useAuth();const [rows,setRows]=useState<Project[]>([]);
 useEffect(()=>{if(!user)return;fetch(`${API}/api/projects`,{headers:{"x-user-id":user.id}}).then(r=>r.ok?r.json():Promise.reject()).then(setRows).catch(()=>setRows([]));},[user]);
 return <><PageHeader eyebrow="WORK MANAGEMENT" title="Projects" description="Create financial engagements and keep all documents, AI conversations, analyses and reports isolated by project." action={<Button disabled><Plus size={16}/> New project (Phase 2)</Button>}/><div className="project-grid">{rows.map(p=><Link to={`/projects/${p.id}`} className="project-card" key={p.id}><div className="project-top"><div className="project-icon"><FolderKanban size={20}/></div><Badge tone={p.status==="Active"?"success":p.status==="Under Review"?"warning":"default"}>{p.status}</Badge></div><h3>{p.name}</h3><p>{p.clientName}</p><div className="project-meta"><span>{p.type}</span><span>{p.fy}</span><span>{p.currency}</span></div><div className="tag-row">{p.tags.map(t=><span className="tag" key={t}>{t}</span>)}</div><div className="project-footer"><span>Team: {p.team.join(", ")}</span><ArrowUpRight size={16}/></div></Link>)}</div>{!rows.length&&<div className="panel"><p>No projects are available for this organization.</p></div>}</>;
}
