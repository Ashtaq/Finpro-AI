// Printable invoices / vouchers (HTML and PDF) driven by the company's invoice template settings.

import { GST_STATES } from "./chart.mjs";
import { toPdf } from "./export.mjs";
import { fromBp, fromMilli, fromPaise } from "./money.mjs";

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const two = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`);
const three = (n) => (n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${two(n % 100)}` : ""}` : two(n));

/** Indian-system amount in words: 1,25,050.50 -> "Rupees One Lakh Twenty Five Thousand Fifty and Fifty Paise Only". */
export function amountInWords(paise) {
  const neg = paise < 0;
  const p = Math.abs(paise);
  let rupees = Math.floor(p / 100);
  const ps = p % 100;
  if (rupees === 0 && ps === 0) return "Rupees Zero Only";
  const parts = [];
  const crore = Math.floor(rupees / 10000000);
  rupees %= 10000000;
  const lakh = Math.floor(rupees / 100000);
  rupees %= 100000;
  const thousand = Math.floor(rupees / 1000);
  rupees %= 1000;
  if (crore) parts.push(`${crore >= 1000 ? amountInWords(crore * 100).replace(/^Rupees | Only$/g, "") : three(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (rupees) parts.push(three(rupees));
  let words = `Rupees ${parts.join(" ") || "Zero"}`;
  if (ps) words += ` and ${two(ps)} Paise`;
  return `${neg ? "Minus " : ""}${words} Only`;
}

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const inr = (p) => {
  const s = fromPaise(p);
  const [w, f] = s.replace("-", "").split(".");
  const last3 = w.slice(-3);
  const rest = w.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${p < 0 ? "-" : ""}${rest ? `${rest},` : ""}${last3}.${f}`;
};

const TITLES = {
  Sales: "Tax Invoice",
  Purchase: "Purchase Voucher",
  CreditNote: "Credit Note",
  DebitNote: "Debit Note",
  Payment: "Payment Voucher",
  Receipt: "Receipt",
  Journal: "Journal Voucher",
  Contra: "Contra Voucher",
  DeliveryNote: "Delivery Challan",
  ReceiptNote: "Goods Receipt Note",
  StockJournal: "Stock Journal",
  Payroll: "Payroll Journal",
};

function load(db, company, voucher) {
  const party = voucher.party_ledger_id ? db.prepare("SELECT * FROM ledgers WHERE id = ?").get(voucher.party_ledger_id) : null;
  const items = db
    .prepare(
      "SELECT vi.*, u.symbol unit FROM voucher_items vi LEFT JOIN inventory_items ii ON ii.id = vi.stock_item_id LEFT JOIN units_of_measure u ON u.id = ii.unit_id WHERE vi.voucher_id = ? ORDER BY vi.line_no",
    )
    .all(voucher.id);
  const entries = db
    .prepare("SELECT ve.*, l.name ledger FROM voucher_entries ve JOIN ledgers l ON l.id = ve.ledger_id WHERE ve.voucher_id = ? ORDER BY ve.line_no")
    .all(voucher.id);
  const gstin = db.prepare("SELECT gstin FROM gst_registrations WHERE company_id = ? ORDER BY is_primary DESC LIMIT 1").get(company.id)?.gstin || "";
  const tpl = {
    title: "",
    format: "standard",
    showHsn: true,
    showBankDetails: true,
    terms: "",
    footer: "",
    accentColor: "#1b64e6",
    ...JSON.parse(company.invoice_template_json || "{}"),
  };
  const bank = tpl.showBankDetails
    ? tpl.bankLedgerId
      ? db.prepare("SELECT * FROM ledgers WHERE id = ? AND company_id = ?").get(tpl.bankLedgerId, company.id)
      : db
          .prepare(
            "SELECT l.* FROM ledgers l JOIN account_groups g ON g.id = l.group_id WHERE l.company_id = ? AND g.system_code = 'BANK' AND l.bank_account_number <> '' LIMIT 1",
          )
          .get(company.id)
    : null;
  const einv = db.prepare("SELECT irn, ack_no, ack_date FROM e_invoice_records WHERE voucher_id = ? AND status = 'Generated'").get(voucher.id);
  return { party, items, entries, gstin, tpl, bank, einv };
}

export function renderVoucherHtml(db, company, voucher, format) {
  const { party, items, entries, gstin, tpl, bank, einv } = load(db, company, voucher);
  const fmt = format || tpl.format;
  const title = tpl.title && voucher.voucher_type === "Sales" ? tpl.title : TITLES[voucher.voucher_type];
  const tax = items.reduce(
    (a, i) => ({
      cgst: a.cgst + i.cgst_paise,
      sgst: a.sgst + i.sgst_paise,
      igst: a.igst + i.igst_paise,
      cess: a.cess + i.cess_paise,
      taxable: a.taxable + i.taxable_paise,
    }),
    {
      cgst: 0,
      sgst: 0,
      igst: 0,
      cess: 0,
      taxable: 0,
    },
  );
  const itemRows = items
    .map(
      (
        i,
        n,
      ) => `<tr><td>${n + 1}</td><td>${esc(i.description)}${fmt === "detailed" && i.batch_no ? `<br><small>Batch ${esc(i.batch_no)}</small>` : ""}</td>${tpl.showHsn ? `<td>${esc(i.hsn_sac)}</td>` : ""}
        <td class="r">${i.qty_milli ? `${fromMilli(i.qty_milli)} ${esc(i.unit || "")}` : ""}</td><td class="r">${i.rate_paise ? inr(i.rate_paise) : ""}</td>
        ${fmt !== "compact" ? `<td class="r">${fromBp(i.gst_rate_bp)}%</td>` : ""}<td class="r">${inr(i.taxable_paise)}</td>
        ${fmt === "detailed" ? `<td class="r">${inr(i.cgst_paise + i.sgst_paise + i.igst_paise + i.cess_paise)}</td>` : ""}</tr>`,
    )
    .join("");
  const entryRows = entries
    .map(
      (e) =>
        `<tr><td>${esc(e.ledger)}</td><td class="r">${e.debit_paise ? inr(e.debit_paise) : ""}</td><td class="r">${e.credit_paise ? inr(e.credit_paise) : ""}</td></tr>`,
    )
    .join("");
  const roundOff = entries.filter((e) => e.ledger === "Round Off").reduce((a, e) => a + e.credit_paise - e.debit_paise, 0);
  const pos = voucher.place_of_supply ? `${voucher.place_of_supply} – ${GST_STATES[voucher.place_of_supply] || ""}` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} ${esc(voucher.voucher_number || "")}</title>
<style>body{font-family:Arial,Helvetica,sans-serif;color:#1d2433;margin:32px;font-size:12px}h1{font-size:20px;margin:0;color:${esc(tpl.accentColor)}}
table{border-collapse:collapse;width:100%;margin-top:14px}th,td{border:1px solid #d8dee8;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f3f6fb;font-size:11px}
.r{text-align:right}.grid{display:flex;justify-content:space-between;gap:24px;margin-top:16px}.box{flex:1}.muted{color:#66758c}.tot td{font-weight:bold}
@media print{body{margin:12mm}}</style></head><body>
<div class="grid"><div class="box"><h1>${esc(title)}</h1><div class="muted">${esc(voucher.status !== "Posted" ? `${voucher.status} — not a valid tax document` : "")}</div>
<strong>${esc(company.legal_name || company.name)}</strong><br>${esc(company.address)}<br>${gstin ? `GSTIN: ${esc(gstin)}<br>` : ""}${company.pan ? `PAN: ${esc(company.pan)}` : ""}</div>
<div class="box"><table><tr><th>Number</th><td>${esc(voucher.voucher_number || "—")}</td></tr><tr><th>Date</th><td>${esc(voucher.date)}</td></tr>
${voucher.reference_no ? `<tr><th>Reference</th><td>${esc(voucher.reference_no)}</td></tr>` : ""}${pos ? `<tr><th>Place of supply</th><td>${esc(pos)}</td></tr>` : ""}
${voucher.reverse_charge ? "<tr><th>Reverse charge</th><td>Yes</td></tr>" : ""}${einv ? `<tr><th>IRN</th><td style="word-break:break-all">${esc(einv.irn)}</td></tr><tr><th>Ack No.</th><td>${esc(einv.ack_no)} (${esc(einv.ack_date)})</td></tr>` : ""}</table></div></div>
${party ? `<div style="margin-top:14px"><div class="muted">${["Sales", "CreditNote", "DeliveryNote"].includes(voucher.voucher_type) ? "Bill to" : "Party"}</div><strong>${esc(party.name)}</strong><br>${esc(party.address)}<br>${party.gstin ? `GSTIN: ${esc(party.gstin)}` : ""}</div>` : ""}
${
  items.length
    ? `<table><tr><th>#</th><th>Description</th>${tpl.showHsn ? "<th>HSN/SAC</th>" : ""}<th class="r">Qty</th><th class="r">Rate</th>${fmt !== "compact" ? '<th class="r">GST</th>' : ""}<th class="r">Taxable value</th>${fmt === "detailed" ? '<th class="r">Tax</th>' : ""}</tr>${itemRows}</table>
<table style="width:45%;margin-left:auto"><tr><td>Taxable value</td><td class="r">${inr(tax.taxable)}</td></tr>${tax.cgst ? `<tr><td>CGST</td><td class="r">${inr(tax.cgst)}</td></tr>` : ""}${tax.sgst ? `<tr><td>SGST/UTGST</td><td class="r">${inr(tax.sgst)}</td></tr>` : ""}${tax.igst ? `<tr><td>IGST</td><td class="r">${inr(tax.igst)}</td></tr>` : ""}${tax.cess ? `<tr><td>Cess</td><td class="r">${inr(tax.cess)}</td></tr>` : ""}${roundOff ? `<tr><td>Round off</td><td class="r">${inr(-roundOff)}</td></tr>` : ""}<tr class="tot"><td>Total</td><td class="r">₹ ${inr(voucher.total_paise)}</td></tr></table>`
    : `<table><tr><th>Ledger</th><th class="r">Debit</th><th class="r">Credit</th></tr>${entryRows}<tr class="tot"><td>Total</td><td class="r">${inr(voucher.total_paise)}</td><td class="r">${inr(voucher.total_paise)}</td></tr></table>`
}
<p><strong>${esc(amountInWords(voucher.total_paise))}</strong></p>${voucher.narration ? `<p class="muted">${esc(voucher.narration)}</p>` : ""}
${bank && ["Sales"].includes(voucher.voucher_type) ? `<p><strong>Bank details:</strong> ${esc(bank.bank_name || bank.name)} · A/c ${esc(bank.bank_account_number)} · IFSC ${esc(bank.bank_ifsc)}</p>` : ""}
${tpl.terms ? `<p class="muted" style="white-space:pre-wrap">${esc(tpl.terms)}</p>` : ""}
<div class="grid" style="margin-top:40px"><div class="muted">${esc(tpl.footer)}</div><div style="text-align:right">For ${esc(company.legal_name || company.name)}<br><br><br>Authorised signatory</div></div>
</body></html>`;
}

export function renderVoucherPdf(db, company, voucher) {
  const { party, items, entries, gstin } = load(db, company, voucher);
  const title = `${TITLES[voucher.voucher_type]} ${voucher.voucher_number || ""} — ${company.legal_name || company.name}`;
  const t = items.length
    ? {
        title,
        columns: ["#", "Description", "HSN/SAC", "Qty", "Rate", "GST %", "Taxable", "Tax"],
        rows: [
          ...items.map((i, n) => [
            String(n + 1),
            i.description,
            i.hsn_sac,
            i.qty_milli ? fromMilli(i.qty_milli) : "",
            i.rate_paise ? fromPaise(i.rate_paise) : "",
            fromBp(i.gst_rate_bp),
            fromPaise(i.taxable_paise),
            fromPaise(i.cgst_paise + i.sgst_paise + i.igst_paise + i.cess_paise),
          ]),
          ["", "Invoice total", "", "", "", "", "", fromPaise(voucher.total_paise)],
          ["", amountInWords(voucher.total_paise), "", "", "", "", "", ""],
        ],
      }
    : {
        title,
        columns: ["Ledger", "Debit", "Credit"],
        rows: [
          ...entries.map((e) => [e.ledger, fromPaise(e.debit_paise), fromPaise(e.credit_paise)]),
          ["Total", fromPaise(voucher.total_paise), fromPaise(voucher.total_paise)],
        ],
      };
  return toPdf(t, {
    subtitle: `Date ${voucher.date}${party ? ` · ${party.name}${party.gstin ? ` (${party.gstin})` : ""}` : ""}${gstin ? ` · Our GSTIN ${gstin}` : ""}`,
  });
}
