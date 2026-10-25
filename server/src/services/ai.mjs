// Client for the AI_Assistant_Code service (FastAPI). Prompts, model routing (Ollama / hosted
// open-source / top model), PII masking and caching live there; this side owns auth, tenancy,
// document access and audit. The app never fabricates model output: when AI is not configured,
// the assistant says so plainly.

export const AGENTS = [
  {
    id: "finance",
    name: "Finance Analyst",
    category: "Core Finance",
    description: "Analyze statements, ratios, profitability, trends, cash flow and financial risk.",
    capabilities: ["P&L analysis", "Balance sheet analysis", "Ratio analysis", "Cash flow", "Working capital", "Risk analysis"],
  },
  {
    id: "tax",
    name: "Tax Assistant",
    category: "Tax",
    description: "Review tax documents, reconciliations and explain Indian income-tax concepts.",
    capabilities: ["Tax document review", "Reconciliation checks", "Issue identification", "Document comparison"],
  },
  {
    id: "audit",
    name: "Audit Assistant",
    category: "Audit",
    description: "Support audit planning, risk assessment, transaction review and working papers.",
    capabilities: ["Audit planning", "Risk assessment", "Duplicate detection", "Outlier analysis", "Working papers"],
  },
  {
    id: "investment",
    name: "CFA / Investment Agent",
    category: "Investment",
    description: "Support company analysis, DCF, comps, multiples, scenarios and risk analysis.",
    capabilities: ["DCF", "Trading comps", "Multiples", "Scenario analysis", "Risk analysis"],
  },
  {
    id: "compliance",
    name: "CS / Compliance Agent",
    category: "Compliance",
    description: "Assist with corporate documents, compliance checklists and deadline management.",
    capabilities: ["Checklist generation", "Deadline tracking", "Corporate documents", "Board material"],
  },
  {
    id: "excel",
    name: "Excel AI Agent",
    category: "Data",
    description: "Explain spreadsheets, formulas, data quality and worksheet comparisons.",
    capabilities: ["Formula explanation", "Formula generation", "Data cleaning", "Duplicates", "Worksheet comparison"],
  },
  {
    id: "document",
    name: "Document Intelligence",
    category: "Documents",
    description: "Summarize and compare uploaded business documents with source references.",
    capabilities: ["Summaries", "Cross-document comparison", "Source references"],
  },
];

export const findAgent = (id) => AGENTS.find((a) => a.id === id);

const NOT_CONFIGURED = {
  content:
    "The AI assistant is not configured for this workspace yet, so no analysis was generated. An administrator needs to start the AI service and set AI_PROVIDER=service on the server.",
  limitations: "AI provider not configured.",
  model: null,
  usage: null,
  tier: null,
};

class AiServiceError extends Error {
  constructor(message, { status = 502, userMessage } = {}) {
    super(message);
    this.status = status;
    this.userMessage = userMessage;
  }
}

const requestBody = ({ agent, history, message, documents, ctx, complexity = "auto" }) =>
  JSON.stringify({
    agent_id: agent.id,
    message,
    history: history.map((m) => ({ role: m.role, content: m.content })),
    documents: documents.map((d) => ({ name: d.name, text: d.text ?? null })),
    context: {
      org_id: ctx.orgId,
      user_id: ctx.userId ?? null,
      user_role: ctx.userRole ?? null,
      project_name: ctx.projectName ?? null,
      client_name: ctx.clientName ?? null,
    },
    complexity,
  });

/** Map the AI service's ChatResponse to what we store. */
function toResult(data, documents) {
  const skipped = documents.filter((d) => d.text == null).map((d) => d.name);
  const limitations = [
    skipped.length ? `Contents of ${skipped.join(", ")} were not read (PDF/DOCX/XLSX/image extraction is not enabled).` : null,
    data.limitations || null,
  ].filter(Boolean);
  return {
    content: data.content || "The model returned an empty response.",
    limitations: limitations.length ? limitations.join(" ") : null,
    model: data.provider && data.model ? `${data.provider}/${data.model}` : data.model || null,
    usage: data.usage || null,
    tier: data.tier || null,
  };
}

