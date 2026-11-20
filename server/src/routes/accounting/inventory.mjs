// Inventory masters (units, groups/categories, godowns, items, BOM), stock reports and orders.

import { z } from "zod";
import { acctAudit, nowIso, uuid } from "../../accounting/access.mjs";
import { batchReport, itemMovements, stockSummary } from "../../accounting/inventory.mjs";
import { toItem } from "../../accounting/mappers.mjs";
import { fromMilli, fromPaise, nonNegMoney, percent, quantity, valueOf } from "../../accounting/money.mjs";
import { updateOrderFulfilment } from "../../accounting/vouchers.mjs";
import { badRequest, conflict, notFound } from "../../lib/errors.mjs";
import { id, isoDate, parse, requiredText, text } from "../../lib/validate.mjs";
import { patchSchema, str, W } from "./helpers.mjs";

const itemFields = {
  name: requiredText(160),
  sku: text(60).default(""),
  groupId: id().nullable().default(null),
  categoryId: id().nullable().default(null),
  unitId: id(),
  hsnSac: text(12).default(""),
  gstRate: percent().default(0),
  valuationMethod: z.enum(["FIFO", "WeightedAverage"]).default("WeightedAverage"),
  trackBatches: z.boolean().default(false),
  trackExpiry: z.boolean().default(false),
  trackSerials: z.boolean().default(false),
  reorderLevel: quantity().default(0),
  openingQty: quantity().default(0),
  openingRate: nonNegMoney().default(0),
  openingGodownId: id().nullable().default(null),
  standardSaleRate: nonNegMoney().default(0),
  active: z.boolean().default(true),
};
const ITEM_COLS = {
  name: "name",
  sku: "sku",
  groupId: "group_id",
  categoryId: "category_id",
  unitId: "unit_id",
  hsnSac: "hsn_sac",
  gstRate: "gst_rate_bp",
  valuationMethod: "valuation_method",
  trackBatches: "track_batches",
  trackExpiry: "track_expiry",
  trackSerials: "track_serials",
  reorderLevel: "reorder_level_milli",
  openingQty: "opening_qty_milli",
  openingRate: "opening_rate_paise",
  openingGodownId: "opening_godown_id",
  standardSaleRate: "standard_sale_rate_paise",
  active: "active",
};
const dbv = (v) => (typeof v === "boolean" ? (v ? 1 : 0) : v);

const orderSchema = z.object({
  orderType: z.enum(["SalesOrder", "PurchaseOrder"]),
  orderNumber: requiredText(40),
  date: isoDate().refine((v) => v !== "", "is required"),
  partyLedgerId: id(),
  dueDate: isoDate().default(""),
  narration: text(1000).default(""),
  lines: z
    .array(z.object({ itemId: id(), description: text(300).default(""), qty: quantity({ min: 1 }), rate: nonNegMoney() }))
    .min(1)
    .max(200),
});

