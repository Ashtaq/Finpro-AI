// Inventory reports: stock summary with valuation, item movement ledger, low stock, batch / expiry.

import { fyBounds } from "./chart.mjs";
import { fromMilli, fromPaise, mulDiv } from "./money.mjs";
import { postedMovements, stockPositions, valueStock } from "./stock.mjs";

export function stockSummary(db, company, q = {}) {
  const to = q.to || new Date().toISOString().slice(0, 10);
  const from = q.from || fyBounds(to, company.fy_start_month).start;
  const val = valueStock(db, company, { to, from });
  const positions = stockPositions(db, company, { to });
  const whs = new Map(
    db
      .prepare("SELECT id, name FROM warehouses WHERE company_id = ?")
      .all(company.id)
      .map((w) => [w.id, w.name]),
  );
  const items = db
    .prepare("SELECT ii.*, u.symbol unit FROM inventory_items ii JOIN units_of_measure u ON u.id = ii.unit_id WHERE ii.company_id = ? ORDER BY ii.name")
    .all(company.id);
  let total = 0;
  const rows = items
    .filter((it) => !q.warehouseId || positions.some((p) => p.itemId === it.id && p.warehouseId === q.warehouseId))
    .map((it) => {
      const s = val.get(it.id);
      total += s.value;
      const byGodown = positions.filter((p) => p.itemId === it.id && p.qty !== 0);
      const godowns = new Map();
      for (const p of byGodown) godowns.set(p.warehouseId, (godowns.get(p.warehouseId) || 0) + p.qty);
      return {
        itemId: it.id,
        item: it.name,
        sku: it.sku,
        unit: it.unit,
        valuationMethod: it.valuation_method,
        quantity: fromMilli(s.qty),
        rate: s.qty ? fromPaise(mulDiv(s.value, 1000, s.qty)) : "0.00",
        value: fromPaise(s.value),
        inwardQty: fromMilli(s.periodInQty),
        outwardQty: fromMilli(s.periodOutQty),
        costOfOutward: fromPaise(s.periodOutValue),
        reorderLevel: fromMilli(it.reorder_level_milli),
        lowStock: it.reorder_level_milli > 0 && s.qty <= it.reorder_level_milli,
        godowns: [...godowns.entries()].map(([w, qty]) => ({ warehouseId: w, warehouse: whs.get(w), quantity: fromMilli(qty) })),
      };
    });
  return { from, to, rows, totalValue: fromPaise(total) };
}

export function itemMovements(db, company, q = {}) {
  const to = q.to || new Date().toISOString().slice(0, 10);
  const from = q.from || fyBounds(to, company.fy_start_month).start;
  const list = postedMovements(db, company.id, { to, itemId: q.itemId }).filter((m) => m.date >= from);
  const names = new Map(
    db
      .prepare("SELECT id, name FROM inventory_items WHERE company_id = ?")
      .all(company.id)
      .map((i) => [i.id, i.name]),
  );
  const whs = new Map(
    db
      .prepare("SELECT id, name FROM warehouses WHERE company_id = ?")
      .all(company.id)
      .map((w) => [w.id, w.name]),
  );
  const vouchers = db.prepare("SELECT id, voucher_type, voucher_number FROM vouchers WHERE id = ?");
  return {
    from,
    to,
    rows: list.map((m) => {
      const v = m.voucher_id ? vouchers.get(m.voucher_id) : null;
      return {
        date: m.date,
        itemId: m.item_id,
        item: names.get(m.item_id),
        warehouse: whs.get(m.warehouse_id),
        voucherId: m.voucher_id,
        voucher: v ? `${v.voucher_type} ${v.voucher_number || ""}`.trim() : "",
        type: m.movement_type,
        inward: m.direction === "In" ? fromMilli(m.qty_milli) : "",
        outward: m.direction === "Out" ? fromMilli(m.qty_milli) : "",
        value: m.direction === "In" ? fromPaise(m.value_paise) : "",
        serialNumbers: m.serial_numbers,
      };
    }),
  };
}

export function batchReport(db, company, q = {}) {
  const asOf = q.to || new Date().toISOString().slice(0, 10);
  const within = Number(q.expiringWithinDays || 90);
  const limit = new Date(Date.parse(`${asOf}T00:00:00Z`) + within * 86400000).toISOString().slice(0, 10);
  const rows = db
    .prepare(
      `SELECT b.*, ii.name item, COALESCE(SUM(CASE sm.direction WHEN 'In' THEN sm.qty_milli ELSE -sm.qty_milli END),0) qty
       FROM stock_batches b JOIN inventory_items ii ON ii.id = b.item_id LEFT JOIN stock_movements sm ON sm.batch_id = b.id
         AND (sm.voucher_id IS NULL OR EXISTS (SELECT 1 FROM vouchers v WHERE v.id = sm.voucher_id AND v.status = 'Posted'))
       WHERE b.company_id = ? GROUP BY b.id HAVING qty > 0 ORDER BY b.expiry_date IS NULL, b.expiry_date`,
    )
    .all(company.id);
  return {
    asOf,
    rows: rows.map((b) => ({
      batchId: b.id,
      itemId: b.item_id,
      item: b.item,
      batchNo: b.batch_no,
      mfgDate: b.mfg_date,
      expiryDate: b.expiry_date,
      quantity: fromMilli(b.qty),
      status: !b.expiry_date ? "No expiry" : b.expiry_date < asOf ? "Expired" : b.expiry_date <= limit ? "Expiring soon" : "OK",
    })),
  };
}

export function inventoryReport(db, company, kind, q) {
  if (kind === "movements") return itemMovements(db, company, q);
  if (kind === "batches") return batchReport(db, company, q);
  return stockSummary(db, company, q);
}
