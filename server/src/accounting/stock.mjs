// Inventory valuation (FIFO and moving weighted average) and stock positions.
// Valuation is item-wide (across godowns), like Tally's default. Transfers between godowns move
// quantity but not value, so they are ignored for valuation.

import { mulDiv, valueOf } from "./money.mjs";

const POSTED = "(sm.voucher_id IS NULL OR EXISTS (SELECT 1 FROM vouchers v WHERE v.id = sm.voucher_id AND v.status = 'Posted'))";

export function postedMovements(db, companyId, { to, itemId } = {}) {
  const where = ["sm.company_id = ?", POSTED];
  const args = [companyId];
  if (to) (where.push("sm.date <= ?"), args.push(to));
  if (itemId) (where.push("sm.item_id = ?"), args.push(itemId));
  return db
    .prepare(
      `SELECT sm.* FROM stock_movements sm WHERE ${where.join(" AND ")}
       ORDER BY sm.date, CASE sm.direction WHEN 'In' THEN 0 ELSE 1 END, sm.created_at, sm.rowid`,
    )
    .all(...args);
}

/**
 * Value every item as at `to` (inclusive). Returns Map itemId -> {qty, value, outValue, inQty, outQty}
 * where outValue is the cost of goods moved out within [from, to] when `from` is given.
 */
export function valueStock(db, company, { to, from } = {}) {
  const items = db.prepare("SELECT * FROM inventory_items WHERE company_id = ?").all(company.id);
  const state = new Map();
  for (const it of items) {
    const s = { item: it, qty: 0, value: 0, layers: [], periodOutValue: 0, periodInQty: 0, periodOutQty: 0, periodInValue: 0 };
    if (it.opening_qty_milli > 0) {
      const v = valueOf(it.opening_qty_milli, it.opening_rate_paise);
      s.qty = it.opening_qty_milli;
      s.value = v;
      s.layers.push({ qty: it.opening_qty_milli, value: v });
    }
    state.set(it.id, s);
  }
  for (const m of postedMovements(db, company.id, { to })) {
    if (m.movement_type === "TransferIn" || m.movement_type === "TransferOut") continue;
    const s = state.get(m.item_id);
    if (!s) continue;
    const inPeriod = from ? m.date >= from : true;
    if (m.direction === "In") {
      s.qty += m.qty_milli;
      s.value += m.value_paise;
      s.layers.push({ qty: m.qty_milli, value: m.value_paise });
      if (inPeriod) ((s.periodInQty += m.qty_milli), (s.periodInValue += m.value_paise));
    } else {
      const cost = consume(s, m.qty_milli);
      if (inPeriod) ((s.periodOutQty += m.qty_milli), (s.periodOutValue += cost));
    }
  }
  return state;
}

/** Remove qty from a valuation state and return the cost removed. */
function consume(s, qty) {
  let cost = 0;
  if (s.item.valuation_method === "FIFO") {
    let left = qty;
    while (left > 0 && s.layers.length) {
      const layer = s.layers[0];
      if (layer.qty <= left) {
        cost += layer.value;
        left -= layer.qty;
        s.layers.shift();
      } else {
        const part = mulDiv(layer.value, left, layer.qty);
        cost += part;
        layer.value -= part;
        layer.qty -= left;
        left = 0;
      }
    }
    if (left > 0) cost += 0; // negative stock is rejected at posting; nothing left to value
  } else {
    cost = s.qty > 0 ? mulDiv(s.value, Math.min(qty, s.qty), s.qty) : 0;
    // keep a single layer representing the average
    const remainingQty = s.qty - qty;
    s.layers = remainingQty > 0 ? [{ qty: remainingQty, value: s.value - cost }] : [];
  }
  s.qty -= qty;
  s.value -= cost;
  if (s.qty <= 0) {
    s.qty = Math.max(0, s.qty);
    if (s.qty === 0) s.value = 0;
  }
  return cost;
}

/** Current average cost per unit of an item as at a date (used to value sales returns and production). */
export function unitCost(db, company, itemId, date) {
  const s = valueStock(db, company, { to: date }).get(itemId);
  if (!s || s.qty <= 0) return s?.item.opening_rate_paise || 0;
  return mulDiv(s.value, 1000, s.qty);
}

