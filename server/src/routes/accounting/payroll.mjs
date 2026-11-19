// Payroll endpoints: masters, employees, salary structures, statutory config, attendance, leave, runs, slips.

import { z } from "zod";
import { acctAudit, nowIso, uuid } from "../../accounting/access.mjs";
import { sendTable, toPdf } from "../../accounting/export.mjs";
import { amountInWords } from "../../accounting/invoice.mjs";
import { toEmployee } from "../../accounting/mappers.mjs";
import { fromMilli, fromPaise, nonNegMoney, percent, quantity } from "../../accounting/money.mjs";
import * as P from "../../accounting/payroll.mjs";
import { badRequest, conflict, notFound } from "../../lib/errors.mjs";
import { email, id, isoDate, pan, parse, requiredText, text } from "../../lib/validate.mjs";
import { A, ADMIN, patchSchema, str, W } from "./helpers.mjs";

const reqDate = () => isoDate().refine((v) => v !== "", "is required");
const period = () => z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "must be YYYY-MM");

const employeeFields = {
  employeeCode: requiredText(30),
  name: requiredText(160),
  departmentId: id().nullable().default(null),
  designationId: id().nullable().default(null),
  dateOfJoining: reqDate(),
  dateOfLeaving: isoDate().nullable().default(null),
  pan: pan().default(""),
  uan: z
    .string()
    .regex(/^(\d{12})?$/, "must be 12 digits")
    .default(""),
  esicNo: text(20).default(""),
  bankAccountNumber: text(30).default(""),
  bankIfsc: text(11).default(""),
  stateCode: z
    .string()
    .regex(/^(\d{2})?$/)
    .default(""),
  taxRegime: z.enum(["New", "Old"]).default("New"),
  pfApplicable: z.boolean().default(true),
  esiApplicable: z.boolean().default(true),
  ptApplicable: z.boolean().default(true),
  email: z.union([z.literal(""), email()]).default(""),
  active: z.boolean().default(true),
};
const EMP_COLS = {
  employeeCode: "employee_code",
  name: "name",
  departmentId: "department_id",
  designationId: "designation_id",
  dateOfJoining: "date_of_joining",
  dateOfLeaving: "date_of_leaving",
  pan: "pan",
  uan: "uan",
  esicNo: "esic_no",
  bankAccountNumber: "bank_account_number",
  bankIfsc: "bank_ifsc",
  stateCode: "state_code",
  taxRegime: "tax_regime",
  pfApplicable: "pf_applicable",
  esiApplicable: "esi_applicable",
  ptApplicable: "pt_applicable",
  email: "email",
  active: "active",
};
const dbv = (v) => (typeof v === "boolean" ? (v ? 1 : 0) : v);

