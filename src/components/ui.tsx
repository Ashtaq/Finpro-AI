import { Component, ErrorInfo, ReactNode, useEffect, useId } from "react";

type Tone = "default" | "success" | "warning" | "danger" | "info";

export function Badge({ children, tone = "default" }: { children: ReactNode; tone?: Tone }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Button({
  children,
  variant = "primary",
  onClick,
  disabled,
  type = "button",
  title,
  wide,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
  wide?: boolean;
}) {
  return (
    <button type={type} disabled={disabled} onClick={onClick} title={title} className={`btn btn-${variant}${wide ? " wide" : ""}`}>
      {children}
    </button>
  );
}

export function MetricCard({ label, value, delta, icon }: { label: string; value: ReactNode; delta?: string; icon: ReactNode }) {
  return (
    <div className="metric-card">
      <div className="metric-icon">{icon}</div>
      <div>
        <div className="eyebrow">{label}</div>
        <div className="metric-value">{value}</div>
        {delta && <div className="metric-delta">{delta}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden>
        ✦
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  useEffect(() => {
    document.title = `${title} · Finpro AI`;
  }, [title]);
  return (
    <div className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="page-actions">{action}</div>}
    </div>
  );
}

export function Modal({ open, title, children, onClose }: { open: boolean; title: string; children: ReactNode; onClose: () => void }) {
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={id} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 id={id}>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="loading-row" role="status">
      <div className="spinner" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <div className="error-box" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button className="text-link" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function SuccessBox({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div className="success-box" role="status">
      {message}
    </div>
  );
}

export function Notice({ title, children, tone }: { title: string; children: ReactNode; tone?: "warning" }) {
  return (
    <div className={tone === "warning" ? "notice notice-warning" : "notice"}>
      <div>
        <strong>{title}</strong>
        <span>{children}</span>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI error", error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center-screen">
        <div className="panel" style={{ maxWidth: 440, textAlign: "center" }}>
          <h2>Something went wrong</h2>
          <p className="auth-muted">The page hit an unexpected error. Reload to continue — your saved data is safe.</p>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </div>
      </div>
    );
  }
}
