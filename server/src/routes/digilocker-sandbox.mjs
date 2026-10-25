import crypto from "node:crypto";
import express, { Router } from "express";
import { SANDBOX_CLIENT } from "../config.mjs";

// ---------------------------------------------------------------------------------------------
// Local DigiLocker sandbox (KYC_MODE=sandbox, never in production).
//
// Simulates the DigiLocker / MeriPehchaan OAuth2 + PKCE "requester" flow closely enough that the
// real client code in services/digilocker.mjs runs unchanged against it:
//   browser  → GET  /authorize  (sign in with Aadhaar/mobile + OTP, then consent)
//   browser  ← 302  redirect_uri?code&state
//   server   → POST /token      (code + code_verifier + client credentials → access_token)
//   server   → GET  /user, /files/issued, /xml?uri=…, /xml/eaadhaar  (Bearer token)
//
// All identities below are fictional test data. Aadhaar numbers are never exposed in full.
// ---------------------------------------------------------------------------------------------

export const SANDBOX_OTP = "123456";

export const SANDBOX_IDENTITIES = [
  {
    id: "rahul",
    name: "Rahul Verma",
    dob: "1990-05-15",
    gender: "M",
    pan: "ABCPV1234K",
    aadhaarLast4: "4821",
    mobile: "9000000001",
    hasPan: true,
    note: "Aadhaar + PAN — verification succeeds",
  },
  {
    id: "priya",
    name: "Priya Sharma",
    dob: "1988-11-02",
    gender: "F",
    pan: "BQSPS5678L",
    aadhaarLast4: "7310",
    mobile: "9000000002",
    hasPan: true,
    note: "Aadhaar + PAN — verification succeeds",
  },
  {
    id: "amit",
    name: "Amit Kumar",
    dob: "1995-01-20",
    gender: "M",
    pan: "CTKPK9012M",
    aadhaarLast4: "5096",
    mobile: "9000000003",
    hasPan: false,
    note: "Aadhaar only, no PAN in locker — verification fails",
  },
];

