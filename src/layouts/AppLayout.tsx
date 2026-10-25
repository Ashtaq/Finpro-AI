import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  BadgeCheck,
  BarChart3,
  BookOpen,
  CalendarClock,
  CheckSquare,
  ClipboardList,
  Database,
  FileBarChart,
  FileCheck2,
  FolderKanban,
  Gauge,
  Landmark,
  LayoutDashboard,
  LogOut,
  LucideIcon,
  Menu,
  MessageSquareText,
  Settings,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { needsKyc, Permission, useAuth } from "../context/AuthContext";

type Item = [path: string, label: string, icon: LucideIcon, permission: Permission];
const professionalGroups: { title: string; items: Item[] }[] = [
  {
    title: "Workspace",
    items: [
      ["/", "Dashboard", LayoutDashboard, "dashboard"],
      ["/clients", "Clients", Users, "clients"],
      ["/projects", "Projects", FolderKanban, "projects"],
      ["/ai-agents", "AI Agents", Sparkles, "ai"],
      ["/ai-assistant", "AI Assistant", MessageSquareText, "ai"],
      ["/documents", "Documents", Database, "documents"],
      ["/analysis", "Financial Analysis", BarChart3, "analysis"],
      ["/reports", "Reports", FileBarChart, "reports"],
    ],
  },
  {
    title: "Operations",
    items: [
      ["/tasks", "Tasks", CheckSquare, "tasks"],
      ["/compliance", "Compliance", CalendarClock, "compliance"],
      ["/knowledge-base", "Knowledge Base", BookOpen, "knowledge"],
      ["/analytics", "Analytics", Gauge, "analytics"],
      ["/team", "Team", Users, "team"],
      ["/audit-logs", "Audit Logs", ClipboardList, "audit"],
    ],
  },
  { title: "Account", items: [["/settings", "Settings", Settings, "settings"]] },
];
const individualGroups: { title: string; items: Item[] }[] = [
  {
    title: "My Finance",
    items: [
      ["/individual", "Dashboard", LayoutDashboard, "individual"],
      ["/assets", "My Assets", Landmark, "assets"],
      ["/documents", "Documents", Database, "documents"],
      ["/itr-filing", "ITR Preparation", FileCheck2, "itr"],
      ["/ai-assistant", "AI Assistant", MessageSquareText, "ai"],
      ["/reports", "Reports", FileBarChart, "reports"],
      ["/settings", "Settings", Settings, "settings"],
    ],
  },
];

export default function AppLayout() {
  const { user, logout, can, meta } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);
  if (!user) return null;

  const groups = user.role === "Individual" ? individualGroups : professionalGroups;
  const signOut = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      {menuOpen && <div className="sidebar-backdrop" onClick={() => setMenuOpen(false)} />}
      <aside className={menuOpen ? "sidebar open" : "sidebar"} aria-label="Primary">
        <div className="brand">
          <div className="brand-mark">
            <Sparkles size={18} />
          </div>
          <div>
            <div className="brand-name">FINPRO AI</div>
            <div className="brand-sub">FINANCE WORKSPACE</div>
          </div>
          <button className="icon-btn sidebar-close" onClick={() => setMenuOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        <div className="org-switcher">
          <div className="org-avatar">{(user.organizationName || "F").slice(0, 1)}</div>
          <div className="org-meta">
            <strong>{user.organizationName}</strong>
            <span>{user.role}</span>
          </div>
        </div>
        <nav className="nav">
          {needsKyc(user, meta) && (
            <div className="nav-group">
              <div className="nav-label">Get started</div>
              <NavLink to="/verify-identity" className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}>
                <BadgeCheck size={17} />
                <span>Verify identity</span>
              </NavLink>
            </div>
          )}
          {groups.map((group) => {
            const visible = group.items.filter(([, , , p]) => can(p));
            if (!visible.length) return null;
            return (
              <div className="nav-group" key={group.title}>
                <div className="nav-label">{group.title}</div>
                {visible.map(([path, label, Icon]) => (
                  <NavLink key={path} to={path} end={path === "/"} className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}>
                    <Icon size={17} />
                    <span>{label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="user-mini">
            <div className="avatar">{user.name.slice(0, 1)}</div>
            <div className="user-meta">
              <strong>{user.name}</strong>
              <span>{user.role === "Individual" ? "Personal account" : user.professionalRole}</span>
            </div>
          </div>
          <button className="logout-link" onClick={() => void signOut()}>
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </aside>
      <main className="main-shell">
        <header className="topbar">
          <button className="icon-btn menu-toggle" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu size={19} />
          </button>
          <div className="topbar-title">{user.organizationName}</div>
          <div className="topbar-actions">
            <NavLink to="/settings" className="topbar-user" title="Account settings">
              {user.name.slice(0, 1)}
            </NavLink>
          </div>
        </header>
        <div className="page-wrap" id="main">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
