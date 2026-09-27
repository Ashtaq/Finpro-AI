# Finotech AI — ITR Filing Specification

**Repository:** `Ashtaq/Finpro-AI`  
**Status:** Product/technical design — implementation roadmap  
**Updated:** 27 September 2026

## 1. Purpose

This document defines the planned ITR preparation and filing capability for Finotech AI.

The module is intended to help CAs, tax professionals, finance teams and, through the appropriate workspace, individual taxpayers collect tax information, reconcile source data, calculate tax, validate returns, review them and eventually submit through an approved filing/ERI integration.

The ITR module must not present AI output as a substitute for professional judgment.

## 2. Target workflow

```
Taxpayer / Client
      ↓
Assessment Year
      ↓
Taxpayer Profile
      ↓
ITR Type / Eligibility
      ↓
Document & Data Collection
      ↓
Extraction
      ↓
AIS / TIS / 26AS / Books Reconciliation
      ↓
Deterministic Tax Computation
      ↓
Validation
      ↓
Maker / CA Review
      ↓
Client Approval
      ↓
Filing Data / JSON
      ↓
Approved Filing / ERI Provider
      ↓
e-Verification
      ↓
Acknowledgement
```

## 3. Data sources

Planned inputs:

- Form 16
- AIS
- TIS
- Form 26AS
- Bank statements
- Trial balance
- Profit & Loss
- Balance Sheet
- Capital account
- Demat/capital-gains statements
- Interest certificates
- Dividend information
- House-property/rent information
- Deduction/supporting documents
- Previous-year ITR information
- Department-provided pre-filled data where an approved integration permits it

## 4. ITR workspace

Each return should contain:

- Taxpayer profile
- Assessment year
- ITR type
- Filing status
- Income schedules
- Business/profession schedules
- House property
- Capital gains
- Deductions
- TDS/TCS
- Bank accounts
- Tax computation
- Reconciliation
- Validation
- Review
- Approval
- Filing events
- Acknowledgement

Suggested lifecycle:

```
Draft → Data Collection → Prepared → Under Review → Client Approval
→ Ready to File → Filed → e-Verified → Acknowledged
```

## 5. Deterministic tax engine

Tax calculation must be implemented as versioned deterministic business logic.

The engine should retain:

- Assessment year
- Applicable rule/version
- Income-head inputs
- Deductions
- Tax rates/slabs
- Rebate calculations
- Cess
- TDS/TCS
- Advance/self-assessment tax
- Refund/payable
- Formula/trace
- Source references
- Validation result

The LLM may explain a calculation but must not be the sole source of the calculated amount.

## 6. Reconciliation engine

The reconciliation layer should compare independent sources.

Examples:

- AIS vs books
- TIS vs books
- 26AS vs TDS ledger
- Bank interest vs AIS
- Capital-gain statement vs reported gains
- Form 16 vs salary ledger
- Previous-year ITR vs current-year return

Each mismatch should have:

- Source A
- Source B
- Difference
- Materiality
- Status
- Reviewer comment
- Resolution
- Audit timestamp

Statuses:

- Open
- Under Review
- Resolved
- Accepted Difference
- Not Applicable

## 7. AI capabilities

AI may assist with:

- Document classification
- Data extraction
- Field mapping
- Mismatch explanations
- Previous-year comparison
- Tax-document Q&A
- Calculation explanations
- Missing-document detection
- Review checklists
- Draft observations
- Client communication drafts

AI must not silently alter tax data or mark a material filing issue as resolved.

## 8. Validation

Validation should distinguish:

### Error
Return cannot proceed until corrected.

### Warning
Return can proceed only after professional review/acknowledgement.

### Information
Non-blocking informational observation.

Validation areas:

- Taxpayer details
- Assessment year
- ITR eligibility
- Mandatory schedules
- Income
- Deductions
- TDS/TCS
- Bank details
- Tax computation
- Supporting evidence
- Filing-schema compatibility

## 9. Maker-checker

The professional workflow should support:

