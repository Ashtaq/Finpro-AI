// Single HTTP client for the Finpro API. Auth is an httpOnly session cookie — no tokens in JS.

const BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: { field: string; message: string }[],
  ) {
    super(message);
  }
}

type Body = Record<string, unknown> | unknown[] | FormData | undefined;

async function request<T>(method: string, path: string, body?: Body): Promise<T> {
  const init: RequestInit = { method, credentials: BASE ? "include" : "same-origin", headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, init);
  } catch {
    throw new ApiError(0, "Cannot reach the server. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/")) window.dispatchEvent(new Event("finpro:unauthorized"));
    throw new ApiError(res.status, data.error || `Request failed (${res.status})`, data.details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: Body) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body: Body) => request<T>("PATCH", path, body),
  put: <T>(path: string, body: Body) => request<T>("PUT", path, body),
  del: (path: string) => request<void>("DELETE", path),
  url: (path: string) => `${BASE}/api${path}`,
};

export const errorMessage = (err: unknown, fallback = "Something went wrong.") => (err instanceof Error ? err.message : fallback);

/**
 * POST that reads a Server-Sent Events response (used for streamed AI answers).
 * Errors before the stream starts are thrown as ApiError, like other requests. Abort `signal` to stop.
 */
export async function streamPost(path: string, body: Record<string, unknown>, onEvent: (event: string, data: unknown) => void, signal?: AbortSignal) {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method: "POST",
      credentials: BASE ? "include" : "same-origin",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ApiError(0, "Cannot reach the server. Check your connection and try again.");
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) window.dispatchEvent(new Event("finpro:unauthorized"));
    throw new ApiError(res.status, data.error || `Request failed (${res.status})`, data.details);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (data.length) onEvent(event, JSON.parse(data.join("\n")));
    }
  }
}