export default function payrollRoutes(c, { db }) {
  const requirePayroll = (req, _res, next) => {
    if (!req.company.payroll_enabled) return next(badRequest("Payroll is not enabled for this company. Enable it in accounting settings."));
    next();
  };
  const own = (req, table, rid, label) => {
    if (!rid) return null;
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND company_id = ?`).get(rid, req.company.id);
    if (!row) throw badRequest(`${label}: not found in this company.`);
    return row;
  };

  c.post("/payroll/setup", ADMIN, (req, res) => {
    db.transaction(() => {
      db.prepare("UPDATE accounting_companies SET payroll_enabled = 1, updated_at = ? WHERE id = ?").run(nowIso(), req.company.id);
      P.ensurePayrollSetup(db, { ...req.company, payroll_enabled: 1 }, req.user.id);
      acctAudit(db, req, { companyId: req.company.id, action: "payroll.setup", entityType: "Company", entityId: req.company.id, summary: "Payroll enabled" });
    })();
    res.json({ ok: true });
  });

  c.get("/payroll/departments", requirePayroll, (req, res) =>
    res.json(db.prepare("SELECT id, kind, name FROM payroll_departments WHERE company_id = ? ORDER BY kind, name").all(req.company.id)),
  );
  c.post("/payroll/departments", requirePayroll, W, (req, res) => {
    const b = parse(z.object({ kind: z.enum(["Department", "Designation"]), name: requiredText(120) }), req.body);
    const did = uuid();
    db.prepare("INSERT INTO payroll_departments(id, organization_id, company_id, kind, name) VALUES (?,?,?,?,?)").run(
      did,
      req.company.organization_id,
      req.company.id,
      b.kind,
      b.name,
    );
    res.status(201).json({ id: did, ...b });
  });

  // Pay heads ----------------------------------------------------------------------------------------
  const toComp = (r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    calc: r.calc,
    isBasic: !!r.is_basic,
    taxable: !!r.taxable,
    pfWage: !!r.pf_wage,
    esiWage: !!r.esi_wage,
    prorate: !!r.prorate,
    ledgerId: r.ledger_id,
  });
  c.get("/payroll/components", requirePayroll, (req, res) =>
    res.json(db.prepare("SELECT * FROM payroll_components WHERE company_id = ? ORDER BY kind, name").all(req.company.id).map(toComp)),
  );
  const compSchema = z.object({
    name: requiredText(80),
    kind: z.enum(["Earning", "Deduction", "Reimbursement"]),
    calc: z.enum(["Fixed", "PercentOfBasic"]).default("Fixed"),
    isBasic: z.boolean().default(false),
    taxable: z.boolean().default(true),
    pfWage: z.boolean().default(false),
    esiWage: z.boolean().default(true),
    prorate: z.boolean().default(true),
    ledgerId: id().nullable().default(null),
  });
  c.post("/payroll/components", requirePayroll, W, (req, res) => {
    const b = parse(compSchema, req.body);
    own(req, "ledgers", b.ledgerId, "ledgerId");
    if (b.isBasic && db.prepare("SELECT 1 FROM payroll_components WHERE company_id = ? AND is_basic = 1").get(req.company.id))
      throw conflict("A basic pay head already exists.");
    const cid = uuid();
    db.prepare(
      "INSERT INTO payroll_components(id, organization_id, company_id, name, kind, calc, is_basic, taxable, pf_wage, esi_wage, prorate, ledger_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      cid,
      req.company.organization_id,
      req.company.id,
      b.name,
      b.kind,
      b.calc,
      dbv(b.isBasic),
      dbv(b.taxable),
      dbv(b.pfWage),
      dbv(b.esiWage),
      dbv(b.prorate),
      b.ledgerId,
    );
    res.status(201).json(toComp(db.prepare("SELECT * FROM payroll_components WHERE id = ?").get(cid)));
  });
  c.patch("/payroll/components/:compId", requirePayroll, W, (req, res) => {
    const b = parse(
      z
        .object({
          ledgerId: id().nullable().optional(),
          name: requiredText(80).optional(),
          taxable: z.boolean().optional(),
          pfWage: z.boolean().optional(),
          esiWage: z.boolean().optional(),
        })
        .strict(),
      req.body,
    );
    own(req, "payroll_components", req.params.compId, "component");
    own(req, "ledgers", b.ledgerId, "ledgerId");
    db.prepare(
      "UPDATE payroll_components SET ledger_id = CASE WHEN ? THEN ? ELSE ledger_id END, name = COALESCE(?, name), taxable = COALESCE(?, taxable), pf_wage = COALESCE(?, pf_wage), esi_wage = COALESCE(?, esi_wage) WHERE id = ?",
    ).run(
      b.ledgerId !== undefined ? 1 : 0,
      b.ledgerId ?? null,
      b.name ?? null,
      b.taxable === undefined ? null : dbv(b.taxable),
      b.pfWage === undefined ? null : dbv(b.pfWage),
      b.esiWage === undefined ? null : dbv(b.esiWage),
      req.params.compId,
    );
    res.json(toComp(db.prepare("SELECT * FROM payroll_components WHERE id = ?").get(req.params.compId)));
  });

  // Employees ----------------------------------------------------------------------------------------
  const EMP_SELECT = `SELECT e.*, d.name department_name, g.name designation_name FROM employees e
    LEFT JOIN payroll_departments d ON d.id = e.department_id LEFT JOIN payroll_departments g ON g.id = e.designation_id`;
  c.get("/payroll/employees", requirePayroll, (req, res) =>
    res.json(db.prepare(`${EMP_SELECT} WHERE e.company_id = ? ORDER BY e.employee_code`).all(req.company.id).map(toEmployee)),
  );
  c.post("/payroll/employees", requirePayroll, W, (req, res) => {
    const b = parse(z.object(employeeFields), req.body);
    own(req, "payroll_departments", b.departmentId, "departmentId");
    own(req, "payroll_departments", b.designationId, "designationId");
    const eid = uuid();
    const keys = Object.keys(EMP_COLS);
    db.prepare(
      `INSERT INTO employees(id, organization_id, company_id, ${keys.map((k) => EMP_COLS[k]).join(", ")}) VALUES (?,?,?,${keys.map(() => "?").join(",")})`,
    ).run(eid, req.company.organization_id, req.company.id, ...keys.map((k) => dbv(b[k])));
    acctAudit(db, req, { companyId: req.company.id, action: "employee.create", entityType: "Employee", entityId: eid, summary: `${b.employeeCode} ${b.name}` });
    res.status(201).json(toEmployee(db.prepare(`${EMP_SELECT} WHERE e.id = ?`).get(eid)));
  });
  c.patch("/payroll/employees/:empId", requirePayroll, W, (req, res) => {
    const e = own(req, "employees", req.params.empId, "employee");
    const b = parse(patchSchema(z, employeeFields), req.body);
    const keys = Object.keys(b);
    if (keys.length)
      db.prepare(`UPDATE employees SET ${keys.map((k) => `${EMP_COLS[k]} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(
        ...keys.map((k) => dbv(b[k])),
        nowIso(),
        e.id,
      );
    acctAudit(db, req, { companyId: req.company.id, action: "employee.update", entityType: "Employee", entityId: e.id, summary: e.name, before: e, after: b });
    res.json(toEmployee(db.prepare(`${EMP_SELECT} WHERE e.id = ?`).get(e.id)));
  });

  c.get("/payroll/employees/:empId/salary-structures", requirePayroll, (req, res) => {
    own(req, "employees", req.params.empId, "employee");
    const comps = new Map(
      db
        .prepare("SELECT id, name FROM payroll_components WHERE company_id = ?")
        .all(req.company.id)
        .map((x) => [x.id, x.name]),
    );
    res.json(
      db
        .prepare("SELECT * FROM employee_salary_structures WHERE employee_id = ? ORDER BY effective_from DESC")
        .all(req.params.empId)
        .map((s) => ({
          id: s.id,
          effectiveFrom: s.effective_from,
          lines: JSON.parse(s.lines_json).map((l) => ({
            componentId: l.componentId,
            component: comps.get(l.componentId),
            amount: l.amountPaise !== undefined ? fromPaise(l.amountPaise) : null,
            percent: l.percentBp !== undefined ? l.percentBp / 100 : null,
          })),
        })),
    );
  });
  c.post("/payroll/employees/:empId/salary-structures", requirePayroll, W, (req, res) => {
    const e = own(req, "employees", req.params.empId, "employee");
    const b = parse(
      z.object({
        effectiveFrom: reqDate(),
        lines: z
          .array(z.object({ componentId: id(), amount: nonNegMoney().optional(), percent: percent().optional() }))
          .min(1)
          .max(40),
      }),
      req.body,
    );
    const lines = b.lines.map((l, i) => {
      const comp = own(req, "payroll_components", l.componentId, `lines.${i}.componentId`);
      if (comp.calc === "PercentOfBasic" ? l.percent === undefined : l.amount === undefined)
        throw badRequest(`lines.${i}: ${comp.name} needs ${comp.calc === "PercentOfBasic" ? "a percentage of basic" : "a monthly amount"}.`);
      return comp.calc === "PercentOfBasic" ? { componentId: comp.id, percentBp: l.percent } : { componentId: comp.id, amountPaise: l.amount };
    });
    const sid = uuid();
    db.prepare(
      `INSERT INTO employee_salary_structures(id, organization_id, company_id, employee_id, effective_from, lines_json, created_by) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(employee_id, effective_from) DO UPDATE SET lines_json = excluded.lines_json`,
    ).run(sid, req.company.organization_id, req.company.id, e.id, b.effectiveFrom, JSON.stringify(lines), req.user.id);
    acctAudit(db, req, {
      companyId: req.company.id,
      action: "salary.structure",
      entityType: "Employee",
      entityId: e.id,
      summary: `Effective ${b.effectiveFrom}`,
    });
    res.status(201).json({ ok: true });
  });
  c.get("/payroll/employees/:empId/history", requirePayroll, (req, res) => {
    own(req, "employees", req.params.empId, "employee");
    const rows = db
      .prepare(
        "SELECT r.period, r.status, pe.gross_paise, pe.deductions_paise, pe.net_paise, s.slip_number, pe.id entry_id FROM payroll_entries pe JOIN payroll_runs r ON r.id = pe.run_id LEFT JOIN salary_slips s ON s.payroll_entry_id = pe.id WHERE pe.employee_id = ? AND r.status = 'Posted' ORDER BY r.period DESC",
      )
      .all(req.params.empId);
    res.json(
      rows.map((r) => ({
        period: r.period,
        gross: fromPaise(r.gross_paise),
        deductions: fromPaise(r.deductions_paise),
        net: fromPaise(r.net_paise),
        slipNumber: r.slip_number,
        entryId: r.entry_id,
      })),
    );
  });

  // Statutory configuration (effective-dated) ----------------------------------------------------------
  c.get("/payroll/statutory", requirePayroll, (req, res) =>
    res.json(
      db
        .prepare("SELECT * FROM payroll_statutory_configs WHERE company_id = ? ORDER BY code, effective_from DESC")
        .all(req.company.id)
        .map((s) => ({ id: s.id, code: s.code, effectiveFrom: s.effective_from, config: JSON.parse(s.config_json) })),
    ),
  );
  c.post("/payroll/statutory", requirePayroll, ADMIN, (req, res) => {
    const b = parse(z.object({ code: z.enum(["PF", "ESI", "PT", "TDS"]), effectiveFrom: reqDate(), config: z.record(z.string(), z.unknown()) }), req.body);
    // Shape check against the seed so a typo cannot silently zero a deduction.
    const required = Object.keys(P.DEFAULT_STATUTORY[b.code]);
    const missing = required.filter((k) => !(k in b.config));
    if (missing.length) throw badRequest(`config is missing: ${missing.join(", ")}`);
    db.prepare(
      `INSERT INTO payroll_statutory_configs(id, organization_id, company_id, code, effective_from, config_json, created_by) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(company_id, code, effective_from) DO UPDATE SET config_json = excluded.config_json`,
    ).run(uuid(), req.company.organization_id, req.company.id, b.code, b.effectiveFrom, JSON.stringify(b.config), req.user.id);
    acctAudit(db, req, {
      companyId: req.company.id,
      action: "payroll.statutory",
      entityType: "StatutoryConfig",
      summary: `${b.code} from ${b.effectiveFrom}`,
      after: b.config,
    });
    res.status(201).json({ ok: true });
  });

  // Attendance & leave -------------------------------------------------------------------------------
  c.get("/payroll/attendance", requirePayroll, (req, res) => {
    const p = str(req.query.period);
    if (!p) throw badRequest("period is required.");
    res.json(
      db
        .prepare(
          "SELECT a.*, e.name, e.employee_code FROM attendance_records a JOIN employees e ON e.id = a.employee_id WHERE a.company_id = ? AND a.period = ? ORDER BY e.employee_code",
        )
        .all(req.company.id, p)
        .map((a) => ({
          employeeId: a.employee_id,
          employeeCode: a.employee_code,
          name: a.name,
          workingDays: a.working_days,
          presentDays: fromMilli(a.present_days_milli),
          paidLeaveDays: fromMilli(a.paid_leave_days_milli),
          lopDays: fromMilli(a.lop_days_milli),
          overtimeHours: fromMilli(a.overtime_hours_milli),
        })),
    );
  });
  c.put("/payroll/attendance", requirePayroll, W, (req, res) => {
    const b = parse(
      z.object({
        period: period(),
        records: z
          .array(
            z.object({
              employeeId: id(),
              workingDays: z.number().int().min(0).max(31),
              presentDays: quantity(),
              paidLeaveDays: quantity().default(0),
              lopDays: quantity().default(0),
              overtimeHours: quantity().default(0),
            }),
          )
          .max(5000),
      }),
      req.body,
    );
    db.transaction(() => {
      const ins = db.prepare(
        `INSERT INTO attendance_records(id, organization_id, company_id, employee_id, period, working_days, present_days_milli, paid_leave_days_milli, lop_days_milli, overtime_hours_milli)
         VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(employee_id, period) DO UPDATE SET working_days = excluded.working_days, present_days_milli = excluded.present_days_milli,
         paid_leave_days_milli = excluded.paid_leave_days_milli, lop_days_milli = excluded.lop_days_milli, overtime_hours_milli = excluded.overtime_hours_milli`,
      );
      for (const [i, r] of b.records.entries()) {
        own(req, "employees", r.employeeId, `records.${i}.employeeId`);
        if (r.presentDays + r.paidLeaveDays + r.lopDays > r.workingDays * 1000 + 31000) throw badRequest(`records.${i}: days exceed the month.`);
        ins.run(
          uuid(),
          req.company.organization_id,
          req.company.id,
          r.employeeId,
          b.period,
          r.workingDays,
          r.presentDays,
          r.paidLeaveDays,
          r.lopDays,
          r.overtimeHours,
        );
      }
    })();
    res.json({ saved: b.records.length });
  });

  c.get("/payroll/leaves", requirePayroll, (req, res) =>
    res.json(
      db
        .prepare("SELECT l.*, e.name FROM leave_records l JOIN employees e ON e.id = l.employee_id WHERE l.company_id = ? ORDER BY l.from_date DESC")
        .all(req.company.id)
        .map((l) => ({
          id: l.id,
          employeeId: l.employee_id,
          name: l.name,
          leaveType: l.leave_type,
          fromDate: l.from_date,
          toDate: l.to_date,
          days: fromMilli(l.days_milli),
          paid: !!l.paid,
          status: l.status,
          reason: l.reason,
        })),
    ),
  );
  c.post("/payroll/leaves", requirePayroll, W, (req, res) => {
    const b = parse(
      z.object({
        employeeId: id(),
        leaveType: requiredText(40),
        fromDate: reqDate(),
        toDate: reqDate(),
        days: quantity({ min: 500 }),
        paid: z.boolean().default(true),
        reason: text(500).default(""),
        status: z.enum(["Pending", "Approved"]).default("Pending"),
      }),
      req.body,
    );
    own(req, "employees", b.employeeId, "employeeId");
    if (b.toDate < b.fromDate) throw badRequest("toDate must be on or after fromDate.");
    const lid = uuid();
    db.prepare(
      "INSERT INTO leave_records(id, organization_id, company_id, employee_id, leave_type, from_date, to_date, days_milli, paid, status, reason) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ).run(lid, req.company.organization_id, req.company.id, b.employeeId, b.leaveType, b.fromDate, b.toDate, b.days, dbv(b.paid), b.status, b.reason);
    res.status(201).json({ id: lid });
  });
  c.patch("/payroll/leaves/:leaveId", requirePayroll, A, (req, res) => {
    const b = parse(z.object({ status: z.enum(["Approved", "Rejected"]) }), req.body);
    const r = db.prepare("UPDATE leave_records SET status = ? WHERE id = ? AND company_id = ?").run(b.status, req.params.leaveId, req.company.id);
    if (!r.changes) throw notFound("Leave not found.");
    res.json({ ok: true });
  });

  // Payroll runs -------------------------------------------------------------------------------------
  c.get("/payroll/runs", requirePayroll, (req, res) =>
    res.json(
      db
        .prepare("SELECT * FROM payroll_runs WHERE company_id = ? ORDER BY period DESC, created_at DESC")
        .all(req.company.id)
        .map((r) => ({
          id: r.id,
          period: r.period,
          status: r.status,
          gross: fromPaise(r.gross_paise),
          deductions: fromPaise(r.deductions_paise),
          net: fromPaise(r.net_paise),
          voucherId: r.voucher_id,
        })),
    ),
  );
  c.post("/payroll/runs", requirePayroll, W, (req, res) => {
    const b = parse(z.object({ period: period() }), req.body);
    const r = P.createRun(db, req, req.company, b.period);
    res.status(201).json({ ...P.runDetail(db, req.company, r.id), skipped: r.skipped });
  });
  c.get("/payroll/runs/:runId", requirePayroll, (req, res) => res.json(P.runDetail(db, req.company, req.params.runId)));
  c.post("/payroll/runs/:runId/recompute", requirePayroll, W, (req, res) => {
    const run = P.loadRun(db, req.company, req.params.runId);
    if (run.status !== "Draft") throw conflict("Only draft runs can be recomputed.");
    const r = db.transaction(() => P.computeRun(db, req.company, run.id, run.period))();
    res.json({ ...P.runDetail(db, req.company, run.id), skipped: r.skipped });
  });
  c.post("/payroll/runs/:runId/post", requirePayroll, A, (req, res) => {
    const b = parse(z.object({ date: isoDate().default("") }), req.body);
    P.postRun(db, req, req.company, req.params.runId, b.date || undefined);
    res.json(P.runDetail(db, req.company, req.params.runId));
  });
  c.post("/payroll/runs/:runId/cancel", requirePayroll, A, (req, res) => {
    const b = parse(z.object({ reason: requiredText(300) }), req.body);
    P.cancelRun(db, req, req.company, req.params.runId, b.reason);
    res.json(P.runDetail(db, req.company, req.params.runId));
  });
  c.get("/payroll/runs/:runId/register", requirePayroll, (req, res) => {
    const d = P.runDetail(db, req.company, req.params.runId);
    const heads = [...new Set(d.entries.flatMap((e) => e.lines.map((l) => l.name)))];
    const table = {
      title: `Payroll register ${d.period} (${d.status})`,
      columns: ["Code", "Employee", "Paid days", ...heads, "Gross", "Deductions", "Net", "Employer PF", "Employer ESI"],
      rows: [
        ...d.entries.map((e) => [
          e.employeeCode,
          e.name,
          e.paidDays,
          ...heads.map((h) => e.lines.find((l) => l.name === h)?.amount || "0.00"),
          e.gross,
          e.deductions,
          e.net,
          e.employerPf,
          e.employerEsi,
        ]),
        ["", "Total", "", ...heads.map(() => ""), d.totals.gross, d.totals.deductions, d.totals.net, "", ""],
      ],
    };
    const format = str(req.query.format) || "json";
    if (format === "json") return res.json(table);
    sendTable(res, table, format, `payroll-register-${d.period}`, req.company.legal_name || req.company.name);
  });

  c.get("/payroll/slips/:entryId", requirePayroll, (req, res) => {
    const e = db
      .prepare(
        `SELECT pe.*, r.period, r.status run_status, s.slip_number, emp.* , pe.id entry_id FROM payroll_entries pe JOIN payroll_runs r ON r.id = pe.run_id
         JOIN employees emp ON emp.id = pe.employee_id LEFT JOIN salary_slips s ON s.payroll_entry_id = pe.id WHERE pe.id = ? AND r.company_id = ?`,
      )
      .get(req.params.entryId, req.company.id);
    if (!e) throw notFound("Salary slip not found.");
    const lines = JSON.parse(e.lines_json);
    const earnings = lines.filter((l) => l.kind === "Earning" || l.kind === "Reimbursement");
    const deductions = lines.filter((l) => !(l.kind === "Earning" || l.kind === "Reimbursement"));
    const t = {
      title: `Salary slip ${e.period} — ${e.name} (${e.employee_code})`,
      columns: ["Earnings", "Amount", "Deductions", "Amount"],
      rows: [
        ...Array.from({ length: Math.max(earnings.length, deductions.length) }, (_, i) => [
          earnings[i]?.name || "",
          earnings[i] ? fromPaise(earnings[i].amountPaise) : "",
          deductions[i]?.name || "",
          deductions[i] ? fromPaise(deductions[i].amountPaise) : "",
        ]),
        ["Gross", fromPaise(e.gross_paise), "Total deductions", fromPaise(e.deductions_paise)],
        ["Net pay", fromPaise(e.net_paise), amountInWords(e.net_paise), ""],
      ],
    };
    if (str(req.query.format) === "pdf") {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="salary-slip-${e.employee_code}-${e.period}.pdf"`);
      return res.send(
        toPdf(t, {
          subtitle: `${req.company.legal_name || req.company.name} · Slip ${e.slip_number || "(draft)"} · Paid days ${fromMilli(e.paid_days_milli)} / ${e.working_days} · PAN ${e.pan || "—"} · UAN ${e.uan || "—"}`,
        }),
      );
    }
    res.json({
      slipNumber: e.slip_number,
      status: e.run_status,
      period: e.period,
      employee: { code: e.employee_code, name: e.name, pan: e.pan, uan: e.uan },
      paidDays: fromMilli(e.paid_days_milli),
      workingDays: e.working_days,
      ...t,
    });
  });

  // Payroll calculator preview for one employee (no save).
  c.get("/payroll/employees/:empId/preview", requirePayroll, (req, res) => {
    const e = own(req, "employees", req.params.empId, "employee");
    const p = str(req.query.period) || new Date().toISOString().slice(0, 7);
    const comps = db.prepare("SELECT * FROM payroll_components WHERE company_id = ?").all(req.company.id);
    const r = P.computePay(db, req.company, e, p, comps);
    if (r.skipped) return res.json({ skipped: r.skipped });
    res.json({
      period: p,
      gross: fromPaise(r.gross),
      deductions: fromPaise(r.deductions),
      net: fromPaise(r.net),
      lines: r.lines.map((l) => ({ name: l.name, kind: l.kind, amount: fromPaise(l.amountPaise) })),
    });
  });
}
