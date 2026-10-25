// Dev preflight: fail fast with a clear message instead of a silently crashed or hung API.
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * macOS "Desktop & Documents in iCloud" evicts and re-syncs files in place, which makes Node
 * hang or fail (ECANCELED) while reading its own sources. Returns a hint string when the
 * project lives in such a folder, else null.
 */
export function cloudSyncHint(dir = root) {
  if (process.platform !== "darwin") return null;
  const home = os.homedir();
  const real = (() => {
    try {
      return fs.realpathSync(dir);
    } catch {
      return dir;
    }
  })();
  if (real.includes(`${path.sep}Library${path.sep}Mobile Documents${path.sep}`))
    return `This project is inside iCloud Drive (${real}). Move it to a non-synced folder such as ~/Projects.`;
  for (const name of ["Desktop", "Documents"]) {
    const local = path.join(home, name);
    const synced = fs.existsSync(path.join(home, "Library", "Mobile Documents", "com~apple~CloudDocs", name));
    if (synced && (real === local || real.startsWith(local + path.sep)))
      return `This project is in ~/${name}, which iCloud is syncing ("Desktop & Documents Folders" is on). iCloud can evict files and make Node hang or fail with ECANCELED. Move it to ~/Projects.`;
  }
  return null;
}

function check() {
  const problems = [];
  const [major] = process.versions.node.split(".").map(Number);
  if (major < 22) problems.push(`Node ${process.versions.node} is too old — install Node 22+ and make sure it is first on PATH (\`node -v\`).`);

  for (const dir of [".", "server"]) {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, dir, "package.json"), "utf8"));
    const missing = Object.keys({ ...pkg.dependencies }).filter((name) => !fs.existsSync(path.join(root, dir, "node_modules", name, "package.json")));
    if (missing.length)
      problems.push(
        `Missing packages in ${dir === "." ? "./" : "server/"}: ${missing.join(", ")} — run \`npm install${dir === "server" ? " --prefix server" : ""}\`.`,
      );
  }

  if (!problems.length) {
    try {
      createRequire(path.join(root, "server", "package.json"))("better-sqlite3");
    } catch (err) {
      problems.push(
        `better-sqlite3 native module failed to load (${err.code || err.message}). Run \`rm -rf server/node_modules && npm install --prefix server\` with Node 22+.`,
      );
    }
  }

  const hint = cloudSyncHint();
  if (hint) console.warn(`\n⚠ ${hint}\n`);

  if (problems.length) {
    console.error("\n✖ Finpro dev environment is not ready:\n");
    for (const p of problems) console.error(`  • ${p}`);
    console.error("");
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) check();
