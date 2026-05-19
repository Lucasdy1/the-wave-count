import React, { useEffect, useMemo, useState } from 'react';
import './App.css';
import { supabase } from './supabase';

type Position = {
  id: number;
  asset: string;
  direction: 'Long' | 'Short';
  avgEntry: number;
  entryDate: string;
  status: 'open' | 'closed';
  current: number | null;
  lastUpdated: string | null;

  weight: number;
remainingWeight: number;
realizedReturn: number;
};

type DbPosition = {
  id: number;
  asset: string;
  direction: 'Long' | 'Short';
  avg_entry: number;
  entry_date: string;
  status: 'open' | 'closed';
  current: number | null;
  last_updated: string | null;

  weight: number;
remaining_weight: number;
realized_return: number;
};

type PortfolioSnapshot = {
  id: number;
  date: string;
  openReturn: number;
  closedReturn: number;
  totalReturn: number;
  createdAt: string;
};

type DbPortfolioSnapshot = {
  id: number;
  date: string;
  open_return: number;
  closed_return: number;
  total_return: number;
  created_at: string;
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

const ADMIN_PASSWORD = 'Passwort123567!';
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

function fromDb(row: DbPosition): Position {
  return {
    id: row.id,
    asset: row.asset,
    direction: row.direction,
    avgEntry: row.avg_entry,
    entryDate: row.entry_date,
    status: row.status,
    current: row.current,
    lastUpdated: row.last_updated,

    weight: row.weight,
remainingWeight: row.remaining_weight,
realizedReturn: row.realized_return,
  };
}

function toDb(position: Omit<Position, 'id'>) {
  return {
    asset: position.asset,
    direction: position.direction,
    avg_entry: position.avgEntry,
    entry_date: position.entryDate,
    status: position.status,
    current: position.current,
    last_updated: position.lastUpdated,

    weight: position.weight,
remaining_weight: position.remainingWeight,
realized_return: position.realizedReturn,
  };
}

async function fetchPrice(symbol: string): Promise<number | null> {
  const clean = symbol.toUpperCase();

  const cryptoMap: Record<string, string> = {
    BTC: 'bitcoin',
    ETH: 'ethereum',
    SOL: 'solana',
    XRP: 'ripple',
    ADA: 'cardano',
    DOGE: 'dogecoin',
    LINK: 'chainlink',
    AVAX: 'avalanche-2',
  };

  try {
    // CRYPTO → CoinGecko
    if (cryptoMap[clean]) {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${cryptoMap[clean]}&vs_currencies=usd`
      );

      const data = await res.json();
      return data?.[cryptoMap[clean]]?.usd ?? null;
    }

    // STOCKS → Finnhub
    if (!FINNHUB_API_KEY) return null;

    const response = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${clean}&token=${FINNHUB_API_KEY}`
    );

    const data = await response.json();

    return typeof data.c === 'number' && data.c > 0
      ? data.c
      : null;
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
    .filter((p) => {
      if (status === 'open') return p.remainingWeight > 0;
      return p.remainingWeight < p.weight;
    })
    .forEach((p) => {
      const key = `${p.asset}-${p.direction}`;
      const existing = buckets.get(key) ?? [];
      buckets.set(key, [...existing, p]);
    });

  return Array.from(buckets.values()).map((entries) => {
    const sorted = [...entries].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
    const activeEntries = status === 'open'
      ? sorted.filter((p) => p.remainingWeight > 0)
      : sorted.filter((p) => p.remainingWeight < p.weight);

    const totalWeight = activeEntries.reduce((sum, p) => sum + p.remainingWeight, 0);
    const avgEntry = totalWeight
      ? activeEntries.reduce((sum, p) => sum + p.avgEntry * p.remainingWeight, 0) / totalWeight
      : sorted[0].avgEntry;

    const current = sorted.find((p) => p.current)?.current ?? null;
    const direction = sorted[0].direction;

    return {
      asset: sorted[0].asset,
      display: displaySymbol(sorted[0].asset),
      direction,
      status,
      avgEntry,
      firstEntryDate: sorted[0].entryDate,
      current,
      perf: calcPerf(direction, avgEntry, current),
      entries: activeEntries,
    };
  });
}

function Donut({ groups }: { groups: GroupedPosition[] }) {
  const [hovered, setHovered] = useState<GroupedPosition | null>(null);

  const groupWeight = (group: GroupedPosition) =>
    group.entries.reduce((sum, entry) => sum + entry.remainingWeight, 0);

  const totalWeight = groups.reduce((sum, group) => sum + groupWeight(group), 0);

  if (!groups.length || totalWeight === 0) {
    return <div className="empty">No positions yet.</div>;
  }

  const radius = 62;
  const circumference = 2 * Math.PI * radius;
  const colors = ['#4ade80', '#60a5fa', '#f59e0b', '#c084fc', '#fb7185', '#22d3ee', '#a3e635'];

  let offset = 0;

  return (
    <div className="donutWrap allocationGrid">
      <div className="donutChart">
        <svg width="230" height="230" viewBox="0 0 230 230">
          <circle cx="115" cy="115" r={radius} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="32" />

          {groups.map((g, index) => {
            const weight = groupWeight(g);
            const slice = (weight / totalWeight) * circumference;
            const dashOffset = -offset;
            offset += slice;

            return (
              <circle
                key={g.asset}
                cx="115"
                cy="115"
                r={radius}
                fill="none"
                stroke={colors[index % colors.length]}
                strokeWidth="32"
                strokeDasharray={`${slice - 2} ${circumference - slice + 2}`}
                strokeDashoffset={dashOffset}
                transform="rotate(-90 115 115)"
                onMouseEnter={() => setHovered(g)}
                onMouseLeave={() => setHovered(null)}
                className="donutSlice"
              />
            );
          })}
        </svg>

        <div className="donutCenter">
          <b>{groups.length}</b>
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
        {groups.map((g, index) => {
          const weight = groupWeight(g);
          const share = (weight / totalWeight) * 100;

          return (
            <div key={g.asset} className="legendRow allocationRowBig">
              <span style={{ background: colors[index % colors.length] }} />
              <div>
                <b>{g.display}</b>
                <small> · avg {money.format(g.avgEntry)}</small>
              </div>
              <em>{share.toFixed(1)}%</em>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PortfolioChart({ snapshots }: { snapshots: PortfolioSnapshot[] }) {
  if (!snapshots.length) {
    return <div className="empty">No portfolio history yet.</div>;
  }

  const points = [...snapshots]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((s) => ({
      date: s.date,
      value: s.totalReturn,
    }));

  const min = Math.min(0, ...points.map((p) => p.value));
  const max = Math.max(10, ...points.map((p) => p.value));

  const width = 850;
  const height = 320;
  const paddingLeft = 24;
  const paddingRight = 4;
  const paddingTop = 24;
  const paddingBottom = 34;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const coords = points.map((p, index) => {
    const x =
      points.length === 1
        ? paddingLeft + chartWidth / 2
        : paddingLeft + (index / (points.length - 1)) * chartWidth;

    const y =
      paddingTop +
      chartHeight -
      ((p.value - min) / (max - min || 1)) * chartHeight;

    return { ...p, x, y };
  });

  const line = coords
    .map((p, index) => `${index === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ');

  const baselineY =
    paddingTop +
    chartHeight -
    ((0 - min) / (max - min || 1)) * chartHeight;

  const area = `${line} L ${coords[coords.length - 1].x} ${baselineY} L ${coords[0].x} ${baselineY} Z`;

  const yTicks = [50, 40, 30, 20, 10, 0].map((value) => {
  const y =
    paddingTop +
    chartHeight -
    ((value - min) / (max - min || 1)) * chartHeight;

  return { value, y };
});

  const monthLabels = points.filter((p, index, arr) => {
    if (index === 0 || index === arr.length - 1) return true;
    const prev = arr[index - 1];
    return p.date.slice(0, 7) !== prev.date.slice(0, 7);
  });

  return (
    <div className="chart cleanChart">
      <svg viewBox={`0 0 ${width} ${height}`}>
        {yTicks.map((tick, index) => (
          <g key={index}>
            <line
              x1={paddingLeft}
              x2={width - paddingRight}
              y1={tick.y}
              y2={tick.y}
              stroke="rgba(255,255,255,.08)"
            />
            <text
              x={12}
              y={tick.y + 4}
              fill="rgba(255,255,255,.55)"
              fontSize="12"
            >
              {tick.value.toFixed(0)}%
            </text>
          </g>
        ))}

        <line
          x1={paddingLeft}
          x2={width - paddingRight}
          y1={baselineY}
          y2={baselineY}
          stroke="rgba(255,255,255,.18)"
          strokeWidth="1.5"
        />

        <path d={area} fill="rgba(74, 222, 128, .22)" />

        <path
          d={line}
          fill="none"
          stroke="rgb(74, 222, 128)"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {coords.map((p, index) => (
          <circle
            key={index}
            cx={p.x}
            cy={p.y}
            r="3.5"
            fill="rgb(74, 222, 128)"
          />
        ))}

        {monthLabels.map((p, index) => {
          const coord = coords.find((c) => c.date === p.date);
          if (!coord) return null;

          return (
            <text
              key={index}
              x={coord.x}
              y={height - 8}
              textAnchor="middle"
              fill="rgba(255,255,255,.55)"
              fontSize="12"
            >
              {new Date(p.date).toLocaleDateString('en-US', {
                month: 'short',
                year: '2-digit',
              })}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

export default function Dashboard() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [expandedAsset, setExpandedAsset] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<PortfolioSnapshot[]>([]);

  async function fetchPositions() {
    const { data, error } = await supabase
      .from('positions')
      .select('*')
      .order('entry_date', { ascending: true });

    if (error) {
      console.error(error);
      return;
    }

    setPositions((data ?? []).map((row) => fromDb(row as DbPosition)));
  }

  async function refreshPrices(currentPositions = positions) {
    const symbols = Array.from(new Set(currentPositions.map((p) => p.asset)));
    const updates: Record<string, number | null> = {};

    for (const symbol of symbols) {
      updates[symbol] = await fetchPrice(symbol);
    }

    const changed = currentPositions.map((p) => {
      const price = updates[p.asset];
      return price ? { ...p, current: price, lastUpdated: new Date().toISOString() } : p;
    });

    setPositions(changed);

    for (const p of changed) {
      await supabase
        .from('positions')
        .update({ current: p.current, last_updated: p.lastUpdated })
        .eq('id', p.id);
    }
  }

useEffect(() => {
  fetchPositions();
  fetchSnapshots();
}, []);

 const fetchSnapshots = async () => {
  const { data, error } = await supabase
    .from('portfolio_snapshots')
    .select('*')
    .order('date', { ascending: true });

  if (!error && data) {
    setSnapshots(
      data.map((s: DbPortfolioSnapshot) => ({
        id: s.id,
        date: s.date,
        openReturn: s.open_return,
        closedReturn: s.closed_return,
        totalReturn: s.total_return,
        createdAt: s.created_at,
      }))
    );
  }
};

useEffect(() => {
  if (!positions.length) return;
  if (!positions.some((p) => p.current && p.current > 0)) return;

  refreshPrices(positions);

  const interval = window.setInterval(() => {
    refreshPrices(positions);
  }, 60 * 60 * 1000);

  return () => window.clearInterval(interval);
}, [positions.length]);

  const openGroups = useMemo(() => groupPositions(positions, 'open'), [positions]);
  const closedGroups = useMemo(() => groupPositions(positions, 'closed'), [positions]);
  const rows = tab === 'open' ? openGroups : closedGroups;

  const avgReturn = useMemo(() => {
  const totalPortfolioWeight = positions.reduce(
    (sum, p) => sum + p.weight,
    0
  );

  if (totalPortfolioWeight === 0) return 0;

  const openImpact = positions.reduce((sum, p) => {
    if (p.remainingWeight <= 0 || !p.current) return sum;

    const perf = calcPerf(p.direction, p.avgEntry, p.current);

    return sum + perf * (p.remainingWeight / totalPortfolioWeight);
  }, 0);

  return openImpact;
}, [positions]);

  const best = useMemo(() => {
    if (!openGroups.length) return null;
    return [...openGroups].sort((a, b) => b.perf - a.perf)[0];
  }, [openGroups]);

  const closedAvg = useMemo(() => {
  const totalPortfolioWeight = positions.reduce(
    (sum, p) => sum + p.weight,
    0
  );

  if (totalPortfolioWeight === 0) return 0;

  const realizedImpact = positions.reduce((sum, p) => {
    const closedWeight = p.weight - p.remainingWeight;

    if (closedWeight <= 0 || !p.current) return sum;

    const perf = calcPerf(p.direction, p.avgEntry, p.current);

    return sum + perf * (closedWeight / totalPortfolioWeight);
  }, 0);

  return realizedImpact;
}, [positions]);

  useEffect(() => {
  if (!positions.length) return;

  const saveSnapshot = async () => {
    const today = new Date().toISOString().split('T')[0];
    const totalReturn = avgReturn + closedAvg;

    const { data: existing } = await supabase
      .from('portfolio_snapshots')
      .select('id')
      .eq('date', today)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('portfolio_snapshots')
        .update({
          open_return: avgReturn,
          closed_return: closedAvg,
          total_return: totalReturn,
        })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('portfolio_snapshots')
        .insert({
          date: today,
          open_return: avgReturn,
          closed_return: closedAvg,
          total_return: totalReturn,
        });
    }
  };

  saveSnapshot();
}, [avgReturn, closedAvg, positions]);

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

    const nextWithoutId: Omit<Position, 'id'> = {
      asset: normalizedAsset,
      direction: form.direction,
      avgEntry: Number(form.avgEntry),
      entryDate: form.entryDate,
      status: oldPosition?.status ?? 'open',
      current: oldPosition?.current ?? null,
      lastUpdated: oldPosition?.lastUpdated ?? null,

      weight: oldPosition?.weight ?? 100,
remainingWeight: oldPosition?.remainingWeight ?? 100,
realizedReturn: oldPosition?.realizedReturn ?? 0,
    };

    if (!nextWithoutId.asset || !nextWithoutId.avgEntry || !nextWithoutId.entryDate) return;

    if (editingId) {
      const { error } = await supabase
        .from('positions')
        .update(toDb(nextWithoutId))
        .eq('id', editingId);

      if (error) {
        console.error(error);
        alert('Could not update entry. Check Supabase RLS/policies.');
        return;
      }
    } else {
      const { error } = await supabase
        .from('positions')
        .insert(toDb(nextWithoutId));

      if (error) {
        console.error(error);
        alert('Could not save entry. Check Supabase RLS/policies.');
        return;
      }
    }

    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
    setTab('open');
    await fetchPositions();
    await refreshPrices();
  }

  async function updateEntries(ids: number[], patch: Partial<DbPosition>) {
    const { error } = await supabase
      .from('positions')
      .update(patch)
      .in('id', ids);

    if (error) {
      console.error(error);
      alert('Could not update entry. Check Supabase RLS/policies.');
      return;
    }

    await fetchPositions();
  }

  async function closeEntry(id: number) {
    if (!requireAdmin()) return;
    await updateEntries([id], { status: 'closed' });
  }

  async function reopenEntry(id: number) {
    if (!requireAdmin()) return;
    await updateEntries([id], { status: 'open' });
  }

  async function closeGroup(group: GroupedPosition) {
    if (!requireAdmin()) return;
    await updateEntries(group.entries.map((e) => e.id), { status: 'closed' });
  }

  async function reopenGroup(group: GroupedPosition) {
    if (!requireAdmin()) return;
    await updateEntries(group.entries.map((e) => e.id), { status: 'open' });
  }

  async function deleteEntry(id: number) {
    if (!requireAdmin()) return;
    if (!window.confirm('Delete this entry?')) return;

    const { error } = await supabase.from('positions').delete().eq('id', id);
    if (error) {
      console.error(error);
      alert('Could not delete entry. Check Supabase RLS/policies.');
      return;
    }
    await fetchPositions();
  }

  async function deleteGroup(group: GroupedPosition) {
    if (!requireAdmin()) return;
    if (!window.confirm(`Delete all entries for ${group.display}?`)) return;

    const { error } = await supabase
      .from('positions')
      .delete()
      .in('id', group.entries.map((e) => e.id));

    if (error) {
      console.error(error);
      alert('Could not delete entries. Check Supabase RLS/policies.');
      return;
    }
    await fetchPositions();
  }

  return (
    <main className="app">
      <section className="wrap">
        <header className="topbar">
          <h1>The Wave Count</h1>
          <nav>
            <button className="active">Dashboard</button>
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

        <section className="allocationSection">
  <div className="panel allocationPanel">
    <div className="allocationHeader">
      <div>
        <h2>Portfolio Performance</h2>
        <p>Total portfolio return over time</p>
      </div>
    </div>

    <PortfolioChart snapshots={snapshots} />
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
                <th>{tab === 'closed' ? 'Closed' : 'Remaining'}</th>
                <th>Direction</th>
                <th>First Entry</th>
                <th>Avg Entry</th>
                <th>Current</th>
                <th>Perf.</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={8} className="emptyRow">No positions yet.</td></tr>
              ) : rows.map((group) => {
                const isExpanded = expandedAsset === `${group.asset}-${group.status}`;
                return (
                  <React.Fragment key={`${group.asset}-${group.status}`}>
                    <tr className="assetMainRow" onClick={() => setExpandedAsset(isExpanded ? null : `${group.asset}-${group.status}`)}>
                      <td><b>{isExpanded ? '▾' : '▸'} {group.display}</b></td>
                      <td>{group.entries.length}</td>
                      <td>
  {tab === 'closed'
    ? `${group.entries.reduce((sum, entry) => sum + (entry.weight - entry.remainingWeight), 0)} / ${group.entries.reduce((sum, entry) => sum + entry.weight, 0)}`
    : `${group.entries.reduce((sum, entry) => sum + entry.remainingWeight, 0)} / ${group.entries.reduce((sum, entry) => sum + entry.weight, 0)}`}
</td>
                      <td>{group.direction}</td>
                      <td>{group.firstEntryDate}</td>
                      <td>{money.format(group.avgEntry)}</td>
                      <td>{group.current ? money.format(group.current) : 'Waiting for API'}</td>
                      <td className={group.perf >= 0 ? 'green' : 'red'}>{pct(group.perf)}</td>
                    </tr>

                    {isExpanded && group.entries.map((entry, index) => {
  const entryPerf = calcPerf(entry.direction, entry.avgEntry, entry.current);

  return (
    <tr key={entry.id} className="entrySubRow">
      <td>↳ Entry</td>
      <td>
  {positions
    .filter((p) => p.asset === entry.asset && p.direction === entry.direction)
    .sort((a, b) => a.entryDate.localeCompare(b.entryDate))
    .findIndex((p) => p.id === entry.id) + 1}
</td>
      <td>
        {tab === 'closed'
          ? `${entry.weight - entry.remainingWeight} / ${entry.weight}`
          : `${entry.remainingWeight} / ${entry.weight}`}
      </td>
      <td>{entry.direction}</td>
      <td>{entry.entryDate}</td>
      <td>{money.format(entry.avgEntry)}</td>
      <td>{entry.current ? money.format(entry.current) : 'Waiting for API'}</td>
      <td className={entryPerf >= 0 ? 'green' : 'red'}>{pct(entryPerf)}</td>
    </tr>
  );
})}
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
