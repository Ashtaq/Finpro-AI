import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Login from "./pages/Login"; import Signup from "./pages/Signup"; import AppLayout from "./layouts/AppLayout";
import Dashboard from "./pages/Dashboard"; import Clients from "./pages/Clients"; import Projects from "./pages/Projects"; import ProjectWorkspace from "./pages/ProjectWorkspace";
import AIAgents from "./pages/AIAgents"; import AIAssistant from "./pages/AIAssistant"; import Documents from "./pages/Documents"; import FinancialAnalysis from "./pages/FinancialAnalysis";
import Reports from "./pages/Reports"; import Tasks from "./pages/Tasks"; import Compliance from "./pages/Compliance"; import KnowledgeBase from "./pages/KnowledgeBase"; import Analytics from "./pages/Analytics";
import Team from "./pages/Team"; import AuditLogs from "./pages/AuditLogs"; import Settings from "./pages/Settings"; import PlatformAdmin from "./pages/PlatformAdmin"; import Billing from "./pages/Billing";
import IndividualDashboard from "./pages/IndividualDashboard"; import Assets from "./pages/Assets"; import ITRFiling from "./pages/ITRFiling";
import { ReactNode } from "react";
function Protected({children}:{children:ReactNode}){const {user,loading}=useAuth();if(loading)return <div className="center-screen"><div className="spinner"/></div>;if(!user)return <Navigate to="/login" replace/>;return <>{children}</>;}
function PermissionRoute({permission,children}:{permission:string;children:ReactNode}){const {can}=useAuth();if(!can(permission))return <Navigate to="/" replace/>;return <>{children}</>;}
function AppRoutes(){return <Routes>
 <Route path="/login" element={<Login/>}/><Route path="/signup" element={<Signup/>}/>
 <Route path="/" element={<Protected><AppLayout/></Protected>}>
  <Route index element={<Dashboard/>}/><Route path="clients" element={<Clients/>}/><Route path="projects" element={<Projects/>}/><Route path="projects/:projectId" element={<ProjectWorkspace/>}/>
  <Route path="ai-agents" element={<AIAgents/>}/><Route path="ai-assistant" element={<AIAssistant/>}/><Route path="documents" element={<Documents/>}/><Route path="analysis" element={<FinancialAnalysis/>}/><Route path="reports" element={<Reports/>}/>
  <Route path="tasks" element={<Tasks/>}/><Route path="compliance" element={<Compliance/>}/><Route path="knowledge-base" element={<KnowledgeBase/>}/><Route path="analytics" element={<Analytics/>}/><Route path="team" element={<PermissionRoute permission="team"><Team/></PermissionRoute>}/>
  <Route path="audit-logs" element={<PermissionRoute permission="audit"><AuditLogs/></PermissionRoute>}/><Route path="settings" element={<Settings/>}/><Route path="platform" element={<PermissionRoute permission="platform"><PlatformAdmin/></PermissionRoute>}/><Route path="billing" element={<PermissionRoute permission="billing"><Billing/></PermissionRoute>}/>
  <Route path="individual" element={<PermissionRoute permission="individual"><IndividualDashboard/></PermissionRoute>}/><Route path="assets" element={<PermissionRoute permission="assets"><Assets/></PermissionRoute>}/><Route path="itr-filing" element={<PermissionRoute permission="itr"><ITRFiling/></PermissionRoute>}/>
 </Route>
 <Route path="*" element={<Navigate to="/" replace/>}/>
 </Routes>;}
export default function App(){return <BrowserRouter><AuthProvider><AppRoutes/></AuthProvider></BrowserRouter>;}
