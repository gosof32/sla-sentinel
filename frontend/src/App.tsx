import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CONTRACT_ADDRESS, EXPLORER, connectInjected, faucet, formatGen, getBalance, hasInjected,
  loadBurner, parseGen, read, resetBurner, type Wallet,
} from "./lib/genlayer";
import { useTransactions, type TrackedTx } from "./lib/tx";

type Sla = {
  id: number; vendor: string; name: string; status_host: string; components: string[]; exclusions: string;
  tiers: [number, number][]; partial_weight_pct: number; coverage_start: string; pool: number | string;
  allocated: number | string; created_at: string; incident_count: number; customer_count: number;
};
type Incident = {
  incident_id: string; title: string; started_at: string; resolved_at: string; components: string[]; impact: string;
  month: string; verdict: string; reason: string; reason_text: string; duration_minutes: number; counted_minutes: number;
  evidence_hash: string; filed_by: string; filed_at: string;
};
type Month = { month: string; downtime_minutes: number; incidents: number; closed: boolean; uptime_bp: number; credit_pct: number; credited_total: number | string };
type Customer = { address: string; monthly_fee: number | string; credit_balance: number | string; credited_total: number | string; withdrawn_total: number | string };
type FeedIncident = { id: string; name: string; status: string; impact: string; started_at: string; resolved_at: string | null; components: { name: string }[] };

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const fmtDate = (s: string) => new Date(s).toUTCString().replace(" GMT", " UTC").slice(5);
const pct = (bp: number) => (bp / 100).toFixed(2) + "%";
const lastMonth = () => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};

export default function App() {
  const [wallet, setWallet] = useState<Wallet>(loadBurner);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [slas, setSlas] = useState<Sla[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [months, setMonths] = useState<Month[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loadError, setLoadError] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const list = await read<Sla[]>("list_slas");
      setSlas(list);
      const id = selected ?? (list.length ? list[0].id : null);
      if (id !== null && selected === null) setSelected(id);
      if (id !== null) {
        const [i, m, c] = await Promise.all([
          read<Incident[]>("get_incidents", [id]), read<Month[]>("get_months", [id]), read<Customer[]>("get_customers", [id]),
        ]);
        setIncidents(i); setMonths(m); setCustomers(c);
      }
      setLoadError("");
    } catch (e: any) {
      setLoadError(e?.message || String(e));
    }
    getBalance(wallet.address).then(setBalance).catch(() => setBalance(null));
  }, [selected, wallet.address]);

  const { txs, send, track, clear } = useTransactions(refresh);
  useEffect(() => { refresh(); }, [refresh]);

  const sla = slas.find((s) => s.id === selected) || null;
  const isVendor = !!sla && same(sla.vendor, wallet.address);
  const me = customers.find((c) => same(c.address, wallet.address));

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="logo">◆</span>
          <div>
            <h1>SLA Sentinel</h1>
            <p>Neutral SLA-credit adjudication on GenLayer</p>
          </div>
        </div>
        <WalletPanel wallet={wallet} balance={balance} setWallet={setWallet} onFunded={refresh} />
      </header>

      <section className="hero">
        <p>
          When a SaaS vendor goes down, the vendor alone decides whether customers get SLA credits. SLA Sentinel moves that decision
          on-chain: vendors lock a GEN credit pool against their published SLA, anyone files incidents straight from the vendor's
          own public status page, and GenLayer validators must agree on each verdict before downtime counts. Credits are
          computed and paid by contract code.
        </p>
        <div className="meta">
          <span className="badge net">Studionet · chain 61999</span>
          <a href={`${EXPLORER}/address/${CONTRACT_ADDRESS}`} target="_blank" rel="noreferrer">Contract {short(CONTRACT_ADDRESS)}</a>
        </div>
      </section>

      {loadError && <div className="alert">Could not read the contract: {loadError}</div>}

      <main>
        <aside className="col-list">
          <div className="row between">
            <h2>SLAs</h2>
            <button className="ghost" onClick={() => setShowCreate((v) => !v)}>{showCreate ? "Close" : "+ New SLA"}</button>
          </div>
          {slas.length === 0 && <p className="muted">No SLAs yet. Publish the first one.</p>}
          {slas.map((s) => (
            <button key={s.id} className={`sla-card ${s.id === selected ? "active" : ""}`} onClick={() => { setSelected(s.id); setShowCreate(false); }}>
              <strong>#{s.id} {s.name}</strong>
              <span>{s.status_host}</span>
              <span className="muted">Pool {formatGen(s.pool)} GEN · {s.incident_count} incidents</span>
            </button>
          ))}
        </aside>

        <section className="col-main">
          {showCreate ? (
            <CreateSla onSubmit={(args, value) => { send(wallet, `Publish SLA "${args[0]}"`, "create_sla", args, value); setShowCreate(false); }} />
          ) : sla ? (
            <SlaDetail
              sla={sla} incidents={incidents} months={months} customers={customers} isVendor={isVendor} me={me}
              act={(label, fn, args, value) => send(wallet, label, fn, args, value)}
            />
          ) : (
            <p className="muted">Select or create an SLA.</p>
          )}
        </section>

        <aside className="col-tx">
          <TxPanel txs={txs} track={track} clear={clear} />
        </aside>
      </main>
      <footer>
        Data source: public Atlassian Statuspage APIs. Verdicts are agreed by GenLayer validators; uptime and credits are computed
        deterministically by the contract. Test network only.
      </footer>
    </div>
  );
}

