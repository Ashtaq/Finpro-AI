// Payroll: salary structures, attendance-based proration, statutory deductions (PF, ESI, professional
// tax, TDS on salary) driven by effective-dated configuration, salary slips and accounting integration.
//
// Statutory figures below are only *seed* values inserted when payroll is switched on; every rate, ceiling
// and slab lives in payroll_statutory_configs with an effective date and is editable by an Admin.
// The professional remains responsible for verifying rates against current notifications.

import { badRequest, conflict, notFound } from "../lib/errors.mjs";
import { acctAudit, nowIso, uuid } from "./access.mjs";
import { addDays, ensureSystemLedgers, systemLedger } from "./chart.mjs";
import { fromMilli, fromPaise, mulDiv, percentOf, roundToRupee } from "./money.mjs";
import { cancelVoucher, createVoucher } from "./vouchers.mjs";

const R = (rupees) => rupees * 100; // seed helper: rupees -> paise (integers only)

export const DEFAULT_STATUTORY = {
  PF: { employeeRateBp: 1200, employerRateBp: 1200, adminChargesBp: 50, wageCeilingPaise: R(15000), applyCeiling: true },
  ESI: { employeeRateBp: 75, employerRateBp: 325, wageThresholdPaise: R(21000) },
  PT: {
    defaultStateCode: "",
    slabs: {
      27: [
        { upToPaise: R(7500), amountPaise: 0 },
        { upToPaise: R(10000), amountPaise: R(175) },
        { upToPaise: null, amountPaise: R(200), februaryAmountPaise: R(300) },
      ],
      29: [
        { upToPaise: R(24999), amountPaise: 0 },
        { upToPaise: null, amountPaise: R(200) },
      ],
      19: [
        { upToPaise: R(10000), amountPaise: 0 },
        { upToPaise: R(15000), amountPaise: R(110) },
        { upToPaise: R(25000), amountPaise: R(130) },
        { upToPaise: R(40000), amountPaise: R(150) },
        { upToPaise: null, amountPaise: R(200) },
      ],
      36: [
        { upToPaise: R(15000), amountPaise: 0 },
        { upToPaise: R(20000), amountPaise: R(150) },
        { upToPaise: null, amountPaise: R(200) },
      ],
      24: [
        { upToPaise: R(11999), amountPaise: 0 },
        { upToPaise: null, amountPaise: R(200) },
      ],
    },
  },
  TDS: {
    New: {
      standardDeductionPaise: R(75000),
      slabs: [
        { upToPaise: R(400000), rateBp: 0 },
        { upToPaise: R(800000), rateBp: 500 },
        { upToPaise: R(1200000), rateBp: 1000 },
        { upToPaise: R(1600000), rateBp: 1500 },
        { upToPaise: R(2000000), rateBp: 2000 },
        { upToPaise: R(2400000), rateBp: 2500 },
        { upToPaise: null, rateBp: 3000 },
      ],
      rebateIncomeLimitPaise: R(1200000),
      rebateMaxPaise: R(60000),
      cessBp: 400,
    },
    Old: {
      standardDeductionPaise: R(50000),
      slabs: [
        { upToPaise: R(250000), rateBp: 0 },
        { upToPaise: R(500000), rateBp: 500 },
        { upToPaise: R(1000000), rateBp: 2000 },
        { upToPaise: null, rateBp: 3000 },
      ],
      rebateIncomeLimitPaise: R(500000),
      rebateMaxPaise: R(12500),
      cessBp: 400,
    },
  },
};

