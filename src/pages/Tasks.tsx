import { DragEvent, useEffect, useState } from "react";
import { CheckCircle2, Clock3, ListTodo, Plus, GripVertical } from "lucide-react";
import { Badge, Button, PageHeader } from "../components/ui";
import { Task } from "../types";
import { getTasks, updateTaskStatus } from "../services/mockApi";
import { useAuth } from "../context/AuthContext";

const cols: Task["status"][]=["To Do","In Progress","Review","Completed"];

export default function Tasks(){
  const {user}=useAuth(); const [rows,setRows]=useState<Task[]>([]); const [dragOver,setDragOver]=useState<Task["status"]|null>(null); const [error,setError]=useState("");
  useEffect(()=>{void getTasks().then(setRows);},[]);
  const move=async(id:string,status:Task["status"])=>{if(!user)return;const previous=rows;setRows(r=>r.map(t=>t.id===id?{...t,status}:t));try{await updateTaskStatus(user,id,status);setError("");}catch(e){setRows(previous);setError(e instanceof Error?e.message:"Unable to update task.");}};
  const onDrop=(e:DragEvent<HTMLDivElement>,status:Task["status"])=>{e.preventDefault();const id=e.dataTransfer.getData("text/task-id");if(id)void move(id,status);setDragOver(null);};
  return <><PageHeader eyebrow="OPERATIONS" title="Task Management" description="Drag and drop tasks between To Do, In Progress, Review and Completed." action={<Button><Plus size={15}/> New task</Button>}/>{error&&<div className="error-box">{error}</div>}<div className="notice"><div><strong>Kanban workflow</strong><span>Drag a task card to any status column. The status is saved in the current browser session.</span></div><Badge tone="info">Drag & Drop</Badge></div><div className="task-board">{cols.map(status=><div key={status} className={dragOver===status?"task-col drag-over":"task-col"} onDragOver={e=>{e.preventDefault();setDragOver(status);e.dataTransfer.dropEffect="move"}} onDragLeave={()=>setDragOver(null)} onDrop={e=>onDrop(e,status)}><div className="task-col-head"><div><strong>{status}</strong><span>{rows.filter(t=>t.status===status).length} tasks</span></div><Plus size={15}/></div>{rows.filter(t=>t.status===status).map(t=><div key={t.id} className="task-card" draggable onDragStart={e=>{e.dataTransfer.setData("text/task-id",t.id);e.dataTransfer.effectAllowed="move"}}><div className="task-card-top"><div className="drag-handle"><GripVertical size={14}/><Badge tone={t.priority==="High"?"danger":t.priority==="Medium"?"warning":"default"}>{t.priority}</Badge></div><ListTodo size={15}/></div><h3>{t.title}</h3><p>{t.client}</p><div className="task-meta"><span>{t.assignee}</span><span><Clock3 size={13}/> {t.due}</span></div>{status==="Completed"?<div className="completed"><CheckCircle2 size={14}/> Completed</div>:<div className="task-next">{cols.slice(cols.indexOf(status)+1).map(next=><button key={next} onClick={()=>void move(t.id,next)}>Move → {next}</button>)}</div>}</div>)}</div>)}</div></>;
}