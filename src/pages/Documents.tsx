import { ChangeEvent, useEffect, useState } from "react";
import { FileSpreadsheet, FileText, UploadCloud, Search, Trash2, Download } from "lucide-react";
import { createDocument } from "../services/mockApi";
import { Badge, Button, PageHeader } from "../components/ui";
import { DocumentRecord, Project } from "../types";
import { useAuth } from "../context/AuthContext";

const API=(import.meta.env.VITE_API_URL||"").replace(/\/$/,"");
export default function Documents(){
 const {user}=useAuth();const [rows,setRows]=useState<DocumentRecord[]>([]);const [projects,setProjects]=useState<Project[]>([]);const [q,setQ]=useState("");const [error,setError]=useState("");
 useEffect(()=>{if(!user)return;Promise.all([
   fetch(`${API}/api/documents`,{headers:{"x-user-id":user.id}}).then(r=>r.ok?r.json():Promise.reject()),
   fetch(`${API}/api/projects`,{headers:{"x-user-id":user.id}}).then(r=>r.ok?r.json():Promise.reject())
 ]).then(([d,p])=>{setRows(d);setProjects(p);}).catch(()=>{setRows([]);setProjects([]);});},[user]);
 const upload=async(e:ChangeEvent<HTMLInputElement>)=>{const f=e.target.files?.[0];if(!f||!user)return;setError("");try{const projectId=projects[0]?.id;if(!projectId)throw new Error("Create a project before uploading a document.");const d=await createDocument(f.name,projectId);setRows(r=>[d,...r]);}catch(err){setError(err instanceof Error?err.message:"Unable to upload document.");}finally{e.target.value="";}};
 const filtered=rows.filter(d=>d.name.toLowerCase().includes(q.toLowerCase()));
 return <><PageHeader eyebrow="DOCUMENT INTELLIGENCE" title="Documents" description="Secure file workspace with validation, processing status, versioning-ready records and project isolation." action={<label className="btn btn-primary"><UploadCloud size={16}/> Upload files<input type="file" hidden accept=".xlsx,.xls,.csv,.pdf,.docx,.txt,.json" onChange={upload}/></label>}/>{error&&<div className="error-box">{error}</div>}<div className="toolbar"><div className="search-box light"><Search size={16}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search documents..."/></div><div className="file-types"><span>XLSX</span><span>XLS</span><span>CSV</span><span>PDF</span><span>DOCX</span><span>TXT</span><span>JSON</span></div></div><div className="table-panel"><table><thead><tr><th>File</th><th>Project</th><th>Status</th><th>Size</th><th>Uploaded</th><th></th></tr></thead><tbody>{filtered.map(d=><tr key={d.id}><td><div className="table-primary"><div className="table-avatar">{["XLSX","CSV","XLS"].includes(d.type)?<FileSpreadsheet size={15}/>:<FileText size={15}/>}</div><div><strong>{d.name}</strong><span>{d.type}{d.pages?` · ${d.pages} pages`:""}</span></div></div></td><td>{projects.find(p=>p.id===d.projectId)?.name??"—"}</td><td><Badge tone={d.status==="Completed"?"success":d.status==="Failed"?"danger":"warning"}>{d.status}</Badge></td><td>{d.size}</td><td>{d.uploadedAt}</td><td><div className="row-actions"><button className="icon-btn" title="Download metadata only in Phase 1"><Download size={15}/></button><button className="icon-btn danger" title="Delete document (Phase 2)"><Trash2 size={15}/></button></div></td></tr>)}</tbody></table></div></>;
}