export function ensurePayrollSetup(db, company, userId) {
  ensureSystemLedgers(db, company, "payroll", userId);
  const ins = db.prepare(
    "INSERT OR IGNORE INTO payroll_statutory_configs(id, organization_id, company_id, code, effective_from, config_json, created_by) VALUES (?,?,?,?,?,?,?)",
  );
  for (const [code, cfg] of Object.entries(DEFAULT_STATUTORY))
    ins.run(uuid(), company.organization_id, company.id, code, company.books_start_date, JSON.stringify(cfg), userId);
  const comps = db.prepare("SELECT COUNT(*) c FROM payroll_components WHERE company_id = ?").get(company.id).c;
  if (!comps) {
    const insC = db.prepare(
      "INSERT INTO payroll_components(id, organization_id, company_id, name, kind, calc, is_basic, taxable, pf_wage, esi_wage, prorate) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    );
    insC.run(uuid(), company.organization_id, company.id, "Basic", "Earning", "Fixed", 1, 1, 1, 1, 1);
    insC.run(uuid(), company.organization_id, company.id, "HRA", "Earning", "PercentOfBasic", 0, 1, 0, 1, 1);
    insC.run(uuid(), company.organization_id, company.id, "Special Allowance", "Earning", "Fixed", 0, 1, 0, 1, 1);
    insC.run(uuid(), company.organization_id, company.id, "Conveyance Reimbursement", "Reimbursement", "Fixed", 0, 0, 0, 0, 0);
  }
}

export function statutoryConfig(db, companyId, code, onDate) {
  const row = db
    .prepare("SELECT config_json FROM payroll_statutory_configs WHERE company_id = ? AND code = ? AND effective_from <= ? ORDER BY effective_from DESC LIMIT 1")
    .get(companyId, code, onDate);
  if (!row) throw badRequest(`No ${code} configuration is effective on ${onDate}.`);
  return JSON.parse(row.config_json);
}

/** Annual income tax for a taxable income under a regime config (slabs, rebate u/s 87A, cess). */
export function annualTax(income, cfg) {
  const taxable = Math.max(0, income - cfg.standardDeductionPaise);
  let tax = 0;
  let lower = 0;
  for (const s of cfg.slabs) {
    const upper = s.upToPaise ?? Infinity;
    if (taxable > lower) tax += percentOf(Math.min(taxable, upper) - lower, s.rateBp);
    lower = upper;
    if (taxable <= upper) break;
  }
  if (taxable <= cfg.rebateIncomeLimitPaise) tax = Math.max(0, tax - Math.min(tax, cfg.rebateMaxPaise));
  // Marginal relief around the rebate limit (new regime): tax cannot exceed income above the limit.
  else if (cfg.rebateMaxPaise && taxable - cfg.rebateIncomeLimitPaise < tax) tax = Math.min(tax, taxable - cfg.rebateIncomeLimitPaise);
  tax += percentOf(tax, cfg.cessBp);
  return roundToRupee(tax);
}

export function professionalTax(cfg, stateCode, monthlyGross, month) {
  const slabs = cfg.slabs?.[stateCode] || cfg.slabs?.[cfg.defaultStateCode];
  if (!slabs) return 0;
  const slab = slabs.find((s) => s.upToPaise === null || monthlyGross <= s.upToPaise);
  if (!slab) return 0;
  return month === 2 && slab.februaryAmountPaise !== undefined ? slab.februaryAmountPaise : slab.amountPaise;
}

function periodEnd(period) {
  const [y, m] = period.split("-").map(Number);
  return addDays(new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10), -1);
}

