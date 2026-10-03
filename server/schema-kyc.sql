-- Identity verification session state. Never store raw Aadhaar/PAN numbers or provider access tokens.
CREATE TABLE IF NOT EXISTS kyc_sessions (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL UNIQUE,
  code_verifier TEXT,
  name TEXT NOT NULL,
  dob TEXT NOT NULL,
  pan_last4 TEXT NOT NULL,
  account_type TEXT,
  provider TEXT NOT NULL DEFAULT 'digilocker',
  status TEXT NOT NULL DEFAULT 'PENDING',
  user_id TEXT,
  digilocker_id TEXT,
  aadhaar_verified INTEGER NOT NULL DEFAULT 0,
  pan_verified INTEGER NOT NULL DEFAULT 0,
  aadhaar_last4 TEXT,
  verified_name TEXT,
  verified_dob TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verified_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_kyc_sessions_state ON kyc_sessions(state);
CREATE INDEX IF NOT EXISTS idx_kyc_sessions_user ON kyc_sessions(user_id);
