// Report export: CSV, Excel (.xlsx) and PDF, without third-party dependencies.
// Amounts are written from their exact decimal strings — never re-parsed through floating point.

import zlib from "node:zlib";

// Table shaping ---------------------------------------------------------------------------------------

const flattenTree = (nodes, section, out = []) => {
  for (const n of nodes) {
    out.push([section, `${"  ".repeat(n.depth || 0)}${n.name}`, n.amount]);
    if (n.children?.length) flattenTree(n.children, section, out);
  }
  return out;
};

export function tabulate(name, data) {
  switch (name) {
    case "trial-balance":
      return {
        title: `Trial Balance ${data.from} to ${data.to}`,
        columns: ["Ledger", "Group", "Opening", "Debit", "Credit", "Closing Dr", "Closing Cr"],
        rows: [
          ...data.rows.map((r) => [r.ledger, r.group, r.opening, r.debit, r.credit, r.closingDr, r.closingCr]),
          ["Total", "", "", data.totals.debit, data.totals.credit, data.totals.closingDr, data.totals.closingCr],
        ],
      };
    case "profit-loss":
    case "trading-account":
      return {
        title: `${name === "profit-loss" ? "Profit & Loss" : "Trading Account"} ${data.from} to ${data.to}`,
        columns: ["Section", "Particulars", "Amount"],
        rows: [
          ...flattenTree(data.trading.debit, "Trading Dr"),
          ...flattenTree(data.trading.credit, "Trading Cr"),
          ["", "Gross profit", data.grossProfit],
          ...(name === "profit-loss"
            ? [...flattenTree(data.profitAndLoss.debit, "P&L Dr"), ...flattenTree(data.profitAndLoss.credit, "P&L Cr"), ["", "Net profit", data.netProfit]]
            : []),
        ],
      };
    case "balance-sheet":
      return {
        title: `Balance Sheet as at ${data.to}`,
        columns: ["Side", "Particulars", "Amount"],
        rows: [
          ...flattenTree(data.liabilities, "Liabilities"),
          ["Liabilities", "Total", data.totals.liabilities],
          ...flattenTree(data.assets, "Assets"),
          ["Assets", "Total", data.totals.assets],
        ],
      };
    case "cash-flow":
      return {
        title: `Cash Flow ${data.from} to ${data.to}`,
        columns: ["Section", "Particulars", "Amount"],
        rows: [
          ["", "Opening cash & bank", data.openingCash],
          ...data.sections.flatMap((s) => [...s.lines.map((l) => [s.name, l.label, l.amount]), [s.name, "Net cash from " + s.name.toLowerCase(), s.total]]),
          ["", "Net change", data.netChange],
          ["", "Closing cash & bank", data.closingCash],
        ],
      };
    case "day-book":
      return {
        title: `Day Book ${data.from} to ${data.to}`,
        columns: ["Date", "Type", "Number", "Party", "Narration", "Amount", "Status"],
        rows: data.rows.map((r) => [r.date, r.type, r.number || "", r.party, r.narration, r.amount, r.status]),
      };
    case "ledger":
      return {
        title: `Ledger: ${data.ledger.name} ${data.from} to ${data.to}`,
        columns: ["Date", "Type", "Number", "Particulars", "Debit", "Credit", "Balance"],
        rows: [
          ["", "", "", "Opening balance", "", "", data.opening],
          ...data.rows.map((r) => [r.date, r.type, r.number || "", r.particulars, r.debit, r.credit, r.balance]),
          ["", "", "", "Closing balance", data.totals.debit, data.totals.credit, data.closing],
        ],
      };
    case "general-ledger":
      return {
        title: `General Ledger ${data.from} to ${data.to}`,
        columns: ["Ledger", "Group", "Opening", "Debit", "Credit", "Closing"],
        rows: data.rows.map((r) => [r.ledger, r.group, r.opening, r.debit, r.credit, r.closing]),
      };
    case "receivables":
    case "payables":
    case "outstanding":
      return {
        title: `${data.kind === "payable" ? "Payables" : "Receivables"} as at ${data.asOf}`,
        columns: ["Party", "Bill", "Bill date", "Due date", "Overdue days", "Ageing", "Pending"],
        rows: data.parties.flatMap((p) => [
          ...p.bills.map((b) => [p.party, b.ref, b.date, b.dueDate, String(b.overdueDays), b.bucket, b.pending]),
          [p.party, "Total", "", "", "", "", p.total],
        ]),
      };
    case "expenses":
    case "income":
      return {
        title: `${name === "expenses" ? "Expenses" : "Income"} ${data.from} to ${data.to}`,
        columns: ["Ledger", "Group", "Total", "Share %", ...data.months],
        rows: [
          ...data.rows.map((r) => [r.ledger, r.group, r.total, r.share, ...data.months.map((m) => r.months[m] || "0.00")]),
          ["Total", "", data.total, "100.00"],
        ],
      };
    case "ratios":
      return {
        title: `Financial Ratios ${data.from} to ${data.to}`,
        columns: ["Ratio", "Value", "Unit"],
        rows: data.ratios.map((r) => [r.label, r.value ?? "n/a", r.unit]),
      };
    case "cost-centres":
      return {
        title: `Cost Centres ${data.from} to ${data.to}`,
        columns: ["Cost centre", "Category", "Ledger", "Amount"],
        rows: data.centres.flatMap((c) => [...c.ledgers.map((l) => [c.name, c.category, l.ledger, l.amount]), [c.name, c.category, "Total", c.total]]),
      };
    case "budget-vs-actual":
      return {
        title: `Budget vs Actual: ${data.budget.name}`,
        columns: ["Head", "Budget", "Actual", "Variance", "Variance %"],
        rows: data.rows.map((r) => [r.name, r.budget, r.actual, r.variance, r.variancePct ?? ""]),
      };
    case "fy-comparison":
      return {
        title: `Financial Year Comparison ${data.current.label} vs ${data.previous.label}`,
        columns: ["Section", "Particulars", data.current.label, data.previous.label],
        rows: [
          ...["directIncome", "directExpenses", "indirectIncome", "indirectExpenses"].flatMap((k) =>
            data.profitAndLoss[k].map((r) => [k, r.name, r.current, r.previous]),
          ),
          ["", "Gross profit", data.profitAndLoss.grossProfit.current, data.profitAndLoss.grossProfit.previous],
          ["", "Net profit", data.profitAndLoss.netProfit.current, data.profitAndLoss.netProfit.previous],
          ...data.balanceSheet.liabilities.map((r) => ["Liabilities", r.name, r.current, r.previous]),
          ...data.balanceSheet.assets.map((r) => ["Assets", r.name, r.current, r.previous]),
        ],
      };
    default:
      if (data && Array.isArray(data.columns) && Array.isArray(data.rows)) return data;
      return null;
  }
}