function WalletPanel({ wallet, balance, setWallet, onFunded }: { wallet: Wallet; balance: bigint | null; setWallet: (w: Wallet) => void; onFunded: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div className="wallet">
      <div>
        <span className="badge">{wallet.kind === "burner" ? "Session wallet" : "Browser wallet"}</span>
        <code title={wallet.address}>{short(wallet.address)}</code>
        <span className="muted">{balance === null ? "…" : `${formatGen(balance)} GEN`}</span>
      </div>
      <div className="row">
        <button className="ghost" disabled={busy} onClick={async () => {
          setBusy(true); setErr("");
          try { await faucet(wallet.address); onFunded(); } catch (e: any) { setErr(e.message); }
          setBusy(false);
        }}>{busy ? "Funding…" : "Get test GEN"}</button>
        {wallet.kind === "burner" && hasInjected() && (
          <button className="ghost" onClick={async () => { try { setWallet(await connectInjected()); } catch (e: any) { setErr(e.message); } }}>Use MetaMask</button>
        )}
        {wallet.kind === "burner" ? (
          <button className="ghost" title="Generate a fresh session key (e.g. to act as a customer)" onClick={() => setWallet(resetBurner())}>New key</button>
        ) : (
          <button className="ghost" onClick={() => setWallet(loadBurner())}>Use session wallet</button>
        )}
      </div>
      {err && <small className="err">{err}</small>}
    </div>
  );
}

