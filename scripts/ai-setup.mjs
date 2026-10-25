// One-time setup for AI_Assistant_Code: creates a Python virtualenv and installs dependencies.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "AI_Assistant_Code");
const isWin = process.platform === "win32";
const venvPython = path.join(dir, ".venv", isWin ? "Scripts/python.exe" : "bin/python");

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: dir, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

const python = ["python3.13", "python3.12", "python3.11", "python3", "python"].find((p) => {
  const r = spawnSync(p, ["-c", "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)"]);
  return r.status === 0;
});
if (!python) {
  console.error("✖ Python 3.11+ not found. Install it first (macOS: `brew install python@3.13`).");
  process.exit(1);
}

if (!fs.existsSync(venvPython)) {
  console.log(`Creating virtualenv with ${python}…`);
  run(python, ["-m", "venv", ".venv"]);
}
console.log("Installing AI service dependencies…");
run(venvPython, ["-m", "pip", "install", "--disable-pip-version-check", "-q", "-r", "requirements-dev.txt"]);
console.log("✔ AI service ready. Start everything with `npm run dev:all` (or only the AI service with `npm run dev:ai`).");