const TTL = { code: 5 * 60_000, token: 10 * 60_000, login: 10 * 60_000 };
const sha256b64 = (v) => crypto.createHash("sha256").update(v).digest("base64url");
const token = () => crypto.randomBytes(24).toString("base64url");
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ddmmyyyy = (iso) => iso.split("-").reverse().join("-");
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export default function digilockerSandboxRoutes({ config }) {
  const r = Router();
  const pending = new Map(); // loginId -> { params, identity?, expires }
  const codes = new Map(); // code -> { identity, challenge, redirectUri, expires }
  const tokens = new Map(); // token -> { identity, expires }

  const sweep = () => {
    const now = Date.now();
    for (const m of [pending, codes, tokens]) for (const [k, v] of m) if (v.expires < now) m.delete(k);
  };
  const take = (map, key) => {
    sweep();
    const v = map.get(key);
    map.delete(key);
    return v;
  };

  r.use(express.urlencoded({ extended: false, limit: "16kb" }));
  r.use((_req, res, next) => {
    res.setHeader("X-Robots-Tag", "noindex");
    // Helmet's global "no-referrer" makes browsers send `Origin: null` on form posts, which the CSRF
    // origin check (correctly) rejects. The sandbox pages post to themselves, so same-origin is fine.
    res.setHeader("Referrer-Policy", "same-origin");
    next();
  });

  // ---- 1. Authorize: validate the OAuth request, show sign-in ---------------------------------
  r.get("/authorize", (req, res) => {
    const q = req.query;
    const params = {
      clientId: String(q.client_id || ""),
      redirectUri: String(q.redirect_uri || ""),
      state: String(q.state || ""),
      challenge: String(q.code_challenge || ""),
      method: String(q.code_challenge_method || ""),
    };
    const problem =
      q.response_type !== "code"
        ? "response_type must be 'code'"
        : params.clientId !== SANDBOX_CLIENT.id
          ? "Unknown client_id"
          : params.redirectUri !== config.kyc.redirectUri
            ? "redirect_uri is not registered for this client"
            : !params.state
              ? "state is required"
              : params.method !== "S256" || params.challenge.length < 43
                ? "PKCE (S256) is required"
                : null;
    if (problem)
      return res
        .status(400)
        .type("html")
        .send(page("Invalid request", `<p class="err">${esc(problem)}</p>`));

    const loginId = token();
    pending.set(loginId, { params, expires: Date.now() + TTL.login });
    res.type("html").send(signInPage(loginId));
  });

  // ---- 2. Sign-in: choose a test identity (or a custom one) + OTP -----------------------------
  r.post("/login", (req, res) => {
    sweep();
    const b = req.body || {};
    const flow = pending.get(String(b.login_id || ""));
    if (!flow)
      return res
        .status(400)
        .type("html")
        .send(page("Session expired", '<p class="err">This sign-in session expired. Go back to Finpro and start verification again.</p>'));

    let identity;
    if (b.identity === "custom") {
      const pan = String(b.pan || "")
        .trim()
        .toUpperCase();
      const dob = String(b.dob || "").trim();
      const name = String(b.name || "").trim();
      const error = !name
        ? "Enter a name."
        : !/^\d{4}-\d{2}-\d{2}$/.test(dob)
          ? "Enter a date of birth."
          : pan && !PAN_RE.test(pan)
            ? "PAN format is invalid."
            : null;
      if (error)
        return res
          .status(400)
          .type("html")
          .send(signInPage(b.login_id, error, b));
      identity = {
        id: "custom",
        name: name.slice(0, 80),
        dob,
        gender: "U",
        pan,
        hasPan: Boolean(pan),
        aadhaarLast4: String(crypto.randomInt(1000, 9999)),
        mobile: "9000000000",
      };
    } else {
      identity = SANDBOX_IDENTITIES.find((i) => i.id === b.identity);
      if (!identity)
        return res
          .status(400)
          .type("html")
          .send(signInPage(b.login_id, "Choose a test account.", b));
    }
    if (String(b.otp || "").trim() !== SANDBOX_OTP)
      return res
        .status(400)
        .type("html")
        .send(signInPage(b.login_id, `Incorrect OTP. The sandbox OTP is ${SANDBOX_OTP}.`, b));

    flow.identity = identity;
    res.type("html").send(consentPage(b.login_id, identity));
  });

  // ---- 3. Consent → redirect back with code (or access_denied) --------------------------------
  r.post("/consent", (req, res) => {
    const b = req.body || {};
    const flow = take(pending, String(b.login_id || ""));
    if (!flow?.identity)
      return res.status(400).type("html").send(page("Session expired", '<p class="err">This sign-in session expired. Start again from Finpro.</p>'));
    const back = new URL(flow.params.redirectUri);
    back.searchParams.set("state", flow.params.state);
    if (b.decision !== "allow") {
      back.searchParams.set("error", "access_denied");
      back.searchParams.set("error_description", "User denied consent");
      return res.redirect(303, back.toString());
    }
    const code = token();
    codes.set(code, { identity: flow.identity, challenge: flow.params.challenge, redirectUri: flow.params.redirectUri, expires: Date.now() + TTL.code });
    back.searchParams.set("code", code);
    res.redirect(303, back.toString());
  });

  // ---- 4. Token endpoint (server-to-server) ----------------------------------------------------
  r.post("/token", (req, res) => {
    const b = req.body || {};
    const fail = (status, error, description) => res.status(status).json({ error, error_description: description });
    if (b.grant_type !== "authorization_code") return fail(400, "unsupported_grant_type", "grant_type must be authorization_code");
    if (b.client_id !== SANDBOX_CLIENT.id || b.client_secret !== SANDBOX_CLIENT.secret) return fail(401, "invalid_client", "Client authentication failed");
    const grant = take(codes, String(b.code || ""));
    if (!grant) return fail(400, "invalid_grant", "Authorization code is invalid or expired");
    if (b.redirect_uri !== grant.redirectUri) return fail(400, "invalid_grant", "redirect_uri mismatch");
    if (!b.code_verifier || sha256b64(String(b.code_verifier)) !== grant.challenge) return fail(400, "invalid_grant", "PKCE verification failed");
    const access = token();
    tokens.set(access, { identity: grant.identity, expires: Date.now() + TTL.token });
    res.json({
      access_token: access,
      token_type: "Bearer",
      expires_in: TTL.token / 1000,
      scope: "files.issueddocs",
      digilockerid: `sandbox-${grant.identity.id}`,
    });
  });

  // ---- 5. Resource endpoints (Bearer token) ----------------------------------------------------
  const bearer = (req, res, next) => {
    sweep();
    const t = /^Bearer (.+)$/.exec(req.get("authorization") || "")?.[1];
    const entry = t && tokens.get(t);
    if (!entry) return res.status(401).json({ error: "invalid_token" });
    req.sandboxIdentity = entry.identity;
    next();
  };

  r.get("/user", bearer, (req, res) => {
    const i = req.sandboxIdentity;
    res.json({ digilockerid: `sandbox-${i.id}`, name: i.name, dob: ddmmyyyy(i.dob), gender: i.gender, eaadhaar: "Y", reference_key: `sandbox-${i.id}` });
  });

  r.get("/files/issued", bearer, (req, res) => {
    const i = req.sandboxIdentity;
    const items = [
      {
        name: "Aadhaar Card",
        type: "file",
        doctype: "ADHAR",
        issuer: "Unique Identification Authority of India",
        uri: `in.gov.uidai-ADHAR-sandbox${i.aadhaarLast4}`,
      },
    ];
    if (i.hasPan)
      items.push({ name: "PAN Verification Record", type: "file", doctype: "PANCR", issuer: "Income Tax Department", uri: `in.gov.pan-PANCR-${i.pan}` });
    res.json({ items, resource: "digilocker-sandbox" });
  });

  r.get("/xml", bearer, (req, res) => {
    const i = req.sandboxIdentity;
    const uri = String(req.query.uri || "");
    if (!i.hasPan || uri !== `in.gov.pan-PANCR-${i.pan}`) return res.status(404).json({ error: "document_not_found" });
    res
      .type("application/xml")
      .send(
        `<?xml version="1.0" encoding="UTF-8"?><Certificate language="99" name="PAN Verification Record" type="PANCR" number="${i.pan}"><IssuedBy><Organization name="Income Tax Department"/></IssuedBy><IssuedTo><Person name="${esc(i.name)}" dob="${ddmmyyyy(i.dob)}" gender="${i.gender}"/></IssuedTo><CertificateData><PAN number="${i.pan}"/></CertificateData></Certificate>`,
      );
  });

  r.get("/xml/eaadhaar", bearer, (req, res) => {
    const i = req.sandboxIdentity;
    res
      .type("application/xml")
      .send(
        `<?xml version="1.0" encoding="UTF-8"?><KycRes ret="Y"><UidData uid="xxxxxxxx${i.aadhaarLast4}"><Poi name="${esc(i.name)}" dob="${ddmmyyyy(i.dob)}" gender="${i.gender}"/><Poa country="India" state="Sandbox"/></UidData></KycRes>`,
      );
  });

  return r;
}

