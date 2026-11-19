// Group-tree helpers: every ledger is classified by walking up to its primary group.

export function loadTree(db, companyId) {
  const groups = db.prepare("SELECT * FROM account_groups WHERE company_id = ? ORDER BY sort_order, name").all(companyId);
  const byId = new Map(groups.map((g) => [g.id, g]));
  const info = new Map();
  const resolve = (g) => {
    if (info.has(g.id)) return info.get(g.id);
    const parent = g.parent_id ? byId.get(g.parent_id) : null;
    const p = parent ? resolve(parent) : null;
    const codes = new Set(p ? p.codes : []);
    if (g.system_code) codes.add(g.system_code);
    const out = {
      id: g.id,
      name: g.name,
      nature: p ? p.nature : g.nature,
      primary: p ? p.primary : g,
      affectsGrossProfit: p ? p.affectsGrossProfit : !!g.affects_gross_profit,
      cashFlowClass: g.cash_flow_class === "Operating" && p ? p.cashFlowClass : g.cash_flow_class,
      codes,
      path: p ? [...p.path, g.name] : [g.name],
      depth: p ? p.depth + 1 : 0,
    };
    info.set(g.id, out);
    return out;
  };
  groups.forEach(resolve);
  const ledgers = db.prepare("SELECT * FROM ledgers WHERE company_id = ? ORDER BY name").all(companyId);
  const ledgerInfo = new Map(ledgers.map((l) => [l.id, { ...l, g: info.get(l.group_id) }]));
  return { groups, byId, info, ledgers, ledgerInfo };
}

export const isPL = (gi) => gi.nature === "Income" || gi.nature === "Expenses";
export const isCashOrBank = (gi) => gi.codes.has("CASH") || gi.codes.has("BANK") || gi.codes.has("BANK_OD");
export const isBank = (gi) => gi.codes.has("BANK") || gi.codes.has("BANK_OD");
export const isStock = (gi) => gi.codes.has("STOCK");
export const isDebtor = (gi) => gi.codes.has("SUNDRY_DEBTORS");
export const isCreditor = (gi) => gi.codes.has("SUNDRY_CREDITORS");
export const isParty = (gi) => isDebtor(gi) || isCreditor(gi);

/** True when `groupId` is `ancestorId` or below it. */
export function isUnder(tree, groupId, ancestorId) {
  let g = tree.byId.get(groupId);
  while (g) {
    if (g.id === ancestorId) return true;
    g = g.parent_id ? tree.byId.get(g.parent_id) : null;
  }
  return false;
}
