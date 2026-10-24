import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const ALLOWED_EXTENSIONS = new Map([
  ["pdf", "application/pdf"],
  ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["xls", "application/vnd.ms-excel"],
  ["csv", "text/csv"],
  ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["txt", "text/plain"],
  ["json", "application/json"],
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
]);
export const TEXT_EXTENSIONS = new Set(["txt", "csv", "json"]);

// Leading bytes for binary formats — reject files whose content does not match their extension.
const SIGNATURES = {
  pdf: [Buffer.from("%PDF")],
  png: [Buffer.from([0x89, 0x50, 0x4e, 0x47])],
  jpg: [Buffer.from([0xff, 0xd8, 0xff])],
  jpeg: [Buffer.from([0xff, 0xd8, 0xff])],
  xlsx: [Buffer.from([0x50, 0x4b, 0x03, 0x04])],
  docx: [Buffer.from([0x50, 0x4b, 0x03, 0x04])],
  xls: [Buffer.from([0xd0, 0xcf, 0x11, 0xe0])],
};

export const extensionOf = (name) => path.extname(String(name)).slice(1).toLowerCase();

// Control characters and characters that are unsafe in file names / Content-Disposition.
// eslint-disable-next-line no-control-regex
const UNSAFE_FILENAME_CHARS = /[\u0000-\u001f\u007f<>:"/\\|?*]/g;

export function safeDisplayName(name) {
  const base = path.basename(String(name)).replace(UNSAFE_FILENAME_CHARS, "_").trim();
  return (base || "file").slice(0, 200);
}

export function signatureMatches(ext, buffer) {
  const sigs = SIGNATURES[ext];
  if (!sigs) return !buffer.subarray(0, 4096).includes(0); // text formats: no NUL bytes
  return sigs.some((s) => buffer.subarray(0, s.length).equals(s));
}

/** Local-disk object store. Swap for S3/Azure Blob by implementing the same three methods. */
export function createLocalStorage(root) {
  fs.mkdirSync(root, { recursive: true });
  const resolve = (key) => {
    const p = path.resolve(root, key);
    if (!p.startsWith(path.resolve(root) + path.sep)) throw new Error("Invalid storage key");
    return p;
  };
  return {
    async put(orgId, buffer) {
      const key = `${orgId}/${crypto.randomUUID()}`;
      const file = resolve(key);
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(file, buffer, { flag: "wx", mode: 0o600 });
      return key;
    },
    path: resolve,
    async remove(key) {
      await fs.promises.rm(resolve(key), { force: true });
    },
    async readText(key, maxBytes) {
      const fh = await fs.promises.open(resolve(key), "r");
      try {
        const buf = Buffer.alloc(maxBytes);
        const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
        return buf.subarray(0, bytesRead).toString("utf8");
      } finally {
        await fh.close();
      }
    },
  };
}