/** Compute one employee's pay for a period. Pure (reads only). */
export function computePay(db, company, employee, period, components) {
  const end = periodEnd(period);
  const start = `${period}-01`;
  const structure = db
    .prepare("SELECT * FROM employee_salary_structures WHERE employee_id = ? AND effective_from <= ? ORDER BY effective_from DESC LIMIT 1")
    .get(employee.id, end);
  if (!structure) return { skipped: `No salary structure effective for ${period}.` };
  if (employee.date_of_joining > end || (employee.date_of_leaving && employee.date_of_leaving < start)) return { skipped: "Not employed in this period." };
  const daysInMonth = Number(end.slice(8, 10));
  const att = db.prepare("SELECT * FROM attendance_records WHERE employee_id = ? AND period = ?").get(employee.id, period);
  const workingDays = att ? att.working_days : daysInMonth;
  let paidDaysMilli = att ? att.present_days_milli + att.paid_leave_days_milli : daysInMonth * 1000;
  if (!att) {
    // Joining / leaving mid-month without an attendance record: pay calendar days employed.
    const from = employee.date_of_joining > start ? employee.date_of_joining : start;
    const to = employee.date_of_leaving && employee.date_of_leaving < end ? employee.date_of_leaving : end;
    paidDaysMilli = (Number(to.slice(8, 10)) - Number(from.slice(8, 10)) + 1) * 1000;
  }
  const factor = (amount) => (workingDays ? mulDiv(amount, Math.min(paidDaysMilli, workingDays * 1000), workingDays * 1000) : amount);
  const comps = new Map(components.map((c) => [c.id, c]));
  const lines = JSON.parse(structure.lines_json);
  const basicLine = lines.find((l) => comps.get(l.componentId)?.is_basic);
  const basicFull = basicLine?.amountPaise || 0;
  const pay = [];
  let gross = 0;
  let taxableGross = 0;
  let pfWage = 0;
  let esiWageFull = 0;
  let otherDeductions = 0;
  for (const l of lines) {
    const c = comps.get(l.componentId);
    if (!c) continue;
    const full = c.calc === "PercentOfBasic" ? percentOf(basicFull, l.percentBp || 0) : l.amountPaise || 0;
    const amount = c.prorate ? factor(full) : full;
    if (!amount) continue;
    pay.push({ componentId: c.id, name: c.name, kind: c.kind, amountPaise: amount, ledgerId: c.ledger_id || null });
    if (c.kind === "Deduction") {
      otherDeductions += amount;
      continue;
    }
    gross += amount;
    if (c.kind === "Earning" && c.taxable) taxableGross += amount;
    if (c.pf_wage) pfWage += amount;
    if (c.esi_wage && c.kind === "Earning") esiWageFull += full;
  }
  const deductions = [];
  let erPf = 0;
  let erEsi = 0;
  if (employee.pf_applicable) {
    const pf = statutoryConfig(db, company.id, "PF", end);
    const base = pf.applyCeiling ? Math.min(pfWage, pf.wageCeilingPaise) : pfWage;
    const ee = roundToRupee(percentOf(base, pf.employeeRateBp));
    erPf = roundToRupee(percentOf(base, pf.employerRateBp + (pf.adminChargesBp || 0)));
    if (ee) deductions.push({ name: "Provident Fund", kind: "Statutory", code: "PF", amountPaise: ee });
  }
  if (employee.esi_applicable) {
    const esi = statutoryConfig(db, company.id, "ESI", end);
    if (esiWageFull <= esi.wageThresholdPaise) {
      const esiWage = gross - pay.filter((p) => p.kind === "Reimbursement").reduce((a, p) => a + p.amountPaise, 0);
      const ee = Math.ceil(percentOf(esiWage, esi.employeeRateBp) / 100) * 100; // ESI rounds up to the next rupee
      erEsi = Math.ceil(percentOf(esiWage, esi.employerRateBp) / 100) * 100;
      if (ee) deductions.push({ name: "ESI", kind: "Statutory", code: "ESI", amountPaise: ee });
    }
  }
  if (employee.pt_applicable) {
    const pt = professionalTax(statutoryConfig(db, company.id, "PT", end), employee.state_code || company.state_code, gross, Number(period.slice(5, 7)));
    if (pt) deductions.push({ name: "Professional Tax", kind: "Statutory", code: "PT", amountPaise: pt });
  }
  const tdsCfg = statutoryConfig(db, company.id, "TDS", end)[employee.tax_regime];
  if (tdsCfg) {
    const ptAnnual = employee.tax_regime === "Old" ? (deductions.find((d) => d.code === "PT")?.amountPaise || 0) * 12 : 0;
    const monthlyTds = roundToRupee(mulDiv(annualTax(taxableGross * 12 - ptAnnual, tdsCfg), 1, 12));
    if (monthlyTds) deductions.push({ name: "TDS on salary", kind: "Statutory", code: "TDS", amountPaise: monthlyTds });
  }
  const statutory = deductions.reduce((a, d) => a + d.amountPaise, 0);
  const totalDeductions = statutory + otherDeductions;
  return {
    paidDaysMilli,
    workingDays,
    gross,
    deductions: totalDeductions,
    net: gross - totalDeductions,
    employerPf: erPf,
    employerEsi: erEsi,
    lines: [...pay, ...deductions],
  };
}

