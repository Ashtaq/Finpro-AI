// Runs the API in watch mode and explains, instead of hanging silently, when it does not come up.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudSyncHint } from "./preflight.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STARTUP_WARN_MS = 15_000;

// Only pass --env-file when .env exists: with --watch, Node 22 also tries to watch a missing
// --env-file-if-exists file and crashes with ENOENT.
const envFile = path.join(root, ".env");
const args = [...(fs.existsSync(envFile) ? [`--env-file=${envFile}`] : []), "--watch", "src/server.mjs"];
const child = spawn(process.execPath, args, {
  cwd: path.join(root, "server"),
  stdio: ["inherit", "pipe", "pipe"],
  env: process.env,
});

let timer;
const arm = (what) => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const lines = [
      `⚠ The API has not finished ${what} after ${STARTUP_WARN_MS / 1000}s and printed no error.`,
      "  This usually means Node is blocked reading files from disk.",
    ];
    const hint = cloudSyncHint();
    if (hint) lines.push(`  ${hint}`);
    lines.push("  Stop with Ctrl+C. If it persists: move the project to a non-synced folder (e.g. ~/Projects) and reinstall.");
    console.error(`\n${lines.join("\n")}\n`);
  }, STARTUP_WARN_MS);
};

console.log("Starting Finpro API…");
arm("starting");

const watch = (stream, out) => {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    out.write(chunk);
    if (chunk.includes("Finpro API listening")) clearTimeout(timer);
    else if (chunk.includes("Restarting '")) arm("restarting");
    else if (chunk.includes("Waiting for file changes before restarting")) clearTimeout(timer);
  });
};
watch(child.stdout, process.stdout);
watch(child.stderr, process.stderr);

const stop = (signal) => child.kill(signal);
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
child.on("exit", (code, signal) => {
  clearTimeout(timer);
  process.exit(signal ? 0 : (code ?? 0));
});