export default function inventoryRoutes(c, { db }) {
  const own = (req, table, rid, label) => {
    if (rid === null || rid === undefined) return null;
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND company_id = ?`).get(rid, req.company.id);
    if (!row) throw badRequest(`${label}: not found in this company.`);
    return row;
  };

  // Units ------------------------------------------------------------------------------------------
  c.get("/units", (req, res) =>
    res.json(db.prepare("SELECT id, symbol, name, uqc, decimals FROM units_of_measure WHERE company_id = ? ORDER BY symbol").all(req.company.id)),
  );
  c.post("/units", W, (req, res) => {
    const b = parse(
      z.object({ symbol: requiredText(12), name: text(60).default(""), uqc: text(10).default("NOS"), decimals: z.number().int().min(0).max(3).default(0) }),
      req.body,
    );
    const uid = uuid();
    db.prepare("INSERT INTO units_of_measure(id, organization_id, company_id, symbol, name, uqc, decimals) VALUES (?,?,?,?,?,?,?)").run(
      uid,
      req.company.organization_id,
      req.company.id,
      b.symbol,
      b.name,
      b.uqc.toUpperCase(),
      b.decimals,
    );
    res.status(201).json({ id: uid, ...b });
  });

  // Stock groups / categories -----------------------------------------------------------------------
  c.get("/inventory-categories", (req, res) =>
    res.json(db.prepare("SELECT id, name, parent_id parentId, kind FROM inventory_categories WHERE company_id = ? ORDER BY kind, name").all(req.company.id)),
  );
  c.post("/inventory-categories", W, (req, res) => {
    const b = parse(
      z.object({ name: requiredText(120), kind: z.enum(["Group", "Category"]).default("Group"), parentId: id().nullable().default(null) }),
      req.body,
    );
    own(req, "inventory_categories", b.parentId, "parentId");
    const cid = uuid();
    db.prepare("INSERT INTO inventory_categories(id, organization_id, company_id, name, parent_id, kind) VALUES (?,?,?,?,?,?)").run(
      cid,
      req.company.organization_id,
      req.company.id,
      b.name,
      b.parentId,
      b.kind,
    );
    res.status(201).json({ id: cid, ...b });
  });

  // Godowns ----------------------------------------------------------------------------------------
  c.get("/warehouses", (req, res) =>
    res.json(
      db
        .prepare("SELECT * FROM warehouses WHERE company_id = ? ORDER BY is_default DESC, name")
        .all(req.company.id)
        .map((w) => ({ id: w.id, name: w.name, address: w.address, isDefault: !!w.is_default, active: !!w.active })),
    ),
  );
  c.post("/warehouses", W, (req, res) => {
    const b = parse(z.object({ name: requiredText(120), address: text(300).default("") }), req.body);
    const wid = uuid();
    db.prepare("INSERT INTO warehouses(id, organization_id, company_id, name, address) VALUES (?,?,?,?,?)").run(
      wid,
      req.company.organization_id,
      req.company.id,
      b.name,
      b.address,
    );
    res.status(201).json({ id: wid, ...b, isDefault: false, active: true });
  });
  c.patch("/warehouses/:wid", W, (req, res) => {
    const b = parse(z.object({ name: requiredText(120).optional(), address: text(300).optional(), active: z.boolean().optional() }).strict(), req.body);
    const r = db
      .prepare("UPDATE warehouses SET name = COALESCE(?, name), address = COALESCE(?, address), active = COALESCE(?, active) WHERE id = ? AND company_id = ?")
      .run(b.name ?? null, b.address ?? null, b.active === undefined ? null : b.active ? 1 : 0, req.params.wid, req.company.id);
    if (!r.changes) throw notFound("Godown not found.");
    res.json({ ok: true });
  });

  // Items ------------------------------------------------------------------------------------------
  const ITEM_SELECT = "SELECT ii.*, u.symbol unit_symbol FROM inventory_items ii JOIN units_of_measure u ON u.id = ii.unit_id";
  c.get("/items", (req, res) => {
    const summary = new Map(stockSummary(db, req.company, {}).rows.map((r) => [r.itemId, r]));
    const s = (str(req.query.search) || "").toLowerCase();
    res.json(
      db
        .prepare(`${ITEM_SELECT} WHERE ii.company_id = ? ORDER BY ii.name`)
        .all(req.company.id)
        .filter((r) => !s || `${r.name} ${r.sku} ${r.hsn_sac}`.toLowerCase().includes(s))
        .map((r) => toItem(r, { quantity: summary.get(r.id)?.quantity, value: summary.get(r.id)?.value, lowStock: summary.get(r.id)?.lowStock })),
    );
  });
  const checkItem = (req, b) => {
    own(req, "units_of_measure", b.unitId, "unitId");
    own(req, "inventory_categories", b.groupId, "groupId");
    own(req, "inventory_categories", b.categoryId, "categoryId");
    own(req, "warehouses", b.openingGodownId, "openingGodownId");
    if (b.trackExpiry && b.trackBatches === false) throw badRequest("Expiry tracking needs batch tracking.");
  };
  c.post("/items", W, (req, res) => {
    const b = parse(z.object(itemFields), req.body);
    checkItem(req, b);
    const iid = uuid();
    const keys = Object.keys(ITEM_COLS);
    db.prepare(
      `INSERT INTO inventory_items(id, organization_id, company_id, created_by, ${keys.map((k) => ITEM_COLS[k]).join(", ")}) VALUES (?,?,?,?,${keys.map(() => "?").join(",")})`,
    ).run(iid, req.company.organization_id, req.company.id, req.user.id, ...keys.map((k) => dbv(b[k])));
    acctAudit(db, req, {
      companyId: req.company.id,
      action: "item.create",
      entityType: "StockItem",
      entityId: iid,
      summary: `${b.name} opening ${fromMilli(b.openingQty)} @ ${fromPaise(b.openingRate)}`,
    });
    res.status(201).json(toItem(db.prepare(`${ITEM_SELECT} WHERE ii.id = ?`).get(iid)));
  });
  c.patch("/items/:itemId", W, (req, res) => {
    const item = own(req, "inventory_items", req.params.itemId, "item");
    const b = parse(patchSchema(z, itemFields), req.body);
    checkItem(req, { ...b, unitId: b.unitId ?? item.unit_id });
    const used = db.prepare("SELECT 1 FROM stock_movements WHERE item_id = ? LIMIT 1").get(item.id);
    if (used && (b.valuationMethod || b.openingQty !== undefined || b.openingRate !== undefined)) {
      const fy = db.prepare("SELECT status FROM financial_years WHERE company_id = ? ORDER BY start_date LIMIT 1").get(req.company.id);
      if (fy?.status === "Closed") throw conflict("Opening stock and valuation method cannot change after the first year is closed.");
    }
    const keys = Object.keys(b);
    if (keys.length)
      db.prepare(`UPDATE inventory_items SET ${keys.map((k) => `${ITEM_COLS[k]} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(
        ...keys.map((k) => dbv(b[k])),
        nowIso(),
        item.id,
      );
    acctAudit(db, req, {
      companyId: req.company.id,
      action: "item.update",
      entityType: "StockItem",
      entityId: item.id,
      summary: item.name,
      before: item,
      after: b,
    });
    res.json(toItem(db.prepare(`${ITEM_SELECT} WHERE ii.id = ?`).get(item.id)));
  });
  c.get("/items/:itemId/movements", (req, res) => {
    own(req, "inventory_items", req.params.itemId, "item");
    res.json(itemMovements(db, req.company, { ...req.query, itemId: req.params.itemId }));
  });

  // Stock reports -----------------------------------------------------------------------------------
  c.get("/stock/summary", (req, res) =>
    res.json(stockSummary(db, req.company, { to: str(req.query.to), from: str(req.query.from), warehouseId: str(req.query.warehouseId) })),
  );
  c.get("/stock/low", (req, res) => res.json(stockSummary(db, req.company, {}).rows.filter((r) => r.lowStock)));
  c.get("/stock/batches", (req, res) =>
    res.json(batchReport(db, req.company, { to: str(req.query.to), expiringWithinDays: str(req.query.expiringWithinDays) })),
  );
  c.get("/stock/movements", (req, res) =>
    res.json(itemMovements(db, req.company, { from: str(req.query.from), to: str(req.query.to), itemId: str(req.query.itemId) })),
  );

  // Bills of materials -------------------------------------------------------------------------------
  c.get("/boms", (req, res) =>
    res.json(
      db
        .prepare("SELECT b.*, ii.name item FROM bills_of_materials b JOIN inventory_items ii ON ii.id = b.item_id WHERE b.company_id = ? ORDER BY b.name")
        .all(req.company.id)
        .map((b) => ({
          id: b.id,
          name: b.name,
          itemId: b.item_id,
          item: b.item,
          outputQty: fromMilli(b.output_qty_milli),
          components: JSON.parse(b.components_json).map((x) => ({ itemId: x.itemId, qty: fromMilli(x.qtyMilli) })),
          active: !!b.active,
        })),
    ),
  );
  c.post("/boms", W, (req, res) => {
    const b = parse(
      z.object({
        name: requiredText(120),
        itemId: id(),
        outputQty: quantity({ min: 1 }),
        components: z
          .array(z.object({ itemId: id(), qty: quantity({ min: 1 }) }))
          .min(1)
          .max(100),
      }),
      req.body,
    );
    own(req, "inventory_items", b.itemId, "itemId");
    for (const x of b.components) {
      own(req, "inventory_items", x.itemId, "components.itemId");
      if (x.itemId === b.itemId) throw badRequest("An item cannot be a component of itself.");
    }
    const bid = uuid();
    db.prepare("INSERT INTO bills_of_materials(id, organization_id, company_id, item_id, name, output_qty_milli, components_json) VALUES (?,?,?,?,?,?,?)").run(
      bid,
      req.company.organization_id,
      req.company.id,
      b.itemId,
      b.name,
      b.outputQty,
      JSON.stringify(b.components.map((x) => ({ itemId: x.itemId, qtyMilli: x.qty }))),
    );
    res.status(201).json({ id: bid });
  });

  // Sales & purchase orders ----------------------------------------------------------------------------
  const toOrder = (o) => ({
    id: o.id,
    orderType: o.order_type,
    orderNumber: o.order_number,
    date: o.date,
    partyLedgerId: o.party_ledger_id,
    party: o.party,
    dueDate: o.due_date,
    status: o.status,
    narration: o.narration,
    total: fromPaise(o.total_paise),
    lines: JSON.parse(o.lines_json).map((l) => ({
      itemId: l.itemId,
      description: l.description,
      qty: fromMilli(l.qtyMilli),
      rate: fromPaise(l.ratePaise),
      fulfilled: fromMilli(l.fulfilledMilli || 0),
    })),
  });
  const ORDER_SELECT = "SELECT o.*, l.name party FROM business_orders o JOIN ledgers l ON l.id = o.party_ledger_id";
  c.get("/orders", (req, res) => {
    const t = str(req.query.type);
    res.json(
      db
        .prepare(`${ORDER_SELECT} WHERE o.company_id = ? ${t ? "AND o.order_type = ?" : ""} ORDER BY o.date DESC`)
        .all(req.company.id, ...(t ? [t] : []))
        .map(toOrder),
    );
  });
  c.post("/orders", W, (req, res) => {
    const b = parse(orderSchema, req.body);
    own(req, "ledgers", b.partyLedgerId, "partyLedgerId");
    for (const l of b.lines) own(req, "inventory_items", l.itemId, "lines.itemId");
    const total = b.lines.reduce((a, l) => a + valueOf(l.qty, l.rate), 0);
    const oid = uuid();
    db.prepare(
      "INSERT INTO business_orders(id, organization_id, company_id, order_type, order_number, date, party_ledger_id, due_date, lines_json, total_paise, narration, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      oid,
      req.company.organization_id,
      req.company.id,
      b.orderType,
      b.orderNumber,
      b.date,
      b.partyLedgerId,
      b.dueDate,
      JSON.stringify(b.lines.map((l) => ({ itemId: l.itemId, description: l.description, qtyMilli: l.qty, ratePaise: l.rate, fulfilledMilli: 0 }))),
      total,
      b.narration,
      req.user.id,
    );
    acctAudit(db, req, { companyId: req.company.id, action: "order.create", entityType: "Order", entityId: oid, summary: `${b.orderType} ${b.orderNumber}` });
    res.status(201).json(toOrder(db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(oid)));
  });
  c.get("/orders/:orderId", (req, res) => {
    const o = db.prepare(`${ORDER_SELECT} WHERE o.id = ? AND o.company_id = ?`).get(req.params.orderId, req.company.id);
    if (!o) throw notFound("Order not found.");
    const vouchers = db.prepare("SELECT id, voucher_type, voucher_number, date, status FROM vouchers WHERE order_id = ? ORDER BY date").all(o.id);
    res.json({ ...toOrder(o), vouchers: vouchers.map((v) => ({ id: v.id, type: v.voucher_type, number: v.voucher_number, date: v.date, status: v.status })) });
  });
  c.post("/orders/:orderId/cancel", W, (req, res) => {
    const o = own(req, "business_orders", req.params.orderId, "order");
    if (o.status === "Fulfilled") throw conflict("Fulfilled orders cannot be cancelled.");
    db.prepare("UPDATE business_orders SET status = 'Cancelled', updated_at = ? WHERE id = ?").run(nowIso(), o.id);
    acctAudit(db, req, { companyId: req.company.id, action: "order.cancel", entityType: "Order", entityId: o.id, summary: o.order_number });
    res.json({ ok: true });
  });
  c.post("/orders/:orderId/refresh", W, (req, res) => {
    own(req, "business_orders", req.params.orderId, "order");
    updateOrderFulfilment(db, req.company, req.params.orderId);
    res.json({ ok: true });
  });
}