// CSV ------------------------------------------------------------------------------------------------

const csvCell = (v) => {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`; // CSV/formula injection guard
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (t) => [t.columns, ...t.rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

// ZIP (store + deflate) --------------------------------------------------------------------------------

export function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const comp = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const nameBuf = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

export function unzip(buf) {
  const out = new Map();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error("not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("corrupt zip");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    total += size;
    if (total > 50 * 1024 * 1024) throw new Error("zip too large");
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    if (method === 0) out.set(name, Buffer.from(raw));
    else if (method === 8) out.set(name, zlib.inflateRawSync(raw, { maxOutputLength: 50 * 1024 * 1024 }));
  }
  return out;
}

// XLSX -----------------------------------------------------------------------------------------------

const xmlEsc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const colName = (i) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const isAmount = (v) => typeof v === "string" && /^-?\d+\.\d{2}$/.test(v);

export function toXlsx(t) {
  const rows = [t.columns, ...t.rows];
  const sheetRows = rows
    .map((r, ri) => {
      const cells = r
        .map((v, ci) => {
          const ref = `${colName(ci)}${ri + 1}`;
          if (ri > 0 && isAmount(v)) return `<c r="${ref}" s="2"><v>${v}</v></c>`;
          return `<c r="${ref}" t="inlineStr"${ri === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${xmlEsc(v ?? "")}</t></is></c>`;
        })
        .join("");
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join("");
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  return zip([
    [
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ],
    [
      "_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      "xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ${ns} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ],
    [
      "xl/styles.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet ${ns}><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    ],
    ["xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet ${ns}><sheetData>${sheetRows}</sheetData></worksheet>`],
  ]);
}

