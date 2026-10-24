import { Link } from "react-router-dom";
import { ArrowUpRight, BrainCircuit } from "lucide-react";
import { Badge, ErrorBox, Notice, PageHeader, Spinner } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { Agent } from "../types";

export default function AIAgents() {
  const { meta } = useAuth();
  const { data: agents, error, loading, reload } = useAsync(() => api.get<Agent[]>("/assistant/agents"));
  return (
    <>
      <PageHeader
        eyebrow="AI PLATFORM"
        title="AI Agents"
        description="Specialized assistants for financial analysis, tax, audit, investment, compliance, spreadsheets and documents."
      />
      {meta && !meta.ai.enabled && (
        <Notice title="AI is not configured" tone="warning">
          Agents will not generate analysis until an administrator configures an AI provider on the server.
        </Notice>
      )}
      <ErrorBox message={error} onRetry={reload} />
      {loading && !agents ? (
        <Spinner />
      ) : (
        <div className="agent-grid">
          {agents?.map((a) => (
            <Link to={`/ai-assistant?agent=${a.id}`} className="agent-card" key={a.id}>
              <div className="agent-top">
                <div className="agent-icon">
                  <BrainCircuit size={20} />
                </div>
                <Badge tone="info">{a.category}</Badge>
              </div>
              <h3>{a.name}</h3>
              <p>{a.description}</p>
              <div className="capability-list">
                {a.capabilities.slice(0, 5).map((c) => (
                  <span key={c}>✓ {c}</span>
                ))}
              </div>
              <div className="agent-footer">
                <span>Open assistant</span>
                <ArrowUpRight size={16} />
              </div>
            </Link>
          ))}
        </div>
      )}
      <Notice title="Professional review safeguard">
        AI outputs are assistive. Tax, audit, investment, valuation and compliance outputs must be reviewed by a qualified professional.
      </Notice>
    </>
  );
}
