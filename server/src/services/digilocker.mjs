import crypto from "node:crypto";

// DigiLocker (MeriPehchaan) OAuth2 + PKCE identity verification.
// Requires a registered DigiLocker requester/partner account. Endpoint URLs follow the
// published partner API and can be overridden via environment variables.
const env = (key, fallback) => process.env[key] || fallback;
const BASE = "https://digilocker.meripehchaan.gov.in/public/oauth2";
export const DIGILOCKER_URLS = {
  authorize: env("DIGILOCKER_AUTH_URL", `${BASE}/1/authorize`),
  token: env("DIGILOCKER_TOKEN_URL", `${BASE}/1/token`),
  user: env("DIGILOCKER_USER_URL", `${BASE}/1/user`),
  issuedDocs: env("DIGILOCKER_ISSUED_DOCS_URL", `${BASE}/2/files/issued`),
  docXml: env("DIGILOCKER_DOCUMENT_XML_URL", `${BASE}/1/xml`),
  aadhaarXml: env("DIGILOCKER_AADHAAR_XML_URL", `${BASE}/3/xml/eaadhaar`),
};

const normalize = (v) =>
  String(v || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const last4 = (v) =>
  String(v || "")
    .replace(/\D/g, "")
    .slice(-4);
export function normalizeDob(value) {
  const v = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(v)) {
    const [d, m, y] = v.split(/[-/]/);
    return `${y}-${m}-${d}`;
  }
  if (/^\d{8}$/.test(v)) return `${v.slice(4)}-${v.slice(2, 4)}-${v.slice(0, 2)}`;
  return v;
}
function attr(xml, tag, name) {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${name}="([^"]*)"`, "i");
  return re.exec(xml)?.[1] || "";
}
const findPan = (xml) => /\b[A-Z]{5}[0-9]{4}[A-Z]\b/.exec(String(xml || ""))?.[0] || "";

export const createPkceVerifier = () => crypto.randomBytes(48).toString("base64url");
export const pkceChallenge = (verifier) => crypto.createHash("sha256").update(verifier).digest("base64url");

export function createDigiLocker(kyc, fetchImpl = globalThis.fetch) {
  const URLS = { ...DIGILOCKER_URLS, ...(kyc.urls || {}) };
  async function get(url, token) {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json,application/xml,text/xml" },
      signal: AbortSignal.timeout(20_000),
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`DigiLocker request failed (${response.status})`);
    try {
      return { data: JSON.parse(raw), raw };
    } catch {
      return { data: null, raw };
    }
  }

  return {
    authorizationUrl({ state, codeChallenge }) {
      const url = new URL(URLS.authorize);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", kyc.clientId);
      url.searchParams.set("redirect_uri", kyc.redirectUri);
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("scope", env("DIGILOCKER_SCOPE", "files.issueddocs"));
      return url.toString();
    },

    async exchangeCode(code, verifier) {
      const body = new URLSearchParams({
        code,
        grant_type: "authorization_code",
        client_id: kyc.clientId,
        client_secret: kyc.clientSecret,
        redirect_uri: kyc.redirectUri,
        code_verifier: verifier,
      });
      const response = await fetchImpl(URLS.token, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body,
        signal: AbortSignal.timeout(20_000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || "DigiLocker token exchange failed");
      return data.access_token;
    },

    /** Verify the DigiLocker identity against the user's claimed name / DOB / PAN. Returns masked data only. */
    async verify(token, claimed) {
      const user = (await get(URLS.user, token)).data || {};
      const issued = await get(URLS.issuedDocs, token).catch(() => ({ data: {} }));
      const docs = issued.data?.items || issued.data?.documents || [];
      const panDoc = docs.find((d) => String(d.doctype || d.type || "").toUpperCase() === "PANCR");
      let panXml = "";
      if (panDoc?.uri) {
        const u = new URL(URLS.docXml);
        u.searchParams.set("uri", panDoc.uri);
        panXml = (await get(u.toString(), token).catch(() => ({ raw: "" }))).raw || "";
      }
      const hasAadhaar = String(user.eaadhaar || "").toUpperCase() === "Y" || docs.some((d) => String(d.doctype || "").toUpperCase() === "ADHAR");
      const aadhaarXml = hasAadhaar ? (await get(URLS.aadhaarXml, token).catch(() => ({ raw: "" }))).raw || "" : "";

      const name = String(user.name || attr(panXml, "Person", "name") || attr(aadhaarXml, "Poi", "name")).trim();
      const dob = normalizeDob(user.dob || attr(panXml, "Person", "dob") || attr(aadhaarXml, "Poi", "dob"));
      const panFromDoc = findPan(panXml);
      const panOk = Boolean(panDoc) && (!claimed.pan || !panFromDoc || normalize(panFromDoc) === normalize(claimed.pan));
      const nameOk = !claimed.name || !name || normalize(name) === normalize(claimed.name);
      const dobOk = !claimed.dob || !dob || dob === normalizeDob(claimed.dob);
      const aadhaarDigits = /\b\d{4}\s?\d{4}\s?\d{4}\b/.exec(aadhaarXml)?.[0] || attr(aadhaarXml, "UidData", "uid");
      return {
        verified: Boolean(hasAadhaar && panOk && nameOk && dobOk),
        reason: !hasAadhaar
          ? "aadhaar_missing"
          : !panDoc
            ? "pan_missing"
            : !panOk
              ? "pan_mismatch"
              : !nameOk
                ? "name_mismatch"
                : !dobOk
                  ? "dob_mismatch"
                  : null,
        aadhaarLast4: last4(aadhaarDigits) || null,
      };
    },
  };
}