// ---- HTML -------------------------------------------------------------------------------------

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · DigiLocker Sandbox</title>
<style>
:root{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#14213d;background:#eef2f8}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px}
.card{background:#fff;max-width:460px;width:100%;border-radius:14px;box-shadow:0 10px 30px rgba(20,33,61,.12);overflow:hidden}
.top{background:#3b2a8f;color:#fff;padding:16px 20px;display:flex;justify-content:space-between;align-items:center}
.top b{font-size:17px}.tag{background:#ffcf33;color:#3b2a8f;font-size:11px;font-weight:800;padding:3px 8px;border-radius:999px}
.body{padding:20px}h1{font-size:18px;margin:0 0 6px}p{font-size:13px;color:#4a5670;line-height:1.5}
label{display:block;font-size:12px;font-weight:600;margin:12px 0 4px}input[type=text],input[type=date]{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #cfd7e6;border-radius:8px;font-size:14px}
.opt{display:flex;gap:10px;align-items:flex-start;border:1px solid #dfe5f0;border-radius:10px;padding:10px;margin-top:8px;cursor:pointer}
.opt small{display:block;color:#6b7891;font-weight:400;margin-top:2px}
button{border:0;border-radius:8px;padding:11px 14px;font-weight:700;font-size:14px;cursor:pointer}
.primary{background:#3b2a8f;color:#fff;width:100%;margin-top:16px}.secondary{background:#eef0f6;color:#3b2a8f}
.row{display:flex;gap:8px;margin-top:16px}.row button{flex:1}
.err{background:#fdecec;color:#b42318;padding:10px;border-radius:8px;font-size:13px}
.hint{background:#fff8e1;color:#7a5a00;padding:10px;border-radius:8px;font-size:12px}
ul{font-size:13px;padding-left:18px;color:#33415c}details{margin-top:10px;font-size:13px}
</style></head><body><div class="card"><div class="top"><b>DigiLocker</b><span class="tag">SANDBOX</span></div><div class="body">${body}</div></div></body></html>`;
}

function signInPage(loginId, error, prev = {}) {
  const options = SANDBOX_IDENTITIES.map(
    (
      i,
    ) => `<label class="opt"><input type="radio" name="identity" value="${i.id}" ${prev.identity === i.id || (!prev.identity && i.id === "rahul") ? "checked" : ""}>
<span>${esc(i.name)} · Aadhaar xxxx xxxx ${i.aadhaarLast4}<small>DOB ${i.dob} · PAN ${i.hasPan ? i.pan : "—"} · ${esc(i.note)}</small></span></label>`,
  ).join("");
  return page(
    "Sign in",
    `<h1>Sign in to DigiLocker</h1>
<p>Test environment. No real Aadhaar or PAN data is used.</p>
${error ? `<p class="err">${esc(error)}</p>` : ""}
<form method="post" action="login">
<input type="hidden" name="login_id" value="${esc(loginId)}">
${options}
<label class="opt"><input type="radio" name="identity" value="custom" ${prev.identity === "custom" ? "checked" : ""}>
<span>Custom test identity<small>Use details that match the account you are verifying</small></span></label>
<details ${prev.identity === "custom" ? "open" : ""}><summary>Custom identity details</summary>
<label>Name (as on Aadhaar)<input type="text" name="name" value="${esc(prev.name)}" maxlength="80"></label>
<label>Date of birth<input type="date" name="dob" value="${esc(prev.dob)}"></label>
<label>PAN (leave empty to simulate "no PAN in locker")<input type="text" name="pan" value="${esc(prev.pan)}" maxlength="10" style="text-transform:uppercase"></label>
</details>
<label>OTP sent to registered mobile<input type="text" name="otp" inputmode="numeric" maxlength="6" placeholder="${SANDBOX_OTP}" required></label>
<p class="hint">Sandbox OTP is always <b>${SANDBOX_OTP}</b>.</p>
<button class="primary" type="submit">Sign in</button>
</form>`,
  );
}

function consentPage(loginId, i) {
  return page(
    "Consent",
    `<h1>Finpro AI is requesting access</h1>
<p>Signed in as <b>${esc(i.name)}</b> (Aadhaar xxxx xxxx ${i.aadhaarLast4}).</p>
<p>Finpro AI will be able to read:</p>
<ul><li>Name, date of birth and gender</li><li>Aadhaar (masked — last 4 digits only)</li><li>PAN Verification Record${i.hasPan ? "" : " — <i>not available in this locker</i>"}</li></ul>
<p>Purpose: identity verification (KYC). Access expires in 10 minutes.</p>
<form method="post" action="consent"><input type="hidden" name="login_id" value="${esc(loginId)}">
<div class="row"><button class="secondary" name="decision" value="deny" type="submit">Deny</button><button class="primary" style="margin-top:0" name="decision" value="allow" type="submit">Allow</button></div>
</form>`,
  );
}