function CreateSla({ onSubmit }: { onSubmit: (args: unknown[], value: bigint) => void }) {
  const [f, setF] = useState({
    name: "GitHub Core Developer Platform",
    host: "www.githubstatus.com",
    components: "Git Operations, API Requests, Pull Requests, Actions, Webhooks",
    exclusions: "Scheduled maintenance announced in advance. Outages of third-party AI model providers used by Copilot.",
    tiers: "9990:10,9950:25,9900:50",
    partial: "50",
    coverage: lastMonth(),
    pool: "50",
  });
  const [err, setErr] = useState("");
  const [available, setAvailable] = useState<string[]>([]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    const ctl = new AbortController();
    fetch(`https://${f.host.trim()}/api/v2/components.json`, { signal: ctl.signal })
      .then((r) => r.json()).then((j) => setAvailable((j.components || []).filter((c: any) => !c.group).map((c: any) => c.name)))
      .catch(() => setAvailable([]));
    return () => ctl.abort();
  }, [f.host]);

  return (
    <form className="card" onSubmit={(e) => {
      e.preventDefault();
      try {
        onSubmit([f.name, f.host, f.components, f.exclusions, f.tiers, Number(f.partial), f.coverage], parseGen(f.pool));
      } catch (x: any) { setErr(x.message); }
    }}>
      <h2>Publish an SLA</h2>
      <p className="muted">You become the vendor. The GEN you send is locked as the credit pool; there is no vendor withdrawal.</p>
      <label>Service name<input value={f.name} onChange={set("name")} required /></label>
      <label>Statuspage host<input value={f.host} onChange={set("host")} required /></label>
      <label>Covered components (comma separated)<input value={f.components} onChange={set("components")} required /></label>
      {available.length > 0 && <small className="muted">Components on this status page: {available.join(", ")}</small>}
      <label>Exclusions<textarea value={f.exclusions} onChange={set("exclusions")} rows={2} /></label>
      <div className="grid2">
        <label>Credit tiers (uptime bp : credit %)<input value={f.tiers} onChange={set("tiers")} required /></label>
        <label>Degraded weight %<input type="number" min={0} max={100} value={f.partial} onChange={set("partial")} /></label>
        <label>Coverage starts (YYYY-MM)<input value={f.coverage} onChange={set("coverage")} pattern="\d{4}-\d{2}" /></label>
        <label>Initial pool (GEN)<input value={f.pool} onChange={set("pool")} /></label>
      </div>
      <small className="muted">Example: 9990:10 means uptime below 99.90% earns a 10% credit of the monthly fee.</small>
      {err && <div className="alert">{err}</div>}
      <button type="submit">Publish SLA</button>
    </form>
  );
}

