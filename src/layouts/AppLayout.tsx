import { NavLink, Outlet } from "react-router-dom";
import { BarChart3, Bell, BookOpen, BriefcaseBusiness, CalendarClock, CheckSquare, ChevronDown, CircleHelp, ClipboardList, Database, FileBarChart, FileCheck2, FolderKanban, Gauge, Landmark, LayoutDashboard, LogOut, MessageSquareText, Search, Settings, Sparkles, Users } from "lucide-react";
import { useAuth } from "../context/AuthContext";

const professionalGroups = [
 {title:"Workspace",items:[["/","Dashboard",LayoutDashboard,"analytics"],["/clients","Clients",Users,"clients"],["/projects","Projects",FolderKanban,"projects"],["/ai-agents","AI Agents",Sparkles,"ai"],["/ai-assistant","AI Assistant",MessageSquareText,"ai"],["/documents","Documents",Database,"documents"],["/analysis","Financial Analysis",BarChart3,"analysis"],["/reports","Reports",FileBarChart,"reports"]]},
 {title:"Operations",items:[["/tasks","Tasks",CheckSquare,"tasks"],["/compliance","Compliance",CalendarClock,"compliance"],["/knowledge-base","Knowledge Base",BookOpen,"knowledge"],["/analytics","Analytics",Gauge,"analytics"],["/team","Team",Users,"team"],["/audit-logs","Activity / Audit Logs",ClipboardList,"audit"]]},
 {title:"Administration",items:[["/settings","Settings",Settings,"settings"]]}
] as const;
const individualGroups = [
 {title:"My Finance",items:[["/individual","Dashboard",LayoutDashboard,"individual"],["/assets","My Assets",Landmark,"assets"],["/documents","Documents",Database,"documents"],["/ai-agents","AI Agents",Sparkles,"ai"],["/ai-assistant","AI Assistant",MessageSquareText,"ai"],["/itr-filing","ITR Filing",FileCheck2,"itr"],["/settings","Settings",Settings,"settings"]]}
] as const;

export default function AppLayout(){
 const {user,logout,can}=useAuth(); const groups=user?.role==="Individual"?individualGroups:user?.role==="Finance User"?professionalGroups.filter(g=>g.title==="Workspace"):professionalGroups;
 return <div className="app-shell"><aside className="sidebar">
  <div className="brand"><div className="brand-mark"><Sparkles size={18}/></div><div><div className="brand-name">FINOTECH</div><div className="brand-sub">AI FINANCE OS</div></div></div>
  <div className="org-switcher"><div className="org-avatar">{user?.organizationName.slice(0,1)}</div><div className="org-meta"><strong>{user?.organizationName}</strong><span>{user?.role}</span></div><ChevronDown size={15}/></div>
  <nav className="nav">{groups.map(group=>{const visible=group.items.filter(([, , , permission])=>can(permission));return visible.length?<div className="nav-group" key={group.title}><div className="nav-label">{group.title}</div>{visible.map(([path,label,Icon])=><NavLink key={path} to={path} end={path==="/"} className={({isActive})=>isActive?"nav-item active":"nav-item"}><Icon size={17}/><span>{label}</span></NavLink>)}</div>:null})}</nav>
  <div className="sidebar-footer"><div className="user-mini"><div className="avatar">{user?.name.slice(0,1)}</div><div className="user-meta"><strong>{user?.name}</strong><span>{user?.role==="Individual"?"Self-filer":user?.professionalRole}</span></div></div><button className="logout-link" onClick={logout}><LogOut size={15}/> Sign out</button></div>
 </aside><main className="main-shell"><header className="topbar"><div className="search-box"><Search size={16}/><input placeholder={user?.role==="Individual"?"Search assets, documents, tax records...":"Search clients, projects, documents..."}/></div><div className="topbar-actions"><button className="icon-btn"><Bell size={18}/><span className="notif-dot"/></button><button className="icon-btn"><CircleHelp size={18}/></button><div className="topbar-user">{user?.name.slice(0,1)}</div></div></header><div className="page-wrap"><Outlet/></div></main></div>;
}