/** Parse a Server-Sent Events byte stream into (event, data) calls. */
async function readSse(body, onEvent, onActivity) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    onActivity();
    buffer += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = "message";
      const data = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (data.length) onEvent(event, JSON.parse(data.join("\n")));
    }
  }
}

export function createAiService(config, fetchImpl = globalThis.fetch) {
  const enabled = config.ai.provider === "service";
  const { serviceUrl, serviceToken, timeoutMs } = config.ai;
  const headers = { "content-type": "application/json", authorization: `Bearer ${serviceToken}` };

  const unreachable = (err, timedOut) =>
    new AiServiceError(timedOut ? "AI service timed out" : `AI service unreachable at ${serviceUrl}: ${err?.cause?.code || err?.message}`, {
      status: timedOut ? 504 : 503,
      userMessage: timedOut
        ? "The AI took too long to answer. Please try a shorter question or try again."
        : config.isProd
          ? "The AI assistant is temporarily unavailable. Please try again shortly."
          : "The AI service is not running. Start it from the AI_Assistant_Code repo (see its README).",
    });
  // In development show the AI service's reason (e.g. "run `ollama pull qwen3:8b`"); in production stay generic.
  const failed = (status, detail) =>
    new AiServiceError(`AI service error (${status}): ${detail || "unknown"}`, {
      status: status === 401 ? 502 : status,
      userMessage:
        status === 401 ? "The AI service rejected the server's credentials (check AI_SERVICE_TOKEN)." : config.isProd ? undefined : detail || undefined,
    });

  return {
    enabled,
    provider: enabled ? "service" : "none",

    /**
     * Whole answer at once.
     * @param {{agent, history: {role,content}[], message: string, documents: {name, text?:string|null}[], ctx, complexity?: "auto"|"fast"|"top"}} input
     */
    async reply(input) {
      if (!enabled) return NOT_CONFIGURED;
      let response;
      try {
        response = await fetchImpl(`${serviceUrl}/v1/chat`, {
          method: "POST",
          headers,
          body: requestBody(input),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        throw unreachable(err, err?.name === "TimeoutError");
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw failed(response.status, data?.error);
      return toResult(data, input.documents);
    },

    /**
     * Streamed answer. Calls onEvent("meta" | "delta", data) as text arrives and resolves with the final result.
     * Aborting `signal` closes the connection, which stops the model. `timeoutMs` is the longest allowed silence.
     */
    async stream({ signal, onEvent, ...input }) {
      if (!enabled) {
        onEvent("delta", { text: NOT_CONFIGURED.content });
        return NOT_CONFIGURED;
      }
      const idle = new AbortController();
      let timer;
      const touch = () => {
        clearTimeout(timer);
        timer = setTimeout(() => idle.abort(), timeoutMs);
      };
      touch();
      const combined = signal ? AbortSignal.any([signal, idle.signal]) : idle.signal;
      let result = null;
      let failure = null;
      try {
        let response;
        try {
          response = await fetchImpl(`${serviceUrl}/v1/chat/stream`, { method: "POST", headers, body: requestBody(input), signal: combined });
        } catch (err) {
          if (signal?.aborted) throw err;
          throw unreachable(err, idle.signal.aborted);
        }
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw failed(response.status, data?.error);
        }
        try {
          await readSse(
            response.body,
            (event, data) => {
              if (event === "done") result = toResult(data, input.documents);
              else if (event === "error") failure = data;
              else onEvent(event, data);
            },
            touch,
          );
        } catch (err) {
          if (signal?.aborted) throw err;
          throw unreachable(err, idle.signal.aborted);
        }
      } finally {
        clearTimeout(timer);
      }
      if (result) return result;
      throw failed(502, failure?.error || "The AI service closed the stream without an answer.");
    },
  };
}
