import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Bot, Copy, Paperclip, Plus, Send, Sparkles, Trash2, X } from "lucide-react";
import { uploadDocument } from "../components/documents";
import { Badge, Button, ErrorBox, Modal, Notice } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { api, errorMessage } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useAsync } from "../lib/useAsync";
import { Agent, ChatMessage, ConversationSummary, DocumentRecord, Project } from "../types";

export default function AIAssistant() {
  const { user, meta } = useAuth();
  const [params] = useSearchParams();
  const individual = user?.role === "Individual";
  const { data: base, error: loadError } = useAsync(async () => {
    const [agents, projects, docs, conversations] = await Promise.all([
      api.get<Agent[]>("/assistant/agents"),
      individual ? Promise.resolve([] as Project[]) : api.get<Project[]>("/projects"),
      api.get<DocumentRecord[]>("/documents"),
      api.get<ConversationSummary[]>("/assistant/conversations"),
    ]);
    return { agents, projects, docs, conversations };
  });
  const [agentId, setAgentId] = useState(params.get("agent") || (individual ? "tax" : "finance"));
  const [projectId, setProjectId] = useState(params.get("project") || "");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [attached, setAttached] = useState<DocumentRecord[]>([]);
  const [picker, setPicker] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [deep, setDeep] = useState(false);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!base) return;
    setConversations(base.conversations);
    setDocs(base.docs);
  }, [base]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const newConversation = () => {
    setConversationId(null);
    setMessages([]);
    setAttached([]);
    setError("");
  };
  const openConversation = async (id: string) => {
    setError("");
    try {
      const c = await api.get<{ id: string; agentId: string; projectId: string | null; messages: ChatMessage[] }>(`/assistant/conversations/${id}`);
      setConversationId(c.id);
      setAgentId(c.agentId);
      setProjectId(c.projectId || "");
      setMessages(c.messages);
      setAttached([]);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const deleteConversation = async (id: string) => {
    if (!window.confirm("Delete this conversation?")) return;
    try {
      await api.del(`/assistant/conversations/${id}`);
      setConversations((cs) => cs.filter((c) => c.id !== id));
      if (id === conversationId) newConversation();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setError("");
    const pendingId = `pending-${Date.now()}`;
    setMessages((m) => [
      ...m,
      { id: `u-${Date.now()}`, role: "user", content: text, createdAt: new Date().toISOString() },
      { id: pendingId, role: "assistant", content: "", createdAt: new Date().toISOString(), pending: true },
    ]);
    setSending(true);
    try {
      const res = await api.post<{ conversationId: string; message: ChatMessage }>("/assistant/messages", {
        message: text,
        agentId,
        conversationId: conversationId ?? undefined,
        projectId: conversationId ? undefined : projectId || null,
        documentIds: attached.map((d) => d.id),
        complexity: deep ? "top" : "auto",
      });
      setMessages((m) => m.map((x) => (x.id === pendingId ? res.message : x)));
      if (!conversationId) {
        setConversationId(res.conversationId);
        setConversations((cs) => [
          { id: res.conversationId, title: text.slice(0, 80), agentId, projectId: projectId || null, updatedAt: new Date().toISOString() },
          ...cs,
        ]);
      }
    } catch (err) {
      setMessages((m) => m.filter((x) => x.id !== pendingId));
      setInput(text);
      setError(errorMessage(err, "AI request failed."));
    } finally {
      setSending(false);
    }
  };

  const uploadAndAttach = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      for (const f of Array.from(files)) {
        const d = await uploadDocument(f, { projectId: individual ? null : projectId || null });
        setDocs((ds) => [d, ...ds]);
        setAttached((a) => [...a, d]);
      }
    } catch (err) {
      setError(errorMessage(err, "Upload failed."));
    }
  };

  const agent = base?.agents.find((a) => a.id === agentId);
  const project = base?.projects.find((p) => p.id === projectId);
  const pickable = docs.filter((d) => !projectId || d.projectId === projectId || !d.projectId);

  return (
    <div className="ai-shell">
      <aside className="ai-history">
        <div className="ai-title">
          <Sparkles size={17} /> AI Assistant
        </div>
        <Button onClick={newConversation}>
          <Plus size={15} /> New conversation
        </Button>
        <div className="eyebrow">RECENT</div>
        {conversations.map((c) => (
          <div
            key={c.id}
            className={c.id === conversationId ? "history-item active" : "history-item"}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <button style={{ all: "unset", flex: 1, cursor: "pointer" }} onClick={() => void openConversation(c.id)}>
              {c.title.slice(0, 42)}
              <span>{formatDateTime(c.updatedAt)}</span>
            </button>
            <button className="icon-btn" aria-label="Delete conversation" onClick={() => void deleteConversation(c.id)}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </aside>
      <main className="ai-main">
        <div className="ai-top">
          <div>
            <div className="eyebrow">{individual ? "PERSONAL FINANCE ASSISTANT" : "PROJECT AI WORKSPACE"}</div>
            <h1>{agent?.name || "Assistant"}</h1>
          </div>
          <div className="ai-selects">
            {!individual && (
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={!!conversationId} aria-label="Project">
                <option value="">No project</option>
                {base?.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)} disabled={!!conversationId} aria-label="Agent">
              {base?.agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="ai-context">
          {project && <span>Project: {project.name}</span>}
          {project?.clientName && <span>Client: {project.clientName}</span>}
          <span>Attached: {attached.length ? attached.map((d) => d.name).join(", ") : project ? "latest project documents" : "none"}</span>
          <Badge tone={meta?.ai.enabled ? "success" : "warning"}>{meta?.ai.enabled ? "AI connected" : "AI not configured"}</Badge>
        </div>
        <ErrorBox message={loadError || error} />
        <div className="chat-scroll">
          {!messages.length && (
            <div className="ai-empty">
              <Bot size={28} />
              <h2>Ask a question</h2>
              <p>
                Attach documents for context. Text, CSV and JSON files are read directly; other formats are referenced by name. Turn on{" "}
                <strong>Deep analysis</strong> for complex questions.
              </p>
              {meta && !meta.ai.enabled && (
                <Notice title="AI provider not configured">The assistant will reply that analysis is unavailable until an administrator configures it.</Notice>
              )}
            </div>
          )}
          {messages.map((m) => (
            <div className={m.role === "user" ? "chat-row user" : "chat-row"} key={m.id}>
              <div className={m.role === "user" ? "chat-avatar user" : "chat-avatar"}>{m.role === "user" ? user?.name.slice(0, 1) : <Bot size={16} />}</div>
              <div className="chat-bubble">
                {m.role === "assistant" && <div className="assistant-label">{agent?.name || "Assistant"}</div>}
                <div className="chat-content">{m.pending ? "Thinking…" : m.content}</div>
                {m.role === "assistant" && !m.pending && (
                  <>
                    {(m.sources?.length || m.limitations) && (
                      <div className="evidence-grid">
                        <div>
                          <strong>Sources</strong>
                          <span>{m.sources?.length ? m.sources.map((s) => `${s.name}${s.read ? "" : " (not read)"}`).join(", ") : "None"}</span>
                        </div>
                        {m.limitations && (
                          <div>
                            <strong>Limitations</strong>
                            <span>{m.limitations}</span>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="chat-actions">
                      <button onClick={() => void navigator.clipboard?.writeText(m.content)} aria-label="Copy answer">
                        <Copy size={14} />
                      </button>
                      {m.model && <span className="chat-model">{m.model}</span>}
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
          <div ref={end} />
        </div>
        <div className="chat-composer">
          <div className="composer-attachment">
            <button className="attachment-label" type="button" onClick={() => setPicker(true)} style={{ border: 0, background: "none" }}>
              <Paperclip size={17} />
              <span>Attach documents</span>
            </button>
            {attached.map((d) => (
              <span className="attachment-chip" key={d.id}>
                {d.name}
                <button onClick={() => setAttached((a) => a.filter((x) => x.id !== d.id))} aria-label={`Remove ${d.name}`}>
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            maxLength={8000}
            aria-label="Message"
            placeholder={
              individual
                ? "Ask about your income, deductions, documents or ITR…"
                : "Ask about financial performance, tax, audit, valuation or attached documents…"
            }
          />
          <div className="composer-bottom">
            <label
              className="deep-toggle"
              title="Use the most capable model for this question. Slower and costs more; normally the assistant decides automatically."
            >
              <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} />
              Deep analysis
            </label>
            <span>AI output is assistive. Review before professional use.</span>
            <button className="icon-btn" onClick={() => void send()} disabled={sending || !input.trim()} aria-label="Send">
              <Send size={16} />
            </button>
          </div>
        </div>
      </main>
      <Modal open={picker} onClose={() => setPicker(false)} title="Attach documents">
        <div className="form-stack">
          <div className="doc-picker">
            {pickable.length ? (
              pickable.map((d) => (
                <label key={d.id}>
                  <input
                    type="checkbox"
                    checked={attached.some((a) => a.id === d.id)}
                    onChange={(e) => setAttached((a) => (e.target.checked ? [...a, d] : a.filter((x) => x.id !== d.id)))}
                    disabled={!attached.some((a) => a.id === d.id) && attached.length >= 8}
                  />
                  {d.name} <span className="muted">{d.projectName}</span>
                </label>
              ))
            ) : (
              <p className="muted">No documents yet.</p>
            )}
          </div>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => fileInput.current?.click()}>
              Upload new file
            </Button>
            <Button onClick={() => setPicker(false)}>Done</Button>
          </div>
          <input
            ref={fileInput}
            type="file"
            hidden
            multiple
            accept=".pdf,.xlsx,.xls,.csv,.docx,.txt,.json,.png,.jpg,.jpeg"
            onChange={(e) => void uploadAndAttach(e.target.files)}
          />
        </div>
      </Modal>
    </div>
  );
}
