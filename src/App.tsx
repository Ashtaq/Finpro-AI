import { lazy, ReactNode, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ErrorBoundary, Spinner } from "./components/ui";
import { AuthProvider, homePath, Permission, useAuth } from "./context/AuthContext";
import AppLayout from "./layouts/AppLayout";
import Login from "./pages/Login";
import Signup from "./pages/Signup";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Clients = lazy(() => import("./pages/Clients"));
const Projects = lazy(() => import("./pages/Projects"));
const ProjectWorkspace = lazy(() => import("./pages/ProjectWorkspace"));
const AIAgents = lazy(() => import("./pages/AIAgents"));
const AIAssistant = lazy(() => import("./pages/AIAssistant"));
const Documents = lazy(() => import("./pages/Documents"));
const FinancialAnalysis = lazy(() => import("./pages/FinancialAnalysis"));
const Reports = lazy(() => import("./pages/Reports"));
const Tasks = lazy(() => import("./pages/Tasks"));
const Compliance = lazy(() => import("./pages/Compliance"));
const KnowledgeBase = lazy(() => import("./pages/KnowledgeBase"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Team = lazy(() => import("./pages/Team"));
const AuditLogs = lazy(() => import("./pages/AuditLogs"));
const Settings = lazy(() => import("./pages/Settings"));
const IndividualDashboard = lazy(() => import("./pages/IndividualDashboard"));
const Assets = lazy(() => import("./pages/Assets"));
const ITRFiling = lazy(() => import("./pages/ITRFiling"));
const NotFound = lazy(() => import("./pages/NotFound"));

function FullScreenSpinner() {
  const { offline } = useAuth();
  return (
    <div className="center-screen" style={{ flexDirection: "column", gap: 12 }}>
      <div className="spinner" />
      {offline && <p className="muted">Connecting to the server… retrying automatically.</p>}
    </div>
  );
}

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenSpinner />;
  if (user) return <Navigate to={homePath(user.role)} replace />;
  return <>{children}</>;
}

function Guard({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can, user } = useAuth();
  if (!can(permission)) return <Navigate to={user ? homePath(user.role) : "/login"} replace />;
  return <Suspense fallback={<Spinner />}>{children}</Suspense>;
}

function Home() {
  const { user } = useAuth();
  if (user?.role === "Individual") return <Navigate to="/individual" replace />;
  return (
    <Guard permission="dashboard">
      <Dashboard />
    </Guard>
  );
}

const guarded: [string, Permission, ReactNode][] = [
  ["clients", "clients", <Clients />],
  ["projects", "projects", <Projects />],
  ["projects/:projectId", "projects", <ProjectWorkspace />],
  ["ai-agents", "ai", <AIAgents />],
  ["ai-assistant", "ai", <AIAssistant />],
  ["documents", "documents", <Documents />],
  ["analysis", "analysis", <FinancialAnalysis />],
  ["reports", "reports", <Reports />],
  ["tasks", "tasks", <Tasks />],
  ["compliance", "compliance", <Compliance />],
  ["knowledge-base", "knowledge", <KnowledgeBase />],
  ["analytics", "analytics", <Analytics />],
  ["team", "team", <Team />],
  ["audit-logs", "audit", <AuditLogs />],
  ["settings", "settings", <Settings />],
  ["individual", "individual", <IndividualDashboard />],
  ["assets", "assets", <Assets />],
  ["itr-filing", "itr", <ITRFiling />],
];

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route
              path="/login"
              element={
                <PublicOnly>
                  <Login />
                </PublicOnly>
              }
            />
            <Route
              path="/signup"
              element={
                <PublicOnly>
                  <Signup />
                </PublicOnly>
              }
            />
            <Route
              path="/"
              element={
                <Protected>
                  <AppLayout />
                </Protected>
              }
            >
              <Route index element={<Home />} />
              {guarded.map(([path, permission, element]) => (
                <Route key={path} path={path} element={<Guard permission={permission}>{element}</Guard>} />
              ))}
              <Route
                path="*"
                element={
                  <Suspense fallback={<Spinner />}>
                    <NotFound />
                  </Suspense>
                }
              />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
