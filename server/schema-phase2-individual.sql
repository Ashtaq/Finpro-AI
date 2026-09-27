-- Phase 2 Individual / ITR schema extension.
-- The individual API also creates these tables with IF NOT EXISTS for local development.
CREATE TABLE IF NOT EXISTS individual_profiles (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, pan TEXT, dob TEXT, residential_status TEXT, phone TEXT, address TEXT, aadhaar_last4 TEXT
);
CREATE TABLE IF NOT EXISTS assets (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL, value REAL NOT NULL DEFAULT 0, institution TEXT DEFAULT '', as_of TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tax_years (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, assessment_year TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Draft', gross_income REAL DEFAULT 0, taxable_income REAL DEFAULT 0, tax_payable REAL DEFAULT 0, tds REAL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS itr_returns (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, assessment_year TEXT NOT NULL, itr_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT', payload_json TEXT NOT NULL DEFAULT '{}', validation_json TEXT NOT NULL DEFAULT '{}', transaction_id TEXT, acknowledgement_number TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS itr_filing_events (
 id TEXT PRIMARY KEY, itr_return_id TEXT NOT NULL, event_type TEXT NOT NULL, status TEXT NOT NULL, metadata_json TEXT DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tax_documents (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, document_type TEXT NOT NULL, assessment_year TEXT, storage_key TEXT, status TEXT NOT NULL DEFAULT 'Uploaded', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS consents (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, purpose TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Pending', granted_at TEXT, expires_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);