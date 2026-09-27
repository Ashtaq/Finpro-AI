import { Link } from "react-router-dom";
import { Bell, Database, LockKeyhole, Save, SlidersHorizontal } from "lucide-react";
import { Badge, Button, PageHeader } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import "../individual.css";

const adminDefaults = [
  ["Evidence-first responses", "Require source / calculation blocks for supported workflows"],
  ["Professional review notices", "Show review warnings for high-impact outputs"],
  ["Organization knowledge", "Allow authorized agents to use internal knowledge base"],
  ["Streaming responses", "Stream assistant output into chat"],
];

const personalNotifications = [
  ["ITR preparation reminders", "Reminders for return preparation and review"],
  ["Document updates", "Updates when tax records are added or processed"],
  ["Account security alerts", "Important sign-in and account notices"],
];

export default function Settings() {
  const { user } = useAuth();

  if (user?.role === "Individual") {
    return (
      <div className="individual-settings">
        <PageHeader
          eyebrow="PERSONAL ACCOUNT"
          title="Settings"
          description="Manage your personal account, reminders and tax workspace."
          action={<Button><Save size={15} /> Save changes</Button>}
        />
        <div className="settings-grid">
          <section className="panel">
            <div className="panel-head">
              <div><h2>Account details</h2><p>Your signed-in Individual account.</p></div>
              <LockKeyhole size={18} />
            </div>
            <div className="profile-card">
              <div className="profile-avatar">{user.name.slice(0, 1)}</div>
              <div><strong>{user.name}</strong><span>{user.email}</span></div>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <div><h2>Personal notifications</h2><p>Updates for your tax preparation workflow.</p></div>
              <Bell size={18} />
            </div>
            {personalNotifications.map(([title, description]) => (
              <label className="setting-row" key={title}>
                <div><strong>{title}</strong><span>{description}</span></div>
                <input type="checkbox" defaultChecked />
              </label>
            ))}
          </section>
          <section className="panel">
            <div className="panel-head">
              <div><h2>Tax workspace</h2><p>Personal records used to prepare your return.</p></div>
              <Database size={18} />
            </div>
            <div className="list-row">
              <div><strong>Assets &amp; liabilities</strong><span>Maintain current records for tax preparation.</span></div>
              <Link className="text-link" to="/assets">Open</Link>
            </div>
            <div className="list-row">
              <div><strong>Tax documents</strong><span>Review supporting records in your workspace.</span></div>
              <Link className="text-link" to="/documents">Open</Link>
            </div>
            <div className="list-row">
              <div><strong>Income tax return</strong><span>Continue preparation and review.</span></div>
              <Link className="text-link" to="/itr-filing">Open</Link>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head">
              <div><h2>Filing &amp; privacy</h2><p>Preparation remains reviewable and account-scoped.</p></div>
              <SlidersHorizontal size={18} />
            </div>
            <div className="notice">
              <div>
                <strong>Human review remains important</strong>
                <span>Check source documents and tax calculations before relying on a return. Filing submission remains unavailable until an approved provider is connected.</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="CONFIGURATION"
        title="Settings"
        description="Organization settings, AI defaults, notifications and security controls."
        action={<Button><Save size={15} /> Save changes</Button>}
      />
      <div className="settings-grid">
        <section className="panel">
          <div className="panel-head">
            <div><h2>AI &amp; workflow defaults</h2><p>Control how assistants behave within authorized projects.</p></div>
            <SlidersHorizontal size={18} />
          </div>
          {adminDefaults.map(([title, description], index) => (
            <label className="setting-row" key={title}>
              <div><strong>{title}</strong><span>{description}</span></div>
              <input type="checkbox" defaultChecked={index !== 3} />
            </label>
          ))}
        </section>
        <section className="panel">
          <div className="panel-head">
            <div><h2>Security</h2><p>Frontend flags are illustrative; enforcement belongs in the backend.</p></div>
            <LockKeyhole size={18} />
          </div>
          {["Session timeout", "MFA readiness", "API rate limits", "Secure file access"].map((item) => (
            <div className="list-row" key={item}>
              <div><strong>{item}</strong><span>Backend-controlled setting</span></div>
              <Badge tone="success">Configured</Badge>
            </div>
          ))}
        </section>
        <section className="panel">
          <div className="panel-head">
            <div><h2>Notifications</h2><p>Task, document, report and compliance events.</p></div>
            <Bell size={18} />
          </div>
          {["Task assignments", "Document processing", "AI report completion", "Compliance reminders"].map((item) => (
            <div className="list-row" key={item}>
              <div><strong>{item}</strong><span>Email + in-app</span></div>
              <input type="checkbox" defaultChecked />
            </div>
          ))}
        </section>
        <section className="panel">
          <div className="panel-head">
            <div><h2>Data architecture</h2><p>Service layer prepared for real backend integrations.</p></div>
            <Database size={18} />
          </div>
          <div className="architecture-list">
            <div>Frontend</div><span>→</span><div>Backend API</div><span>→</span>
            <div>Document Processing</div><span>→</span><div>Retrieval / AI Validation</div>
          </div>
        </section>
      </div>
    </>
  );
}
