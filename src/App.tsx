import React, { useEffect, useMemo, useState } from 'react';
import './App.css';

type Position = {
  id: number;
  asset: string;
  direction: 'Long' | 'Short';
  avgEntry: number;
  entryDate: string;
  status: 'open' | 'closed';
  current: number | null;
  lastUpdated: string | null;
};

type GroupedPosition = {
  asset: string;
  display: string;
  direction: 'Long' | 'Short';
  status: 'open' | 'closed';
  avgEntry: number;
  firstEntryDate: string;
  current: number | null;
  perf: number;
  entries: Position[];
};

type FormState = {
  asset: string;
  direction: 'Long' | 'Short';
  avgEntry: string;
  entryDate: string;
};

const ADMIN_PASSWORD = 'CHANGE_ME_123';
const FINNHUB_API_KEY = import.meta.env.VITE_FINNHUB_API_KEY;

const CRYPTO_SYMBOLS: Record<string, string> = {
  BTC: 'BINANCE:BTCUSDT',
  BITCOIN: 'BINANCE:BTCUSDT',
  ETH: 'BINANCE:ETHUSDT',
  ETHEREUM: 'BINANCE:ETHUSDT',
  SOL: 'BINANCE:SOLUSDT',
  XRP: 'BINANCE:XRPUSDT',
  ADA: 'BINANCE:ADAUSDT',
  DOGE: 'BINANCE:DOGEUSDT',
  LINK: 'BINANCE:LINKUSDT',
  AVAX: 'BINANCE:AVAXUSDT',
};

function normalizeSymbol(symbol: string) {
  const cleaned = symbol.trim().toUpperCase();
  return CRYPTO_SYMBOLS[cleaned] ?? cleaned;
}

function displaySymbol(symbol: string) {
  const cleaned = symbol.trim().toUpperCase();
  return cleaned.replace('BINANCE:', '').replace('USDT', '').replace('USD', '').replace(':', '');
}

const emptyForm: FormState = {
  asset: '',
  direction: 'Long',
  avgEntry: '',
  entryDate: new Date().toISOString().slice(0, 10),
};

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const pct = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

function load<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch {
    return fallback;
  }
}

function save<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

async function fetchPrice(symbol: string): Promise<number | null> {
  if (!FINNHUB_API_KEY || FINNHUB_API_KEY === 'PASTE_YOUR_FINNHUB_KEY_HERE') return null;

  try {
    const apiSymbol = encodeURIComponent(normalizeSymbol(symbol));
    const response = await fetch(`https://finnhub.io/api/v1/quote?symbol=${apiSymbol}&token=${FINNHUB_API_KEY}`);
    const data = await response.json();
    return typeof data.c === 'number' && data.c > 0 ? data.c : null;
  } catch {
    return null;
  }
}

function calcPerf(direction: 'Long' | 'Short', avgEntry: number, current: number | null) {
  if (!current) return 0;
  return direction === 'Long'
    ? ((current - avgEntry) / avgEntry) * 100
    : ((avgEntry - current) / avgEntry) * 100;
}

function groupPositions(positions: Position[], status: 'open' | 'closed'): GroupedPosition[] {
  const buckets = new Map<string, Position[]>();

  positions
    .filter((p) => p.status === status)
    .forEach((p) => {
      const key = `${p.asset}-${p.direction}-${p.status}`;
      const existing = buckets.get(key) ?? [];
      buckets.set(key, [...existing, p]);
    });

  return Array.from(buckets.values()).map((entries) => {
    const sorted = [...entries].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
    const avgEntry = sorted.reduce((sum, p) => sum + p.avgEntry, 0) / sorted.length;
    const current = sorted.find((p) => p.current)?.current ?? null;
    const direction = sorted[0].direction;

    return {
      asset: sorted[0].asset,
      display: displaySymbol(sorted[0].asset),
      direction,
      status: sorted[0].status,
      avgEntry,
      firstEntryDate: sorted[0].entryDate,
      current,
      perf: calcPerf(direction, avgEntry, current),
      entries: sorted,
    };
  });
}

