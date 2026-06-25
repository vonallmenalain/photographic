import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { Alert, Spinner, StatusBadge } from '../../components/common';
import { formatPrice, formatDateShort } from '../../lib/format';

interface Buyer {
  email_id: string;
  email: string;
  name: string;
  verified: boolean;
  order_count: number;
  revenue_cents: number;
}
interface ReminderRow {
  id: string;
  sent_at: string;
  note: string;
}
interface DailyPoint {
  date: string;
  revenue_cents: number;
}
interface EventAnalytics {
  id: string;
  name: string;
  status: string;
  created_at: string;
  expires_at: string | null;
  revenue_cents: number;
  order_count: number;
  email_total: number;
  email_verified: number;
  buyers: Buyer[];
  daily: DailyPoint[];
  reminders: ReminderRow[];
}

export default function Analytics() {
  const [events, setEvents] = useState<EventAnalytics[]>([]);
  const [currency, setCurrency] = useState('chf');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = () =>
    api<{ events: EventAnalytics[]; currency: string }>('/api/admin/analytics', { admin: true })
      .then((r) => {
        setEvents(r.events);
        setCurrency(r.currency || 'chf');
      })
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const toggle = (id: string) => setExpanded((e) => ({ ...e, [id]: !e[id] }));

  const totals = useMemo(
    () => ({
      revenue: events.reduce((s, e) => s + e.revenue_cents, 0),
      orders: events.reduce((s, e) => s + e.order_count, 0),
    }),
    [events],
  );

  if (loading) return <Spinner />;

  return (
    <div>
      <h1>Auswertung</h1>
      <p className="soft">
        Übersicht je Auftrag/Klasse: Umsatz, wie viele Eltern bestellt haben und der zeitliche
        Verlauf. So siehst du auf einen Blick, wann sich ein Reminder lohnt – und ob er gewirkt hat.
      </p>

      <div className="stat-grid mb">
        <div className="stat">
          <div className="num">{formatPrice(totals.revenue, currency)}</div>
          <div className="lbl">Gesamtumsatz</div>
        </div>
        <div className="stat">
          <div className="num">{totals.orders}</div>
          <div className="lbl">Bestellungen</div>
        </div>
        <div className="stat">
          <div className="num">{events.length}</div>
          <div className="lbl">Aufträge</div>
        </div>
      </div>

      {events.length === 0 ? (
        <p className="muted">Noch keine Aufträge vorhanden.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {events.map((ev) => (
            <EventCard
              key={ev.id}
              ev={ev}
              currency={currency}
              open={!!expanded[ev.id]}
              onToggle={() => toggle(ev.id)}
              onReload={load}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EventCard({
  ev,
  currency,
  open,
  onToggle,
  onReload,
}: {
  ev: EventAnalytics;
  currency: string;
  open: boolean;
  onToggle: () => void;
  onReload: () => void;
}) {
  return (
    <div className="card" style={{ marginTop: 0 }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          all: 'unset',
          cursor: 'pointer',
          display: 'block',
          width: '100%',
        }}
      >
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div className="row" style={{ gap: 10, alignItems: 'center', minWidth: 0 }}>
            <span aria-hidden="true" style={{ color: 'var(--text-muted)' }}>
              {open ? '▾' : '▸'}
            </span>
            <strong style={{ fontSize: '1.05rem' }}>{ev.name}</strong>
            <StatusBadge status={ev.status} />
          </div>
        </div>
        <div className="analytics-summary">
          <SummaryStat label="Umsatz" value={formatPrice(ev.revenue_cents, currency)} />
          <SummaryStat label="Bestellungen" value={String(ev.order_count)} />
          <SummaryStat
            label="Verifizierte E-Mails"
            value={`${ev.email_verified} von ${ev.email_total}`}
          />
          <SummaryStat label="Reminder verschickt" value={String(ev.reminders.length)} />
        </div>
      </button>

      {open && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ marginBottom: 8 }}>Umsatzverlauf</h3>
          <RevenueChart daily={ev.daily} reminders={ev.reminders} currency={currency} />

          <ReminderManager event={ev} onReload={onReload} />

          <h3 style={{ marginTop: 20, marginBottom: 8 }}>Wer hat wie viel bestellt</h3>
          {ev.buyers.length === 0 ? (
            <p className="muted">Noch keine Bestellungen in diesem Auftrag.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>E-Mail</th>
                  <th>Status</th>
                  <th>Bestellungen</th>
                  <th>Umsatz</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {ev.buyers.map((b) => (
                  <tr key={b.email_id}>
                    <td>{b.email}</td>
                    <td>
                      {b.verified ? (
                        <span className="badge green">Verifiziert</span>
                      ) : (
                        <span className="badge amber">Nicht verifiziert</span>
                      )}
                    </td>
                    <td>{b.order_count}</td>
                    <td>{formatPrice(b.revenue_cents, currency)}</td>
                    <td>
                      <Link to={`/admin/emails/${b.email_id}`}>Verwalten</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted" style={{ fontSize: '0.82rem', marginTop: 10 }}>
            <Link to={`/admin/events/${ev.id}`}>→ Zum Auftrag</Link>
          </p>
        </div>
      )}
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="analytics-stat">
      <span className="analytics-stat-num">{value}</span>
      <span className="analytics-stat-lbl">{label}</span>
    </div>
  );
}

function ReminderManager({ event, onReload }: { event: EventAnalytics; onReload: () => void }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const add = async () => {
    setError('');
    setBusy(true);
    try {
      await api(`/api/admin/events/${event.id}/reminders`, {
        method: 'POST',
        admin: true,
        body: { sent_at: new Date(date).toISOString(), note },
      });
      setNote('');
      onReload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reminder konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await api(`/api/admin/reminders/${id}`, { method: 'DELETE', admin: true });
    onReload();
  };

  return (
    <div className="card" style={{ marginTop: 14, background: 'var(--surface-2)' }}>
      <strong>Reminder festhalten</strong>
      <p className="muted" style={{ fontSize: '0.82rem', marginTop: 4 }}>
        Trage ein, wann du eine Einladung oder Erinnerung verschickt hast. Die Markierung erscheint
        im Umsatzverlauf, damit du den Effekt ablesen kannst.
      </p>
      {error && <Alert kind="error">{error}</Alert>}
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label style={{ fontSize: '0.8rem' }}>Datum</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 180, marginBottom: 0 }}>
          <label style={{ fontSize: '0.8rem' }}>Notiz (optional)</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="z. B. Erinnerung an alle Eltern"
          />
        </div>
        <button className="btn small" disabled={busy} onClick={add} type="button">
          + Reminder
        </button>
      </div>
      {event.reminders.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {event.reminders.map((r) => (
            <span className="chip" key={r.id}>
              {formatDateShort(r.sent_at)}
              {r.note ? ` · ${r.note}` : ''}
              <button onClick={() => remove(r.id)} title="Entfernen">
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Compact SVG bar chart of daily revenue with reminder markers. */
function RevenueChart({
  daily,
  reminders,
  currency,
}: {
  daily: DailyPoint[];
  reminders: ReminderRow[];
  currency: string;
}) {
  if (daily.length === 0) {
    return <p className="muted">Kein Zeitraum verfügbar.</p>;
  }

  const W = 760;
  const H = 220;
  const padL = 56;
  const padR = 16;
  const padT = 14;
  const padB = 34;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const maxRevenue = Math.max(1, ...daily.map((d) => d.revenue_cents));
  // Round the y-axis maximum up to a "nice" number of francs.
  const niceMax = niceCeil(maxRevenue);
  const n = daily.length;
  const slot = chartW / n;
  const barW = Math.max(1, Math.min(slot * 0.7, 26));

  const x = (i: number) => padL + i * slot + (slot - barW) / 2;
  const y = (cents: number) => padT + chartH - (cents / niceMax) * chartH;

  const dayIndex = new Map(daily.map((d, i) => [d.date, i]));
  const reminderMarks = reminders
    .map((r) => ({ ...r, idx: dayIndex.get(r.sent_at.slice(0, 10)) }))
    .filter((r): r is ReminderRow & { idx: number } => r.idx !== undefined);

  // A handful of x labels only, to avoid clutter.
  const labelEvery = Math.max(1, Math.ceil(n / 6));
  const yTicks = [0, 0.5, 1];

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ minWidth: 480, display: 'block' }}
        role="img"
        aria-label="Umsatzverlauf pro Tag"
      >
        {/* Y grid + labels */}
        {yTicks.map((t) => {
          const yy = padT + chartH - t * chartH;
          return (
            <g key={t}>
              <line x1={padL} y1={yy} x2={W - padR} y2={yy} stroke="var(--border)" strokeWidth={1} />
              <text x={padL - 8} y={yy + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">
                {formatPrice(Math.round(niceMax * t), currency)}
              </text>
            </g>
          );
        })}

        {/* Reminder markers (drawn behind bars) */}
        {reminderMarks.map((r) => {
          const cx = padL + r.idx * slot + slot / 2;
          return (
            <g key={r.id}>
              <line
                x1={cx}
                y1={padT}
                x2={cx}
                y2={padT + chartH}
                stroke="#c026d3"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
              <polygon
                points={`${cx - 5},${padT} ${cx + 5},${padT} ${cx},${padT + 8}`}
                fill="#c026d3"
              />
              <title>{`Reminder ${formatDateShort(r.sent_at)}${r.note ? ` – ${r.note}` : ''}`}</title>
            </g>
          );
        })}

        {/* Bars */}
        {daily.map((d, i) => {
          const h = d.revenue_cents > 0 ? padT + chartH - y(d.revenue_cents) : 0;
          return (
            <g key={d.date}>
              {h > 0 && (
                <rect x={x(i)} y={y(d.revenue_cents)} width={barW} height={h} rx={2} fill="var(--primary)">
                  <title>{`${formatDateShort(d.date)}: ${formatPrice(d.revenue_cents, currency)}`}</title>
                </rect>
              )}
            </g>
          );
        })}

        {/* X labels */}
        {daily.map((d, i) =>
          i % labelEvery === 0 || i === n - 1 ? (
            <text
              key={`l-${d.date}`}
              x={padL + i * slot + slot / 2}
              y={H - 12}
              textAnchor="middle"
              fontSize={10}
              fill="var(--text-muted)"
            >
              {shortDay(d.date)}
            </text>
          ) : null,
        )}

        {/* Axis baseline */}
        <line
          x1={padL}
          y1={padT + chartH}
          x2={W - padR}
          y2={padT + chartH}
          stroke="var(--text-soft)"
          strokeWidth={1}
        />
      </svg>
      {reminderMarks.length > 0 && (
        <p className="muted" style={{ fontSize: '0.78rem', marginTop: 4 }}>
          <span style={{ color: '#c026d3' }}>▮</span> = verschickter Reminder
        </p>
      )}
    </div>
  );
}

function shortDay(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit' });
}

/** Rounds a cents value up to a tidy axis maximum. */
function niceCeil(cents: number): number {
  const francs = cents / 100;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(1, francs))));
  const steps = [1, 2, 2.5, 5, 10];
  for (const s of steps) {
    const candidate = s * pow;
    if (candidate >= francs) return Math.round(candidate * 100);
  }
  return Math.round(10 * pow * 100);
}
