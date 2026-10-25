// Runs the AI_Assistant_Code service with reload, after checking that it (and Ollama) are ready.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "AI_Assistant_Code");
const python = path.join(dir, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");

/** Minimal .env reader so this script sees the same settings as the service. */
function readEnv() {
  const out = {};
  const file = path.join(root, ".env");
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
const env = { ...readEnv(), ...process.env };

// Exiting would make `concurrently -k` stop the web app and API too, so stay alive with instructions.
const idle = (msg) => {
  console.error(`\n✖ ${msg}\n`);
  setInterval(() => {}, 1 << 30);
};

if (!fs.existsSync(python)) {
  idle("AI service is not set up yet. Run `npm run ai:setup` once, then restart.");
} else {
  await checkOllama();
  const port = env.AI_SERVICE_PORT || "8090";
  const child = spawn(
    python,
    ["-m", "uvicorn", "app.main:create_app", "--factory", "--reload", "--reload-dir", "app", "--host", "127.0.0.1", "--port", port, "--log-level", "warning"],
    { cwd: dir, stdio: "inherit", env: process.env },
  );
  console.log(`Starting AI service on http://127.0.0.1:${port} (docs: /docs)…`);
  const stop = (signal) => child.kill(signal);
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  child.on("exit", (code, signal) => process.exit(signal ? 0 : (code ?? 0)));
}

async function checkOllama() {
  const isProd = (env.AI_ENV || env.NODE_ENV) === "production";
  const fast = env.AI_FAST_PROVIDER || (isProd ? "hosted" : "ollama");
  if (fast !== "ollama") return;
  const base = (env.OLLAMA_BASE_URL || "http://127.0.0.1:11434/v1").replace(/\/v1\/?$/, "");
  const model = env.OLLAMA_MODEL || "qwen3:8b";
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2000) });
    const tags = await res.json();
    const names = (tags.models || []).map((m) => m.name);
    if (!names.some((n) => n === model || n === `${model}:latest`))
      console.warn(`⚠ Ollama is running but model "${model}" is not pulled. Run: ollama pull ${model}`);
  } catch {
    console.warn(
      `⚠ Ollama is not reachable at ${base}. Install and start it:\n    brew install ollama && ollama serve   (or open the Ollama app)\n    ollama pull ${model}\n  The assistant will reply with an error until Ollama is running.`,
    );
  }
}