function Donut({ groups }: { groups: GroupedPosition[] }) {
  const [hovered, setHovered] = useState<GroupedPosition | null>(null);
  const count = groups.length;

  if (!count) return <div className="empty">No positions yet.</div>;

  const radius = 62;
  const circumference = 2 * Math.PI * radius;
  const slice = circumference / count;
  const colors = ['#4ade80', '#60a5fa', '#f59e0b', '#c084fc', '#fb7185', '#22d3ee', '#a3e635'];

  return (
    <div className="donutWrap allocationGrid">
      <div className="donutChart">
        <svg width="230" height="230" viewBox="0 0 230 230">
          <circle cx="115" cy="115" r={radius} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="32" />
          {groups.map((g, index) => (
            <circle
              key={g.asset}
              cx="115"
              cy="115"
              r={radius}
              fill="none"
              stroke={colors[index % colors.length]}
              strokeWidth="32"
              strokeDasharray={`${slice - 2} ${circumference - slice + 2}`}
              strokeDashoffset={-(slice * index)}
              transform="rotate(-90 115 115)"
              onMouseEnter={() => setHovered(g)}
              onMouseLeave={() => setHovered(null)}
              className="donutSlice"
            />
          ))}
        </svg>

        <div className="donutCenter">
          <b>{count}</b>
          <span>Positions</span>
        </div>

        {hovered && (
          <div className="tooltip">
            <b>{hovered.display}</b>
            <span>{pct(hovered.perf)}</span>
          </div>
        )}
      </div>

      <div className="donutLegend allocationScroll">
        {groups.map((g, index) => (
          <div key={g.asset} className="legendRow allocationRowBig">
            <span style={{ background: colors[index % colors.length] }} />
            <div>
              <b>{g.display}</b>
              <small> · avg {money.format(g.avgEntry)}</small>
            </div>
            <em>{(100 / count).toFixed(1)}%</em>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [positions, setPositions] = useState<Position[]>(() => load('wave-count-positions-v5', []));
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [expandedAsset, setExpandedAsset] = useState<string | null>(null);

  useEffect(() => save('wave-count-positions-v5', positions), [positions]);

  const openGroups = useMemo(() => groupPositions(positions, 'open'), [positions]);
  const closedGroups = useMemo(() => groupPositions(positions, 'closed'), [positions]);
  const rows = tab === 'open' ? openGroups : closedGroups;

  const avgReturn = useMemo(() => {
    if (!openGroups.length) return 0;
    return openGroups.reduce((sum, g) => sum + g.perf, 0) / openGroups.length;
  }, [openGroups]);

  const best = useMemo(() => {
    if (!openGroups.length) return null;
    return [...openGroups].sort((a, b) => b.perf - a.perf)[0];
  }, [openGroups]);

  const closedAvg = useMemo(() => {
    if (!closedGroups.length) return 0;
    return closedGroups.reduce((sum, g) => sum + g.perf, 0) / closedGroups.length;
  }, [closedGroups]);

  async function refreshPrices(currentPositions = positions) {
    const symbols = Array.from(new Set(currentPositions.map((p) => p.asset)));
    const updates: Record<string, number | null> = {};

    for (const symbol of symbols) {
      updates[symbol] = await fetchPrice(symbol);
    }

    setPositions((prev) =>
      prev.map((p) => {
        const price = updates[p.asset];
        return price ? { ...p, current: price, lastUpdated: new Date().toISOString() } : p;
      })
    );
  }

  useEffect(() => {
    refreshPrices();
    const interval = window.setInterval(() => refreshPrices(), 60 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, []);

  function requireAdmin() {
    const password = window.prompt('Enter admin password');
    if (password !== ADMIN_PASSWORD) {
      window.alert('Wrong password');
      return false;
    }
    return true;
  }

  function openAddTrade() {
    if (!requireAdmin()) return;
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function openEdit(entry: Position) {
    if (!requireAdmin()) return;
    setEditingId(entry.id);
    setForm({
      asset: displaySymbol(entry.asset),
      direction: entry.direction,
      avgEntry: String(entry.avgEntry),
      entryDate: entry.entryDate,
    });
    setShowForm(true);
  }

  async function savePosition(e: React.FormEvent) {
    e.preventDefault();

    const normalizedAsset = normalizeSymbol(form.asset);
    const oldPosition = editingId ? positions.find((p) => p.id === editingId) : null;

    const next: Position = {
      id: editingId ?? Date.now(),
      asset: normalizedAsset,
      direction: form.direction,
      avgEntry: Number(form.avgEntry),
      entryDate: form.entryDate,
      status: oldPosition?.status ?? 'open',
      current: oldPosition?.current ?? null,
      lastUpdated: oldPosition?.lastUpdated ?? null,
    };

    if (!next.asset || !next.avgEntry || !next.entryDate) return;

    const nextPositions = editingId
      ? positions.map((p) => (p.id === editingId ? next : p))
      : [next, ...positions];

    setPositions(nextPositions);
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
    setTab('open');

    await refreshPrices(nextPositions);
  }

  function closeEntry(id: number) {
    if (!requireAdmin()) return;
    setPositions((prev) => prev.map((p) => (p.id === id ? { ...p, status: 'closed' } : p)));
  }

  function reopenEntry(id: number) {
    if (!requireAdmin()) return;
    setPositions((prev) => prev.map((p) => (p.id === id ? { ...p, status: 'open' } : p)));
  }

  function closeGroup(group: GroupedPosition) {
    if (!requireAdmin()) return;
    const ids = new Set(group.entries.map((e) => e.id));
    setPositions((prev) => prev.map((p) => (ids.has(p.id) ? { ...p, status: 'closed' } : p)));
  }

  function reopenGroup(group: GroupedPosition) {
    if (!requireAdmin()) return;
    const ids = new Set(group.entries.map((e) => e.id));
    setPositions((prev) => prev.map((p) => (ids.has(p.id) ? { ...p, status: 'open' } : p)));
  }

  function deleteEntry(id: number) {
    if (!requireAdmin()) return;
    if (!window.confirm('Delete this entry?')) return;
    setPositions((prev) => prev.filter((p) => p.id !== id));
  }

  function deleteGroup(group: GroupedPosition) {
    if (!requireAdmin()) return;
    if (!window.confirm(`Delete all entries for ${group.display}?`)) return;
    const ids = new Set(group.entries.map((e) => e.id));
    setPositions((prev) => prev.filter((p) => !ids.has(p.id)));
  }

  return (
    <main className="app">
      <section className="wrap">
        <header className="topbar">
          <h1>The Wave Count</h1>
          <nav>
            <button className="active">Dashboard</button>
            <button onClick={openAddTrade}>+ Add Trade</button>
          </nav>
        </header>

        {showForm && (
          <form className="tradeForm" onSubmit={savePosition}>
            <div className="formHead">
              <h2>{editingId ? 'Edit Entry' : 'Add Entry'}</h2>
              <button type="button" onClick={() => setShowForm(false)}>Close</button>
            </div>
            <div className="formGrid">
              <input placeholder="Ticker, e.g. PLTR or BTC" value={form.asset} onChange={(e) => setForm({ ...form, asset: e.target.value })} />
              <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value as 'Long' | 'Short' })}>
                <option>Long</option>
                <option>Short</option>
              </select>
              <input type="number" step="0.01" placeholder="Average Entry" value={form.avgEntry} onChange={(e) => setForm({ ...form, avgEntry: e.target.value })} />
              <input type="date" value={form.entryDate} onChange={(e) => setForm({ ...form, entryDate: e.target.value })} />
              <button type="submit" className="saveTrade">Save Entry</button>
            </div>
          </form>
        )}

        <section className="metrics">
          <div className="card"><p>Avg. Return (open)</p><strong>{pct(avgReturn)}</strong><span>Equal-weighted open positions</span></div>
          <div className="card"><p>Best Performer</p><strong className="white">{best ? best.display : '—'}</strong><span>{best ? `Currently ${pct(best.perf)}` : 'Add your first position'}</span></div>
          <div className="card"><p>Avg. Return (closed)</p><strong>{pct(closedAvg)}</strong><span>Average of closed positions</span></div>
        </section>

        <section className="allocationSection">
          <div className="panel allocationPanel">
            <div className="allocationHeader">
              <div>
                <h2>Portfolio Allocation</h2>
                <p>Equal-weighted by open position count</p>
              </div>
            </div>
            <Donut groups={openGroups} />
          </div>
        </section>

        <section className="panel positions">
          <div className="panelHead">
            <div>
              <h2>Portfolio Positions</h2>
              <p>Click an asset row to view individual entries</p>
            </div>
            <div className="tabs">
              <button className={tab === 'open' ? 'activeTab' : ''} onClick={() => setTab('open')}>Open Positions</button>
              <button className={tab === 'closed' ? 'activeTab' : ''} onClick={() => setTab('closed')}>Closed Positions</button>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Asset</th>
                <th>Entries</th>
                <th>Direction</th>
                <th>First Entry</th>
                <th>Avg Entry</th>
                <th>Current</th>
                <th>Perf.</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="emptyRow">No positions yet.</td></tr>
              ) : rows.map((group) => {
                const isExpanded = expandedAsset === `${group.asset}-${group.status}`;
                return (
                  <React.Fragment key={`${group.asset}-${group.status}`}>
                    <tr className="assetMainRow" onClick={() => setExpandedAsset(isExpanded ? null : `${group.asset}-${group.status}`)}>
                      <td><b>{isExpanded ? '▾' : '▸'} {group.display}</b></td>
                      <td>{group.entries.length}</td>
                      <td>{group.direction}</td>
                      <td>{group.firstEntryDate}</td>
                      <td>{money.format(group.avgEntry)}</td>
                      <td>{group.current ? money.format(group.current) : 'Waiting for API'}</td>
                      <td className={group.perf >= 0 ? 'green' : 'red'}>{pct(group.perf)}</td>
                      <td className="actions" onClick={(e) => e.stopPropagation()}>
                        {group.status === 'open'
                          ? <button onClick={() => closeGroup(group)}>Close</button>
                          : <button onClick={() => reopenGroup(group)}>Reopen</button>}
                        <button onClick={() => deleteGroup(group)}>Delete</button>
                      </td>
                    </tr>

                    {isExpanded && group.entries.map((entry) => (
                      <tr key={entry.id} className="entrySubRow">
                        <td>↳ Entry</td>
                        <td>—</td>
                        <td>{entry.direction}</td>
                        <td>{entry.entryDate}</td>
                        <td>{money.format(entry.avgEntry)}</td>
                        <td>{entry.current ? money.format(entry.current) : 'Waiting for API'}</td>
                        <td className={calcPerf(entry.direction, entry.avgEntry, entry.current) >= 0 ? 'green' : 'red'}>
                          {pct(calcPerf(entry.direction, entry.avgEntry, entry.current))}
                        </td>
                        <td className="actions">
                          <button onClick={() => openEdit(entry)}>Edit</button>
                          {entry.status === 'open'
                            ? <button onClick={() => closeEntry(entry.id)}>Close</button>
                            : <button onClick={() => reopenEntry(entry.id)}>Reopen</button>}
                          <button onClick={() => deleteEntry(entry.id)}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </section>
      </section>
    </main>
  );
}