function SlaDetail({ sla, incidents, months, customers, isVendor, me, act }: {
  sla: Sla; incidents: Incident[]; months: Month[]; customers: Customer[]; isVendor: boolean; me?: Customer;
  act: (label: string, fn: string, args: unknown[], value?: bigint) => void;
}) {
  const [feed, setFeed] = useState<FeedIncident[]>([]);
  const [incidentId, setIncidentId] = useState("");
  const [fundAmt, setFundAmt] = useState("10");
  const [cust, setCust] = useState({ address: "", fee: "40" });
  const [closeM, setCloseM] = useState(lastMonth());
  const [err, setErr] = useState("");
  const filed = useMemo(() => new Set(incidents.map((i) => i.incident_id)), [incidents]);

  useEffect(() => {
    fetch(`https://${sla.status_host}/api/v2/incidents.json`).then((r) => r.json())
      .then((j) => setFeed((j.incidents || []).filter((i: FeedIncident) => i.resolved_at && i.started_at.slice(0, 7) >= sla.coverage_start)))
      .catch(() => setFeed([]));
  }, [sla.status_host, sla.coverage_start]);

  const guard = (fn: () => void) => { setErr(""); try { fn(); } catch (e: any) { setErr(e.message); } };

  return (
    <div className="stack">
      <div className="card">
        <div className="row between">
          <h2>#{sla.id} {sla.name}</h2>
          {isVendor && <span className="badge vendor">You are the vendor</span>}
          {me && <span className="badge cust">You are a customer</span>}
        </div>
        <div className="stats">
          <div><span>Credit pool</span><strong>{formatGen(sla.pool)} GEN</strong></div>
          <div><span>Credits allocated</span><strong>{formatGen(sla.allocated)} GEN</strong></div>
          <div><span>Customers</span><strong>{sla.customer_count}</strong></div>
          <div><span>Coverage from</span><strong>{sla.coverage_start}</strong></div>
        </div>
        <dl>
          <dt>Status page</dt><dd><a href={`https://${sla.status_host}`} target="_blank" rel="noreferrer">{sla.status_host}</a></dd>
          <dt>Covered</dt><dd>{sla.components.map((c) => <span key={c} className="chip">{c}</span>)}</dd>
          <dt>Exclusions</dt><dd>{sla.exclusions || "None"}</dd>
          <dt>Credit tiers</dt><dd>{sla.tiers.map(([bp, p]) => <span key={bp} className="chip">&lt; {pct(bp)} → {p}%</span>)} · degraded time counts {sla.partial_weight_pct}%</dd>
          <dt>Vendor</dt><dd><code>{sla.vendor}</code></dd>
        </dl>
      </div>

      {err && <div className="alert">{err}</div>}

      <div className="card">
        <h3>File an incident</h3>
        <p className="muted">Pick a resolved incident from the vendor's live status page. Validators fetch it independently and must agree on the verdict.</p>
        <div className="row">
          <input placeholder="Statuspage incident id" value={incidentId} onChange={(e) => setIncidentId(e.target.value.trim())} />
          <button disabled={!incidentId} onClick={() => act(`File incident ${incidentId}`, "file_incident", [sla.id, incidentId])}>Adjudicate</button>
        </div>
        <div className="feed">
          {feed.slice(0, 25).map((i) => (
            <button key={i.id} className={`feed-item ${filed.has(i.id) ? "done" : ""} ${incidentId === i.id ? "active" : ""}`} disabled={filed.has(i.id)} onClick={() => setIncidentId(i.id)}>
              <span className={`impact ${i.impact}`}>{i.impact}</span>
              <span className="grow">{i.name}</span>
              <span className="muted">{i.started_at.slice(0, 10)}</span>
              {filed.has(i.id) && <span className="muted">filed</span>}
            </button>
          ))}
          {feed.length === 0 && <p className="muted">No resolved incidents in coverage on the live feed.</p>}
        </div>
      </div>

      <div className="grid2">
        <div className="card">
          <h3>Settle a month</h3>
          <p className="muted">Anyone can close a month after it ends. Uptime → tier → credits for every enrolled customer, pro-rata if the pool is short.</p>
          <div className="row">
            <input value={closeM} onChange={(e) => setCloseM(e.target.value)} />
            <button onClick={() => act(`Close ${closeM}`, "close_month", [sla.id, closeM])}>Close month</button>
          </div>
        </div>
        <div className="card">
          <h3>Pool & credits</h3>
          <div className="row">
            <input value={fundAmt} onChange={(e) => setFundAmt(e.target.value)} />
            <button className="ghost" onClick={() => guard(() => act(`Fund pool +${fundAmt} GEN`, "fund_pool", [sla.id], parseGen(fundAmt)))}>Fund pool</button>
          </div>
          {me && (
            <div className="row">
              <span>Your credit: <strong>{formatGen(me.credit_balance)} GEN</strong></span>
              <button disabled={BigInt(me.credit_balance) === 0n} onClick={() => act("Withdraw credit", "withdraw_credit", [sla.id])}>Withdraw</button>
            </div>
          )}
        </div>
      </div>

      {isVendor && (
        <div className="card">
          <h3>Enroll a customer</h3>
          <div className="row">
            <input placeholder="0x customer address" value={cust.address} onChange={(e) => setCust({ ...cust, address: e.target.value.trim() })} />
            <input className="narrow" value={cust.fee} onChange={(e) => setCust({ ...cust, fee: e.target.value })} title="Monthly fee (GEN)" />
            <button onClick={() => guard(() => act(`Enroll ${short(cust.address)}`, "enroll_customer", [sla.id, cust.address, parseGen(cust.fee)]))}>Enroll</button>
          </div>
        </div>
      )}

      <div className="card">
        <h3>Monthly ledger</h3>
        <table>
          <thead><tr><th>Month</th><th>Incidents</th><th>Counted downtime</th><th>Uptime</th><th>Credit</th><th>Paid out</th><th>State</th></tr></thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.month}>
                <td>{m.month}</td><td>{m.incidents}</td><td>{m.downtime_minutes} min</td>
                <td>{m.closed ? pct(m.uptime_bp) : "—"}</td><td>{m.closed ? `${m.credit_pct}%` : "—"}</td>
                <td>{m.closed ? `${formatGen(m.credited_total)} GEN` : "—"}</td>
                <td><span className={`badge ${m.closed ? "ok" : ""}`}>{m.closed ? "Settled" : "Open"}</span></td>
              </tr>
            ))}
            {months.length === 0 && <tr><td colSpan={7} className="muted">No incidents filed yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Adjudicated incidents</h3>
        {incidents.length === 0 && <p className="muted">None yet.</p>}
        {incidents.map((i) => (
          <div key={i.incident_id} className="incident">
            <div className="row between">
              <a href={`https://${sla.status_host}/incidents/${i.incident_id}`} target="_blank" rel="noreferrer"><strong>{i.title}</strong></a>
              <span className={`verdict ${i.verdict}`}>{i.verdict.replace("_", " ")}</span>
            </div>
            <div className="muted">{fmtDate(i.started_at)} → {fmtDate(i.resolved_at)} · {i.duration_minutes} min · vendor impact: {i.impact}</div>
            <div>{i.reason}: {i.reason_text} <strong>{i.counted_minutes} min counted.</strong></div>
            <div className="muted small">Components: {i.components.join(", ") || "none listed"} · evidence sha256 {i.evidence_hash.slice(0, 16)}…</div>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Customers</h3>
        <table>
          <thead><tr><th>Address</th><th>Monthly fee</th><th>Credit balance</th><th>Total credited</th><th>Withdrawn</th></tr></thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.address}><td><code>{short(c.address)}</code></td><td>{formatGen(c.monthly_fee)}</td><td>{formatGen(c.credit_balance)}</td><td>{formatGen(c.credited_total)}</td><td>{formatGen(c.withdrawn_total)}</td></tr>
            ))}
            {customers.length === 0 && <tr><td colSpan={5} className="muted">No customers enrolled.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const STEPS = ["signing", "submitted", "pending", "accepted", "finalized"];

function TxPanel({ txs, track, clear }: { txs: TrackedTx[]; track: (h: string) => void; clear: () => void }) {
  const [hash, setHash] = useState("");
  return (
    <div className="card sticky">
      <div className="row between"><h3>Transactions</h3><button className="ghost" onClick={clear}>Clear done</button></div>
      <p className="muted small">Each write goes through GenLayer consensus. Tracking survives reloads, and a submitted transaction is never resubmitted automatically.</p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (/^0x[0-9a-fA-F]{64}$/.test(hash)) { track(hash); setHash(""); } }}>
        <input placeholder="Resume by tx hash" value={hash} onChange={(e) => setHash(e.target.value.trim())} />
        <button className="ghost" type="submit">Track</button>
      </form>
      {txs.length === 0 && <p className="muted">No transactions yet.</p>}
      {txs.map((t) => {
        const idx = STEPS.indexOf(t.phase);
        const bad = t.phase === "failed" || t.phase === "rejected";
        return (
          <div key={t.id} className={`tx ${bad ? "bad" : ""}`}>
            <strong>{t.label}</strong>
            <div className="steps">
              {STEPS.map((s, i) => <span key={s} className={i <= idx ? "on" : ""}>{s}</span>)}
            </div>
            <div className="small">
              {t.phase === "rejected" && <>Not submitted: {t.error}</>}
              {t.phase === "failed" && <>Failed{t.status ? ` (${t.status}${t.execution ? ` / ${t.execution}` : ""})` : ""}: {t.error}</>}
              {!bad && t.status && <>Consensus: {t.status}{t.execution ? ` · execution ${t.execution}` : ""}</>}
            </div>
            {t.hash && <a className="small" href={`${EXPLORER}/tx/${t.hash}`} target="_blank" rel="noreferrer">{short(t.hash)} ↗</a>}
          </div>
        );
      })}
    </div>
  );
}