```
Maker → Prepare → AI / Rule Validation → Reviewer → Corrections
→ Final Review → Client Approval
```

Audit data should capture who prepared, reviewed, changed, approved and filed the return.

## 10. Proposed database entities

| Entity | Purpose |
|---|---|
| `itr_profiles` | Taxpayer master/profile |
| `itr_returns` | One return for an assessment year |
| `itr_income` | Income-head data |
| `itr_deductions` | Deduction data |
| `itr_tds` | TDS/TCS data |
| `itr_capital_gains` | Capital-gains schedules |
| `itr_house_property` | House-property schedules |
| `itr_business_income` | Business/profession schedules |
| `itr_bank_accounts` | Bank/refund information |
| `itr_reconciliations` | Cross-source reconciliation |
| `itr_validations` | Rule/schema validation results |
| `itr_reviews` | Maker-checker records |
| `itr_filings` | Filing submission state |
| `itr_filing_events` | Submission/e-verification/acknowledgement events |
| `itr_documents` | Return-specific source documents |

Every production ITR record must be organization-scoped and connected to the client/taxpayer, assessment year and audit trail.

## 11. Target API contract

```
GET    /api/v1/itr/returns
POST   /api/v1/itr/returns
GET    /api/v1/itr/returns/:id
PATCH  /api/v1/itr/returns/:id

POST   /api/v1/itr/returns/:id/documents
POST   /api/v1/itr/returns/:id/reconcile
POST   /api/v1/itr/returns/:id/calculate
POST   /api/v1/itr/returns/:id/validate
POST   /api/v1/itr/returns/:id/review
POST   /api/v1/itr/returns/:id/client-approval
POST   /api/v1/itr/returns/:id/generate-json

POST   /api/v1/itr/returns/:id/submit
GET    /api/v1/itr/returns/:id/events
```

The submit endpoint must remain unavailable until the approved filing provider/ERI integration and its security/consent requirements are configured.

## 12. Filing integration boundary

Finotech should not automate browser login to the Income Tax portal using professional credentials.

Production filing should use the applicable approved provider/ERI integration through a server-side adapter.

```
Finotech → ITR Validation → Filing Adapter
       → Approved ERI / Filing Provider
       → Income Tax Department
       → Status / e-Verification / Acknowledgement
```

Sensitive provider credentials, tokens, consent artifacts and signing material must remain server-side.

Until the approved integration is configured, the application should stop at **Ready to File** or **Generate Filing Data**.

## 13. Security requirements

- Tenant isolation
- Object-level authorization
- Encryption in transit
- Encryption at rest
- Secure session/token handling
- Server-side secrets
- File validation
- Malware scanning
- Audit logging
- Consent records
- Retention policies
- Access logging
- Rate limiting
- Backup/recovery
- Secure deletion/archival policy

## 14. Delivery roadmap

### A — Preparation
- Taxpayer profile
- Assessment-year metadata
- ITR metadata
- Source documents
- Draft lifecycle
- Validation foundation

### B — Intelligence
- Form 16 extraction
- AIS/TIS/26AS ingestion
- Bank statement parsing
- Capital-gain extraction
- Reconciliation
- Mismatch detection
- Deterministic tax engine

### C — Review
- Maker-checker
- CA review
- Issue management
- Client approval
- Filing readiness

### D — Filing
- Approved ERI/provider integration
- Consent
- Prefill where permitted
- Submission
- e-Verification
- Acknowledgement
- Filing status

## 15. Production gate

Direct filing must not be enabled until:

- Applicable tax rules are versioned and tested.
- ITR schemas/validation rules are implemented.
- Deterministic tax calculations are independently tested.
- Security review is complete.
- Audit trail is complete.
- Client/taxpayer consent is implemented.
- Approved filing/ERI integration is configured.
- Provider credentials are stored securely.
- Failure/retry/idempotency behavior is tested.
- e-Verification and acknowledgement handling are tested.

## 16. Product principle

**AI assists the tax professional; deterministic rules calculate; the professional reviews; approved filing infrastructure submits.**