export function createRun(db, req, company, period) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw badRequest("period must be YYYY-MM.");
  if (db.prepare("SELECT 1 FROM payroll_runs WHERE company_id = ? AND period = ? AND status <> 'Cancelled'").get(company.id, period))
    throw conflict(`A payroll run for ${period} already exists.`);
  return db.transaction(() => {
    const id = uuid();
    db.prepare("INSERT INTO payroll_runs(id, organization_id, company_id, period, created_by) VALUES (?,?,?,?,?)").run(
      id,
      company.organization_id,
      company.id,
      period,
      req.user.id,
    );
    const result = computeRun(db, company, id, period);
    acctAudit(db, req, {
      companyId: company.id,
      action: "payroll.run.create",
      entityType: "PayrollRun",
      entityId: id,
      summary: `Payroll ${period}: ${result.employees} employees`,
    });
    return { id, ...result };
  })();
}

export function computeRun(db, company, runId, period) {
  db.prepare("DELETE FROM payroll_entries WHERE run_id = ?").run(runId);
  const comps = db.prepare("SELECT * FROM payroll_components WHERE company_id = ?").all(company.id);
  const emps = db.prepare("SELECT * FROM employees WHERE company_id = ? AND active = 1 ORDER BY employee_code").all(company.id);
  const ins = db.prepare(
    `INSERT INTO payroll_entries(id, run_id, employee_id, paid_days_milli, working_days, gross_paise, deductions_paise, net_paise, employer_pf_paise, employer_esi_paise, lines_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const t = { gross: 0, ded: 0, net: 0, er: 0, n: 0 };
  const skipped = [];
  for (const e of emps) {
    const p = computePay(db, company, e, period, comps);
    if (p.skipped) {
      skipped.push({ employee: e.name, reason: p.skipped });
      continue;
    }
    ins.run(uuid(), runId, e.id, p.paidDaysMilli, p.workingDays, p.gross, p.deductions, p.net, p.employerPf, p.employerEsi, JSON.stringify(p.lines));
    t.gross += p.gross;
    t.ded += p.deductions;
    t.net += p.net;
    t.er += p.employerPf + p.employerEsi;
    t.n += 1;
  }
  db.prepare("UPDATE payroll_runs SET gross_paise=?, deductions_paise=?, net_paise=?, employer_contrib_paise=? WHERE id=?").run(
    t.gross,
    t.ded,
    t.net,
    t.er,
    runId,
  );
  return { employees: t.n, skipped };
}

export function loadRun(db, company, runId) {
  const run = db.prepare("SELECT * FROM payroll_runs WHERE id = ? AND company_id = ?").get(runId, company.id);
  if (!run) throw notFound("Payroll run not found.");
  return run;
}

export function postRun(db, req, company, runId, postingDate) {
  return db.transaction(() => {
    const run = loadRun(db, company, runId);
    if (run.status !== "Draft") throw conflict("Only draft payroll runs can be posted.");
    const entries = db.prepare("SELECT * FROM payroll_entries WHERE run_id = ?").all(run.id);
    if (!entries.length) throw badRequest("There are no employees in this run.");
    ensurePayrollSetup(db, company, req.user.id);
    const L = (code) => systemLedger(db, company.id, code).id;
    const post = new Map();
    const add = (lid, amt) => amt && post.set(lid, (post.get(lid) || 0) + amt);
    for (const e of entries) {
      for (const l of JSON.parse(e.lines_json)) {
        if (l.kind === "Earning" || l.kind === "Reimbursement") add(l.ledgerId || L("SALARY_EXPENSE"), l.amountPaise);
        else if (l.kind === "Deduction") {
          if (!l.ledgerId) throw badRequest(`Pay head "${l.name}" needs a ledger before payroll can be posted.`);
          add(l.ledgerId, -l.amountPaise);
        } else add(L({ PF: "PF_PAYABLE", ESI: "ESI_PAYABLE", PT: "PT_PAYABLE", TDS: "TDS_SALARY_PAYABLE" }[l.code]), -l.amountPaise);
      }
      add(L("EMPLOYER_PF_EXPENSE"), e.employer_pf_paise);
      add(L("PF_PAYABLE"), -e.employer_pf_paise);
      add(L("EMPLOYER_ESI_EXPENSE"), e.employer_esi_paise);
      add(L("ESI_PAYABLE"), -e.employer_esi_paise);
      add(L("SALARY_PAYABLE"), -e.net_paise);
    }
    const date = postingDate || periodEnd(run.period);
    const voucherInput = {
      type: "Payroll",
      date,
      referenceNo: `Payroll ${run.period}`,
      referenceDate: "",
      narration: `Salary for ${run.period} (${entries.length} employees)`,
      reverseCharge: false,
      itcEligible: true,
      originalInvoiceNo: "",
      originalInvoiceDate: "",
      currency: "INR",
      dueDate: "",
      roundOff: false,
      items: [],
      saveAsDraft: false,
      overrideCreditLimit: false,
      entries: [...post.entries()]
        .filter(([, a]) => a)
        .map(([lid, a]) => ({ ledgerId: lid, debit: a > 0 ? a : undefined, credit: a < 0 ? -a : undefined, narration: "", costAllocations: [] })),
    };
    // The payroll run itself is the approval step, so its journal posts directly.
    const internal = { ...req, internalPayroll: true, acct: { ...req.acct, can: () => true } };
    const { id: vid } = createVoucher(db, internal, company, voucherInput, { source: "payroll", sourceRef: run.id });
    db.prepare("UPDATE payroll_runs SET status='Posted', voucher_id=?, posted_by=?, posted_at=? WHERE id=?").run(vid, req.user.id, nowIso(), run.id);
    const emp = db.prepare("SELECT employee_code FROM employees WHERE id = ?");
    const insSlip = db.prepare(
      "INSERT INTO salary_slips(id, organization_id, company_id, payroll_entry_id, employee_id, period, slip_number) VALUES (?,?,?,?,?,?,?)",
    );
    for (const e of entries)
      insSlip.run(uuid(), company.organization_id, company.id, e.id, e.employee_id, run.period, `SLIP/${run.period}/${emp.get(e.employee_id).employee_code}`);
    acctAudit(db, req, {
      companyId: company.id,
      action: "payroll.run.post",
      entityType: "PayrollRun",
      entityId: run.id,
      summary: `Payroll ${run.period} posted`,
    });
    return { voucherId: vid };
  })();
}

export function cancelRun(db, req, company, runId, reason) {
  return db.transaction(() => {
    const run = loadRun(db, company, runId);
    if (run.status === "Cancelled") throw conflict("Already cancelled.");
    if (run.voucher_id) cancelVoucher(db, { ...req, internalPayroll: true }, company, run.voucher_id, reason || "Payroll run cancelled");
    db.prepare("DELETE FROM salary_slips WHERE payroll_entry_id IN (SELECT id FROM payroll_entries WHERE run_id = ?)").run(run.id);
    db.prepare("UPDATE payroll_runs SET status='Cancelled' WHERE id=?").run(run.id);
    acctAudit(db, req, { companyId: company.id, action: "payroll.run.cancel", entityType: "PayrollRun", entityId: run.id, summary: reason || "" });
  })();
}

export function runDetail(db, company, runId) {
  const run = loadRun(db, company, runId);
  const entries = db
    .prepare(
      `SELECT pe.*, e.name, e.employee_code, s.slip_number FROM payroll_entries pe JOIN employees e ON e.id = pe.employee_id
       LEFT JOIN salary_slips s ON s.payroll_entry_id = pe.id WHERE pe.run_id = ? ORDER BY e.employee_code`,
    )
    .all(run.id);
  return {
    id: run.id,
    period: run.period,
    status: run.status,
    voucherId: run.voucher_id,
    totals: {
      gross: fromPaise(run.gross_paise),
      deductions: fromPaise(run.deductions_paise),
      net: fromPaise(run.net_paise),
      employerContributions: fromPaise(run.employer_contrib_paise),
    },
    entries: entries.map((e) => ({
      id: e.id,
      employeeId: e.employee_id,
      employeeCode: e.employee_code,
      name: e.name,
      paidDays: fromMilli(e.paid_days_milli),
      workingDays: e.working_days,
      gross: fromPaise(e.gross_paise),
      deductions: fromPaise(e.deductions_paise),
      net: fromPaise(e.net_paise),
      employerPf: fromPaise(e.employer_pf_paise),
      employerEsi: fromPaise(e.employer_esi_paise),
      slipNumber: e.slip_number,
      lines: JSON.parse(e.lines_json).map((l) => ({ name: l.name, kind: l.kind, amount: fromPaise(l.amountPaise) })),
    })),
  };
}
