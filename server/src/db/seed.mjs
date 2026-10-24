import { hashPassword } from "../lib/password.mjs";

export const DEMO_PASSWORD = "Demo@Finpro2026";
export const DEMO_ACCOUNTS = [
  { email: "professional@finpro.demo", role: "Professional User" },
  { email: "finance@finpro.demo", role: "Finance User" },
  { email: "individual@finpro.demo", role: "Individual" },
];

/** Seed a demo dataset into an empty database. Returns false if users already exist. */
export async function seedDemo(db) {
  if (db.prepare("SELECT COUNT(*) AS c FROM users").get().c > 0) return false;
  const hash = await hashPassword(DEMO_PASSWORD);
  const d = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

  db.transaction(() => {
    const org = db.prepare("INSERT INTO organizations(id, name, plan, kind) VALUES (?,?,?,?)");
    org.run("org-demo", "Meridian Advisory LLP", "Business", "workspace");
    org.run("org-demo-personal", "Individual Demo — Personal", "Free", "personal");

    const user = db.prepare("INSERT INTO users(id, organization_id, name, email, password_hash, role, professional_role) VALUES (?,?,?,?,?,?,?)");
    user.run("u-demo-pro", "org-demo", "Aarav Mehta", "professional@finpro.demo", hash, "Professional User", "CA");
    user.run("u-demo-fin", "org-demo", "Riya Sharma", "finance@finpro.demo", hash, "Finance User", "Other");
    user.run("u-demo-ind", "org-demo-personal", "Individual Demo", "individual@finpro.demo", hash, "Individual", "Other");
    db.prepare("INSERT INTO individual_profiles(user_id, residential_status) VALUES (?, 'Resident')").run("u-demo-ind");

    const client = db.prepare(
      "INSERT INTO clients(id, organization_id, name, company, industry, email, phone, fy, status, team, contact_person) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    );
    client.run(
      "c-demo-1",
      "org-demo",
      "Rahul Kapoor",
      "Aster Manufacturing Pvt Ltd",
      "Manufacturing",
      "rahul@aster.example",
      "+91 98765 43210",
      "FY 2025-26",
      "Active",
      "Industrial",
      "Rahul Kapoor",
    );
    client.run(
      "c-demo-2",
      "org-demo",
      "Neha Iyer",
      "BluePeak Retail Ltd",
      "Retail",
      "neha@bluepeak.example",
      "+91 91234 56789",
      "FY 2025-26",
      "Onboarding",
      "Retail",
      "Neha Iyer",
    );
    client.run(
      "c-demo-3",
      "org-demo",
      "Vikram Singh",
      "Orion Software Solutions",
      "Technology",
      "vikram@orion.example",
      "+91 99887 66554",
      "FY 2025-26",
      "Active",
      "Technology",
      "Vikram Singh",
    );

    const project = db.prepare(
      "INSERT INTO projects(id, organization_id, client_id, name, type, fy, status, priority, start_date, end_date, team_json, tags_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    project.run(
      "p-demo-1",
      "org-demo",
      "c-demo-1",
      "FY26 Financial Health Review",
      "Financial Analysis",
      "FY 2025-26",
      "Active",
      "High",
      d(-60),
      d(30),
      '["Aarav Mehta","Riya Sharma"]',
      '["Ratios","Cash Flow"]',
    );
    project.run(
      "p-demo-2",
      "org-demo",
      "c-demo-2",
      "BluePeak Tax Workspace",
      "Tax Analysis",
      "FY 2025-26",
      "Under Review",
      "Medium",
      d(-30),
      d(20),
      '["Aarav Mehta"]',
      '["Tax","Reconciliation"]',
    );
    project.run(
      "p-demo-3",
      "org-demo",
      "c-demo-3",
      "Orion DCF Valuation",
      "Valuation",
      "FY 2025-26",
      "Active",
      "High",
      d(-10),
      d(45),
      '["Riya Sharma"]',
      '["DCF","Scenario"]',
    );

    const task = db.prepare("INSERT INTO tasks(id, organization_id, project_id, assignee_id, title, priority, due, status) VALUES (?,?,?,?,?,?,?,?)");
    task.run("t-demo-1", "org-demo", "p-demo-1", "u-demo-fin", "Review EBITDA bridge", "High", d(2), "In Progress");
    task.run("t-demo-2", "org-demo", "p-demo-2", "u-demo-pro", "Validate tax reconciliation", "Medium", d(4), "Review");
    task.run("t-demo-3", "org-demo", "p-demo-3", "u-demo-fin", "Update WACC assumptions", "High", d(3), "To Do");

    const ci = db.prepare("INSERT INTO compliance_items(id, organization_id, client_id, title, category, due_date) VALUES (?,?,?,?,?,?)");
    ci.run("co-demo-1", "org-demo", "c-demo-1", "Client deliverable review", "Deliverable", d(3));
    ci.run("co-demo-2", "org-demo", "c-demo-2", "Internal audit evidence pack", "Audit", d(12));
    ci.run("co-demo-3", "org-demo", "c-demo-3", "Management reporting cycle", "Internal", d(-1));

    const kb = db.prepare("INSERT INTO knowledge_items(id, organization_id, title, kind, owner) VALUES (?,?,?,?,?)");
    kb.run("k-demo-1", "org-demo", "Monthly MIS Template v3", "Template", "Aarav Mehta");
    kb.run("k-demo-2", "org-demo", "Financial Review SOP", "SOP", "Aarav Mehta");

    const asset = db.prepare("INSERT INTO assets(id, user_id, name, category, value, institution) VALUES (?,?,?,?,?,?)");
    asset.run("a-demo-1", "u-demo-ind", "Savings account", "Bank", 245000, "Demo Bank");
    asset.run("a-demo-2", "u-demo-ind", "Equity mutual funds", "Investments", 680000, "Demo AMC");
  })();
  return true;
}