/** Read the first worksheet of an .xlsx file into an array of string rows. */
export function readXlsx(buf) {
  const files = unzip(buf);
  const strings = [];
  const ss = files.get("xl/sharedStrings.xml")?.toString("utf8");
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) strings.push([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => unesc(x[1])).join(""));
  const sheetName = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if (!sheetName) throw new Error("no worksheet");
  const xml = files.get(sheetName).toString("utf8");
  const rows = [];
  for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const type = /t="(\w+)"/.exec(attrs)?.[1];
      const body = cm[2] || "";
      let v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
      if (type === "s") v = strings[Number(v)] ?? "";
      else if (type === "inlineStr") v = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => unesc(x[1])).join("");
      else v = unesc(v);
      const idx = ref ? [...ref].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1 : row.length;
      row[idx] = v;
    }
    rows.push(Array.from(row, (x) => x ?? ""));
  }
  return rows;
}
const unesc = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

// PDF ------------------------------------------------------------------------------------------------

const pdfText = (s) =>
  String(s ?? "")
    .replace(/₹/g, "Rs.")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");

/** Render a table as a simple multi-page A4 landscape PDF (Helvetica). */
export function toPdf(t, { subtitle = "" } = {}) {
  const W = 842;
  const H = 595;
  const margin = 36;
  const lineH = 13;
  const cols = t.columns.length;
  const usable = W - margin * 2;
  // Give text columns more room than numeric ones.
  const numeric = t.columns.map(
    (_, ci) => t.rows.length > 0 && t.rows.every((r) => r[ci] === "" || r[ci] === undefined || isAmount(r[ci]) || /^\d+$/.test(String(r[ci]))),
  );
  const weights = numeric.map((n) => (n ? 1 : 2));
  const wsum = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (usable * w) / wsum);
  const maxChars = widths.map((w) => Math.max(4, Math.floor(w / 5.2)));
  const fit = (s, i) => {
    s = String(s ?? "");
    return s.length > maxChars[i] ? `${s.slice(0, maxChars[i] - 1)}~` : s;
  };
  const perPage = Math.floor((H - margin * 2 - 60) / lineH);
  const pages = [];
  for (let i = 0; i < Math.max(1, t.rows.length); i += perPage) pages.push(t.rows.slice(i, i + perPage));
  const streams = pages.map((rows, pi) => {
    let y = H - margin;
    const ops = [];
    const text = (x, yy, s, size = 8, bold = false, right = false, width = 0) => {
      const str = pdfText(s);
      const xx = right ? x + width - str.length * size * 0.5 : x;
      ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${xx.toFixed(1)} ${yy.toFixed(1)} Td (${str}) Tj ET`);
    };
    text(margin, y - 12, t.title, 13, true);
    if (subtitle) text(margin, y - 26, subtitle, 8);
    text(W - margin - 80, y - 12, `Page ${pi + 1} of ${pages.length}`, 8);
    y -= 48;
    let x = margin;
    t.columns.forEach((c, ci) => {
      text(x, y, fit(c, ci), 8, true, numeric[ci], widths[ci] - 4);
      x += widths[ci];
    });
    ops.push(`${margin} ${y - 4} m ${W - margin} ${y - 4} l S`);
    y -= lineH + 2;
    for (const r of rows) {
      x = margin;
      for (let ci = 0; ci < cols; ci++) {
        text(x, y, fit(r[ci], ci), 8, false, numeric[ci], widths[ci] - 4);
        x += widths[ci];
      }
      y -= lineH;
    }
    text(margin, margin - 12, "Generated by Finpro AI. Figures computed from posted vouchers.", 7);
    return ops.join("\n");
  });
  const objs = [];
  const add = (s) => objs.push(s) && objs.length;
  const catalog = add("");
  const pagesObj = add("");
  const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const kids = [];
  for (const s of streams) {
    const content = add(`<< /Length ${Buffer.byteLength(s)} >>\nstream\n${s}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

/** Send a tabulated report in the requested format. */
export function sendTable(res, t, format, fileBase, subtitle) {
  const safe = fileBase.replace(/[^a-z0-9-]+/gi, "-").slice(0, 80);
  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safe}.csv"`);
    return res.send("﻿" + toCsv(t));
  }
  if (format === "xlsx") {
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${safe}.xlsx"`);
    return res.send(toXlsx(t));
  }
  if (format === "pdf") {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safe}.pdf"`);
    return res.send(toPdf(t, { subtitle }));
  }
  return res.json(t);
}
