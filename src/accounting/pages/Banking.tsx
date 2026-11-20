import { useEffect, useState } from "react";
import { Upload, Wand2 } from "lucide-react";
import { Badge, Button, EmptyState, ErrorBox, Modal, Notice, Spinner, SuccessBox } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { Amount, DataTable, Field, KeyValue, LedgerSelect, StatusBadge, Tabs } from "../components";
import { useCompany } from "../context";
import { Ledger, today } from "../lib";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tab = "lines" | "brs" | "rules" | "cheques" | "history";

export default function Banking() {
  const { capi, company, can } = useCompany();
  const accounts = useAsync(() => capi.get<any[]>("/bank-accounts"), [company.id]);
  const ledgers = useAsync(() => capi.get<Ledger[]>("/ledgers"), [company.id]);
  const [bankId, setBankId] = useState("");
  useEffect(() => {
    if (!bankId && accounts.data?.length) setBankId(accounts.data[0].ledgerId);
  }, [accounts.data, bankId]);
  const [tab, setTab] = useState<Tab>("lines");
  const [status, setStatus] = useState("Unmatched");
  const [asOf, setAsOf] = useState(today());
  const lines = useAsync(
    () => (bankId && tab === "lines" ? capi.get<any[]>(`/bank/transactions?bankLedgerId=${bankId}${status ? `&status=${status}` : ""}`) : Promise.resolve([])),
    [bankId, tab, status],
  );
  const brs = useAsync(
    () => (bankId && tab === "brs" ? capi.get<any>(`/bank/brs?bankLedgerId=${bankId}&asOf=${asOf}`) : Promise.resolve(null)),
    [bankId, tab, asOf],
  );
  const rules = useAsync(() => (tab === "rules" ? capi.get<any[]>("/bank/rules") : Promise.resolve([])), [tab, company.id]);
  const cheques = useAsync(() => (tab === "cheques" ? capi.get<any[]>("/cheques") : Promise.resolve([])), [tab, company.id]);
  const history = useAsync(() => (tab === "history" ? capi.get<any[]>("/bank/brs/history") : Promise.resolve([])), [tab, company.id]);
  const suggestions = useAsync(
    () => (bankId && tab === "lines" && status === "Unmatched" ? capi.get<any>(`/ai/bank-suggestions?bankLedgerId=${bankId}`) : Promise.resolve(null)),
    [bankId, tab, status],
  );
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [matching, setMatching] = useState<any | null>(null);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [postLedger, setPostLedger] = useState("");
  const [rule, setRule] = useState({ name: "", matchText: "", direction: "Debit", ledgerId: "", isBankCharge: false });
  const [cheque, setCheque] = useState({ direction: "Issued", chequeNo: "", chequeDate: today(), partyName: "", amount: "" });

  const run = async (fn: () => Promise<unknown>, ok: string | ((r: any) => string), after?: () => unknown) => {
    setErr("");
    setMsg("");
    try {
      const r = await fn();
      setMsg(typeof ok === "function" ? ok(r) : ok);
      await Promise.all([after?.(), accounts.reload()]);
    } catch (ex) {
      setErr(errorMessage(ex));
    }
  };
  const openMatch = async (line: any) => {
    setMatching(line);
    setPostLedger(suggestions.data?.suggestions.find((s: any) => s.txnId === line.id)?.ledgers[0]?.ledgerId || "");
    try {
      setCandidates(await capi.get<any[]>(`/bank/transactions/${line.id}/candidates`));
    } catch (ex) {
      setErr(errorMessage(ex));
    }
  };
  const upload = () => {
    if (!file) return;
    const fd = new FormData();
    fd.append("bankLedgerId", bankId);
    fd.append("file", file);
    void run(
      () => api.post(`${capi.base}/bank/statements`, fd),
      (r) => `Imported ${r.imported} line(s); ${r.duplicates} duplicate(s) skipped.`,
      lines.reload,
    );
  };

  if (accounts.loading && !accounts.data) return <Spinner />;
  if (!accounts.data?.length)
    return (
      <div className="panel">
        <EmptyState
          title="No bank accounts"
          description="Create a ledger under Bank Accounts (Accounts & Ledgers) with its account number and IFSC to start reconciling."
        />
      </div>
    );
  return (
    <>
      <div className="bank-cards">
        {accounts.data.map((a) => (
          <button key={a.ledgerId} className={a.ledgerId === bankId ? "bank-card active" : "bank-card"} onClick={() => setBankId(a.ledgerId)}>
            <strong>{a.name}</strong>
            <span>
              {a.bankName} {a.accountNumber}
            </span>
            <span>
              Books <Amount value={a.balancePerBooks} />{" "}
              {a.lastStatementBalance !== null && (
                <>
                  · Bank <Amount value={a.lastStatementBalance} />
                </>
              )}
            </span>
            {a.unmatchedStatementLines > 0 && <Badge tone="warning">{a.unmatchedStatementLines} to reconcile</Badge>}
          </button>
        ))}
      </div>
      <Tabs
        tabs={[
          ["lines", "Statement & matching"],
          ["brs", "Bank reconciliation (BRS)"],
          ["rules", "Rules"],
          ["cheques", "Cheques"],
          ["history", "BRS history"],
        ]}
        value={tab}
        onChange={setTab}
      />
      <ErrorBox message={err} />
      <SuccessBox message={msg} />
      {tab === "lines" && (
        <>
          {can("write") && (
            <div className="panel inline-form">
              <input type="file" accept=".csv,.xlsx" aria-label="Bank statement file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              <Button disabled={!file} onClick={upload}>
                <Upload size={14} /> Import statement
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  run(
                    () => capi.post("/bank/auto-match", { bankLedgerId: bankId }),
                    (r) => `${r.matched} line(s) matched automatically.`,
                    lines.reload,
                  )
                }
              >
                <Wand2 size={14} /> Auto-match
              </Button>
              <Button
                variant="secondary"
                onClick={() =>
                  run(
                    () => capi.post("/bank/apply-rules", { bankLedgerId: bankId }),
                    (r) => `${r.created} voucher(s) created from rules.`,
                    lines.reload,
                  )
                }
              >
                Apply rules
              </Button>
              <select aria-label="Line status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="Unmatched">Unmatched</option>
                <option value="Matched">Matched</option>
                <option value="Ignored">Ignored</option>
                <option value="">All</option>
              </select>
            </div>
          )}
          <DataTable
            rowKey={(r: any) => r.id}
            rows={lines.data || []}
            pageSize={50}
            empty="Import a CSV or Excel statement to start matching."
            columns={[
              { key: "date", label: "Date" },
              {
                key: "description",
                label: "Description",
                render: (r: any) => (
                  <span>
                    {r.description} {r.isBankCharge && <Badge tone="info">charge</Badge>}
                  </span>
                ),
              },
              { key: "reference", label: "Ref" },
              { key: "withdrawal", label: "Withdrawal", align: "right", render: (r: any) => (Number(r.withdrawal) ? <Amount value={r.withdrawal} /> : "") },
              { key: "deposit", label: "Deposit", align: "right", render: (r: any) => (Number(r.deposit) ? <Amount value={r.deposit} /> : "") },
              {
                key: "status",
                label: "Status",
                render: (r: any) =>
                  r.match ? <span title={`${r.match.method} ${r.match.confidence}%`}>{r.match.voucher}</span> : <StatusBadge status={r.status} />,
              },
              {
                key: "act",
                label: "",
                render: (r: any) =>
                  !can("write") ? null : r.status === "Matched" ? (
                    <button className="text-link" onClick={() => run(() => capi.del(`/bank/transactions/${r.id}/match`), "Unmatched.", lines.reload)}>
                      Unmatch
                    </button>
                  ) : (
                    <span className="mini-actions">
                      <button className="text-link" onClick={() => openMatch(r)}>
                        Match / post
                      </button>
                      <button className="text-link" onClick={() => run(() => capi.post(`/bank/transactions/${r.id}/ignore`, {}), "Updated.", lines.reload)}>
                        {r.status === "Ignored" ? "Restore" : "Ignore"}
                      </button>
                    </span>
                  ),
              },
            ]}
          />
        </>
      )}
      {tab === "brs" && (
        <>
          <div className="toolbar">
            <input type="date" aria-label="As at" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
            {can("write") && (
              <Button
                variant="secondary"
                onClick={() => run(() => capi.post("/bank/brs", { bankLedgerId: bankId, asOf }), "Reconciliation saved.", history.reload)}
              >
                Save BRS
              </Button>
            )}
          </div>
          {brs.data ? (
            <>
              <KeyValue
                items={[
                  ["Balance as per books", <Amount key="b" value={brs.data.balancePerBooks} />],
                  ["Balance as per bank (computed)", <Amount key="c" value={brs.data.balancePerBankComputed} />],
                  [
                    "Balance as per statement",
                    brs.data.balancePerStatement === null ? "No statement" : <Amount key="s" value={brs.data.balancePerStatement} />,
                  ],
                  ["Difference", brs.data.difference === null ? "—" : <Amount key="d" value={brs.data.difference} />],
                ]}
              />
              {brs.data.reconciled && <Notice title="Reconciled">Books and bank agree as at {brs.data.asOf}.</Notice>}
              {(
                [
                  ["Add: cheques issued but not presented", brs.data.chequesNotPresented, "entry"],
                  ["Less: deposits not yet credited by bank", brs.data.depositsNotCredited, "entry"],
                  ["Add: credits in bank not in books", brs.data.creditsInBankNotInBooks, "txn"],
                  ["Less: debits in bank not in books", brs.data.debitsInBankNotInBooks, "txn"],
                ] as const
              ).map(([title, rows, kind]) => (
                <div key={title}>
                  <h3 className="section-title">
                    {title} ({rows.length})
                  </h3>
                  {rows.length > 0 && (
                    <DataTable
                      rowKey={(r: any) => r.entryId || r.txnId}
                      rows={rows as any[]}
                      columns={
                        kind === "entry"
                          ? [
                              { key: "date", label: "Date" },
                              { key: "voucher", label: "Voucher" },
                              { key: "party", label: "Party" },
                              { key: "instrumentNo", label: "Cheque" },
                              { key: "amount", label: "Amount", align: "right", render: (r: any) => <Amount value={r.amount} /> },
                              {
                                key: "clr",
                                label: "",
                                render: (r: any) =>
                                  can("write") ? (
                                    <button
                                      className="text-link"
                                      onClick={() => {
                                        const d = window.prompt("Bank clearing date (YYYY-MM-DD)", asOf);
                                        if (d) void run(() => capi.patch(`/entries/${r.entryId}/bank-date`, { bankDate: d }), "Marked cleared.", brs.reload);
                                      }}
                                    >
                                      Mark cleared
                                    </button>
                                  ) : null,
                              },
                            ]
                          : [
                              { key: "date", label: "Date" },
                              { key: "description", label: "Description" },
                              { key: "amount", label: "Amount", align: "right", render: (r: any) => <Amount value={r.amount} /> },
                            ]
                      }
                    />
                  )}
                </div>
              ))}
            </>
          ) : (
            <Spinner />
          )}
        </>
      )}
      {tab === "rules" && (
        <>
          <DataTable
            rowKey={(r: any) => r.id}
            rows={rules.data || []}
            empty="Rules post recurring statement lines (bank charges, interest, standing instructions) to a ledger automatically."
            columns={[
              { key: "name", label: "Rule" },
              { key: "matchText", label: "Description contains" },
              { key: "direction", label: "Direction" },
              { key: "ledgerId", label: "Post to", render: (r: any) => (ledgers.data || []).find((l) => l.id === r.ledgerId)?.name || "" },
              {
                key: "del",
                label: "",
                render: (r: any) =>
                  can("write") ? (
                    <button className="text-link" onClick={() => run(() => capi.del(`/bank/rules/${r.id}`), "Rule removed.", rules.reload)}>
                      Delete
                    </button>
                  ) : null,
              },
            ]}
          />
          {can("write") && (
            <form
              className="panel inline-form"
              onSubmit={(e) => (e.preventDefault(), void run(() => capi.post("/bank/rules", rule), "Rule added.", rules.reload))}
            >
              <input required placeholder="Rule name" value={rule.name} onChange={(e) => setRule((r) => ({ ...r, name: e.target.value }))} />
              <input required placeholder="Text to match" value={rule.matchText} onChange={(e) => setRule((r) => ({ ...r, matchText: e.target.value }))} />
              <select value={rule.direction} onChange={(e) => setRule((r) => ({ ...r, direction: e.target.value }))}>
                <option>Debit</option>
                <option>Credit</option>
                <option>Any</option>
              </select>
              <LedgerSelect ledgers={ledgers.data || []} value={rule.ledgerId} onChange={(v) => setRule((r) => ({ ...r, ledgerId: v }))} required />
              <label className="checkbox-label">
                <input type="checkbox" checked={rule.isBankCharge} onChange={(e) => setRule((r) => ({ ...r, isBankCharge: e.target.checked }))} /> Bank charge
              </label>
              <Button type="submit">Add rule</Button>
            </form>
          )}
        </>
      )}
      {tab === "cheques" && (
        <>
          <DataTable
            rowKey={(r: any) => r.id}
            rows={cheques.data || []}
            empty="Track issued and received cheques, including stale and bounced ones."
            columns={[
              { key: "chequeDate", label: "Date" },
              { key: "chequeNo", label: "Cheque" },
              { key: "direction", label: "Type" },
              { key: "partyName", label: "Party" },
              { key: "bank", label: "Bank" },
              { key: "amount", label: "Amount", align: "right", render: (r: any) => <Amount value={r.amount} /> },
              { key: "status", label: "Status", render: (r: any) => <StatusBadge status={r.status} /> },
              {
                key: "act",
                label: "",
                render: (r: any) =>
                  can("write") && !["Cleared", "Cancelled"].includes(r.status) ? (
                    <span className="mini-actions">
                      <button
                        className="text-link"
                        onClick={() =>
                          run(() => capi.patch(`/cheques/${r.id}`, { status: "Cleared", clearedDate: today() }), "Cheque cleared.", cheques.reload)
                        }
                      >
                        Cleared
                      </button>
                      <button
                        className="text-link"
                        onClick={() => run(() => capi.patch(`/cheques/${r.id}`, { status: "Bounced" }), "Marked bounced.", cheques.reload)}
                      >
                        Bounced
                      </button>
                    </span>
                  ) : null,
              },
            ]}
          />
          {can("write") && (
            <form
              className="panel inline-form"
              onSubmit={(e) => (
                e.preventDefault(),
                void run(() => capi.post("/cheques", { ...cheque, bankLedgerId: bankId }), "Cheque recorded.", cheques.reload)
              )}
            >
              <select value={cheque.direction} onChange={(e) => setCheque((c) => ({ ...c, direction: e.target.value }))}>
                <option>Issued</option>
                <option>Received</option>
              </select>
              <input
                required
                placeholder="6-digit cheque no."
                value={cheque.chequeNo}
                onChange={(e) => setCheque((c) => ({ ...c, chequeNo: e.target.value }))}
              />
              <input type="date" value={cheque.chequeDate} onChange={(e) => setCheque((c) => ({ ...c, chequeDate: e.target.value }))} />
              <input placeholder="Party" value={cheque.partyName} onChange={(e) => setCheque((c) => ({ ...c, partyName: e.target.value }))} />
              <input required placeholder="Amount" value={cheque.amount} onChange={(e) => setCheque((c) => ({ ...c, amount: e.target.value }))} />
              <Button type="submit">Add cheque</Button>
            </form>
          )}
        </>
      )}
      {tab === "history" && (
        <DataTable
          rowKey={(r: any) => r.id}
          rows={history.data || []}
          columns={[
            { key: "asOf", label: "As at" },
            { key: "bank", label: "Bank" },
            { key: "balancePerBooks", label: "Books", align: "right", render: (r: any) => <Amount value={r.balancePerBooks} /> },
            { key: "balancePerBank", label: "Bank", align: "right", render: (r: any) => <Amount value={r.balancePerBank} /> },
            { key: "unreconciled", label: "Unreconciled", align: "right", render: (r: any) => <Amount value={r.unreconciled} /> },
          ]}
        />
      )}

      <Modal open={!!matching} title="Match statement line" onClose={() => setMatching(null)}>
        {matching && (
          <div className="form-stack">
            <p>
              {matching.date} · {matching.description} · <Amount value={Number(matching.deposit) ? matching.deposit : matching.withdrawal} />
            </p>
            <strong>Book entries with the same amount</strong>
            {candidates.length ? (
              candidates.map((c) => (
                <div key={c.entryId} className="list-row">
                  <div>
                    <strong>
                      {c.voucher} · {c.date}
                    </strong>
                    <span>
                      {c.party} · score {c.score}
                    </span>
                  </div>
                  <Button
                    onClick={() =>
                      run(
                        () => capi.post(`/bank/transactions/${matching.id}/match`, { entryId: c.entryId }),
                        "Matched.",
                        async () => {
                          setMatching(null);
                          await lines.reload();
                        },
                      )
                    }
                  >
                    Match
                  </Button>
                </div>
              ))
            ) : (
              <p className="muted">No unmatched book entry has this amount. Post it instead:</p>
            )}
            <Field label="Create a voucher against ledger">
              <LedgerSelect ledgers={ledgers.data || []} value={postLedger} onChange={setPostLedger} filter={(l) => l.kind !== "Bank"} />
            </Field>
            {suggestions.data?.suggestions.find((s: any) => s.txnId === matching.id)?.ledgers.length > 0 && (
              <span className="muted">
                AI suggestion (verify):{" "}
                {suggestions.data.suggestions
                  .find((s: any) => s.txnId === matching.id)
                  .ledgers.map((l: any) => l.ledger)
                  .join(", ")}
              </span>
            )}
            <div className="modal-actions">
              <Button
                disabled={!postLedger}
                onClick={() =>
                  run(
                    () => capi.post(`/bank/transactions/${matching.id}/create-voucher`, { ledgerId: postLedger }),
                    "Voucher posted and matched.",
                    async () => {
                      setMatching(null);
                      await lines.reload();
                    },
                  )
                }
              >
                Post & match
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
