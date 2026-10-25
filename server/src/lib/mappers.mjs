// Row → API shape mappers. Keep the public contract in camelCase and never leak secrets.

const json = (value, fallback) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

export const toUser = (r) => ({
  id: r.id,
  name: r.name,
  email: r.email,
  phone: r.phone || "",
  role: r.role,
  professionalRole: r.professional_role,
  organizationId: r.organization_id,
  organizationName: r.organization_name ?? undefined,
  active: Boolean(r.active),
  createdAt: r.created_at,
  lastLoginAt: r.last_login_at || undefined,
  kycStatus: r.role === "Individual" ? r.kyc_status || "NOT_STARTED" : undefined,
});

export const toClient = (r) => ({
  id: r.id,
  name: r.name,
  company: r.company,
  industry: r.industry,
  email: r.email,
  phone: r.phone,
  alternatePhone: r.alternate_phone,
  clientType: r.client_type,
  legalName: r.legal_name,
  contactPerson: r.contact_person,
  pan: r.pan,
  gstin: r.gstin,
  cin: r.cin,
  address: r.address,
  city: r.city,
  state: r.state,
  country: r.country,
  pinCode: r.pin_code,
  professionActivity: r.profession_activity,
  gstRegistrationType: r.gst_registration_type,
  taxRegime: r.tax_regime,
  priority: r.priority,
  communicationPreference: r.communication_preference,
  notes: r.notes,
  fy: r.fy,
  status: r.status,
  team: r.team,
  projects: r.project_count ?? 0,
  documents: r.document_count ?? 0,
  createdAt: r.created_at,
});

export const toProject = (r) => ({
  id: r.id,
  name: r.name,
  clientId: r.client_id || null,
  clientName: r.client_name || "",
  type: r.type,
  fy: r.fy,
  currency: r.currency,
  status: r.status,
  priority: r.priority,
  startDate: r.start_date,
  endDate: r.end_date,
  team: json(r.team_json, []),
  tags: json(r.tags_json, []),
  createdAt: r.created_at,
});

export const toDocument = (r) => ({
  id: r.id,
  name: r.name,
  type: r.type,
  category: r.category,
  sizeBytes: r.size_bytes,
  mimeType: r.mime_type,
  status: r.status,
  uploadedBy: r.uploader_name || "",
  uploadedAt: r.created_at,
  clientId: r.client_id || null,
  projectId: r.project_id || null,
  projectName: r.project_name || "",
  clientName: r.client_name || "",
});

export const toTask = (r) => ({
  id: r.id,
  title: r.title,
  projectId: r.project_id || null,
  project: r.project_name || "",
  client: r.client_name || "",
  assigneeId: r.assignee_id || null,
  assignee: r.assignee_name || "Unassigned",
  priority: r.priority,
  due: r.due,
  status: r.status,
});

export function complianceStatus(r, today = new Date().toISOString().slice(0, 10)) {
  if (r.completed) return "Completed";
  if (r.due_date < today) return "Overdue";
  const soon = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  return r.due_date <= soon ? "Due Soon" : "Upcoming";
}

export const toCompliance = (r) => ({
  id: r.id,
  title: r.title,
  clientId: r.client_id || null,
  client: r.client_name || "",
  category: r.category,
  dueDate: r.due_date,
  status: complianceStatus(r),
});

export const toKnowledge = (r) => ({
  id: r.id,
  title: r.title,
  kind: r.kind,
  owner: r.owner,
  body: r.body,
  updated: r.updated_at,
});

export const toMessage = (m) => ({
  id: m.id,
  role: m.role,
  content: m.content,
  createdAt: m.created_at,
  sources: json(m.sources_json, []),
  limitations: m.limitations || undefined,
  model: m.model || undefined,
});

export const toAsset = (r) => ({
  id: r.id,
  name: r.name,
  category: r.category,
  value: r.value,
  institution: r.institution,
  asOf: r.as_of,
});

export const toItr = (r) => ({
  id: r.id,
  assessmentYear: r.assessment_year,
  itrType: r.itr_type,
  status: r.status,
  payload: json(r.payload_json, {}),
  validation: json(r.validation_json, {}),
  transactionId: r.transaction_id || undefined,
  acknowledgementNumber: r.acknowledgement_number || undefined,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const toAudit = (r) => ({
  id: r.id,
  actor: r.actor_name,
  action: r.action,
  resource: r.resource,
  timestamp: r.created_at,
  ip: r.ip || undefined,
  metadata: json(r.metadata_json, {}),
});