export function bookOpeningStock(db, company) {
  if (company.inventory_enabled)
    return db
      .prepare("SELECT opening_qty_milli q, opening_rate_paise r FROM inventory_items WHERE company_id = ?")
      .all(company.id)
      .reduce((a, r) => a + valueOf(r.q, r.r), 0);
  return (
    db
      .prepare(
        `SELECT COALESCE(SUM(l.opening_balance_paise),0) v FROM ledgers l JOIN account_groups g ON g.id = l.group_id
         WHERE l.company_id = ? AND (g.system_code = 'STOCK' OR g.parent_id IN (SELECT id FROM account_groups WHERE company_id = ? AND system_code = 'STOCK'))`,
      )
      .get(company.id, company.id).v || 0
  );
}

/** Closing stock value as at `date` (integrated inventory, or the latest manual closing-stock entry). */
export function stockValueAt(db, company, date) {
  if (date < company.books_start_date) return bookOpeningStock(db, company);
  if (company.inventory_enabled) {
    let total = 0;
    for (const s of valueStock(db, company, { to: date }).values()) total += s.value;
    return total;
  }
  const row = db
    .prepare("SELECT value_paise FROM closing_stock_entries WHERE company_id = ? AND as_of_date <= ? AND as_of_date >= ? ORDER BY as_of_date DESC LIMIT 1")
    .get(company.id, date, company.books_start_date);
  return row ? row.value_paise : bookOpeningStock(db, company);
}

/** Quantity on hand per item/godown/batch as at a date. */
export function stockPositions(db, company, { to, itemId, warehouseId } = {}) {
  const pos = new Map();
  const key = (i, w, b) => `${i}|${w}|${b || ""}`;
  const add = (i, w, b, q) => {
    const k = key(i, w, b);
    pos.set(k, { itemId: i, warehouseId: w, batchId: b || null, qty: (pos.get(k)?.qty || 0) + q });
  };
  const items = db.prepare("SELECT * FROM inventory_items WHERE company_id = ?").all(company.id);
  const defaultWh = db.prepare("SELECT id FROM warehouses WHERE company_id = ? ORDER BY is_default DESC, name LIMIT 1").get(company.id)?.id;
  for (const it of items) if (it.opening_qty_milli > 0) add(it.id, it.opening_godown_id || defaultWh, null, it.opening_qty_milli);
  for (const m of postedMovements(db, company.id, { to, itemId }))
    add(m.item_id, m.warehouse_id, m.batch_id, m.direction === "In" ? m.qty_milli : -m.qty_milli);
  return [...pos.values()].filter((p) => (!itemId || p.itemId === itemId) && (!warehouseId || p.warehouseId === warehouseId));
}

export function availableQty(db, company, { itemId, warehouseId, batchId, to, excludeVoucherId }) {
  const items = db.prepare("SELECT * FROM inventory_items WHERE id = ?").get(itemId);
  const defaultWh = db.prepare("SELECT id FROM warehouses WHERE company_id = ? ORDER BY is_default DESC, name LIMIT 1").get(company.id)?.id;
  let qty = 0;
  if (items && items.opening_qty_milli > 0 && (items.opening_godown_id || defaultWh) === warehouseId && !batchId) qty += items.opening_qty_milli;
  const where = ["sm.company_id = ?", "sm.item_id = ?", "sm.warehouse_id = ?", POSTED];
  const args = [company.id, itemId, warehouseId];
  if (batchId) (where.push("sm.batch_id = ?"), args.push(batchId));
  if (to) (where.push("sm.date <= ?"), args.push(to));
  if (excludeVoucherId) (where.push("(sm.voucher_id IS NULL OR sm.voucher_id <> ?)"), args.push(excludeVoucherId));
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(CASE sm.direction WHEN 'In' THEN sm.qty_milli ELSE -sm.qty_milli END),0) q FROM stock_movements sm WHERE ${where.join(" AND ")}`,
    )
    .get(...args);
  return qty + r.q;
}
