import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { Alert, Modal, SendToSelfCheckbox } from '../../components/common';
import { formatPrice, formatDateShort } from '../../lib/format';

export interface Buyer {
  email_id: string;
  email: string;
  name: string;
  verified: boolean;
  order_count: number;
  revenue_cents: number;
}
export interface ReminderRow {
  id: string;
  sent_at: string;
  note: string;
}
export interface DailyPoint {
  date: string;
  revenue_cents: number;
}
export interface EventAnalytics {
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

/**
 * Read-only evaluation panel for a single finished Auftrag: revenue, who bought
 * how much, the daily revenue chart with reminder markers and the reminder
 * tooling. Used inside the Auftrag detail view (the former "Auswertung").
 */
export function EventAnalyticsPanel({
  ev,
  currency,
  onReload,
}: {
  ev: EventAnalytics;
  currency: string;
  onReload: () => void;
}) {
  return (
    <div>
      <div className="analytics-summary">
        <SummaryStat label="Umsatz" value={formatPrice(ev.revenue_cents, currency)} />
        <SummaryStat label="Bestellungen" value={String(ev.order_count)} />
        <SummaryStat
          label="Verifizierte E-Mails"
          value={`${ev.email_verified} von ${ev.email_total}`}
        />
        <SummaryStat label="Erinnerungen" value={String(ev.reminders.length)} />
        <OrderableUntilStat status={ev.status} expiresAt={ev.expires_at} />
      </div>

      <h3 style={{ marginTop: 20, marginBottom: 8 }}>Umsatzverlauf</h3>
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

/**
 * Zeigt, bis wann der Auftrag aktiv ist – also wie lange Eltern noch bestellen
 * können. Archivierte oder abgelaufene Aufträge werden klar als nicht mehr
 * bestellbar gekennzeichnet.
 */
function OrderableUntilStat({
  status,
  expiresAt,
}: {
  status: string;
  expiresAt: string | null;
}) {
  let value = '—';
  let hint = 'Kein Enddatum';

  if (status === 'archived') {
    value = expiresAt ? formatDateShort(expiresAt) : 'Archiviert';
    hint = 'Archiviert – nicht mehr bestellbar';
  } else if (expiresAt) {
    const end = new Date(expiresAt);
    value = formatDateShort(expiresAt);
    if (!isNaN(end.getTime())) {
      const days = Math.ceil((end.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
      if (days < 0) hint = 'Abgelaufen – nicht mehr bestellbar';
      else if (days === 0) hint = 'Läuft heute ab';
      else hint = `Noch ${days} ${days === 1 ? 'Tag' : 'Tage'} bestellbar`;
    }
  }

  return (
    <div className="analytics-stat">
      <span className="analytics-stat-num">{value}</span>
      <span className="analytics-stat-lbl">Bestellbar bis</span>
      <span className="analytics-stat-lbl" style={{ marginTop: 0 }}>
        {hint}
      </span>
    </div>
  );
}

function ReminderManager({ event, onReload }: { event: EventAnalytics; onReload: () => void }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showEmail, setShowEmail] = useState(false);
  const [msg, setMsg] = useState('');

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
      setError(err instanceof ApiError ? err.message : 'Erinnerung konnte nicht gespeichert werden.');
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
      <strong>Erinnerung protokollieren</strong>
      <p className="muted" style={{ fontSize: '0.82rem', marginTop: 4 }}>
        Trage ein, wann du eine Einladung oder Erinnerung verschickt hast. Die Markierung erscheint
        im Umsatzverlauf, damit du den Effekt ablesen kannst. Mit „Erinnerung versenden“
        erinnerst du gezielt Eltern, die noch keine Bestellung erfasst haben.
      </p>
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}
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
          + Protokollieren
        </button>
        <button
          className="btn secondary small"
          type="button"
          onClick={() => {
            setMsg('');
            setShowEmail(true);
          }}
        >
          Erinnerung versenden
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
      {showEmail && (
        <ReminderEmailModal
          eventId={event.id}
          onClose={() => setShowEmail(false)}
          onSent={(message) => {
            setShowEmail(false);
            setMsg(message);
            setError('');
            onReload();
          }}
        />
      )}
    </div>
  );
}

interface ReminderEmail {
  id: string;
  email: string;
  name: string;
  status: string;
  verified: boolean;
  hasOrdered: boolean;
}
interface ReminderChild {
  id: string;
  name: string;
  emails: ReminderEmail[];
}
interface ReminderRecipients {
  children: ReminderChild[];
  otherEmails: ReminderEmail[];
  adminEmail: string;
  devLogOnly: boolean;
  retentionDays: number;
  daysLeft: number | null;
}

/**
 * Reminder-Popup: pro Kind aufgeschlüsselt, welche E-Mail-Adressen bereits
 * bestätigt wurden und welche schon bestellt haben. Standardmässig sind nur die
 * Adressen ausgewählt, die noch keine Bestellung erfasst haben. Optional kann
 * eine Kopie an das eigene Admin-Konto gehen.
 */
function ReminderEmailModal({
  eventId,
  onClose,
  onSent,
}: {
  eventId: string;
  onClose: () => void;
  onSent: (msg: string) => void;
}) {
  const [data, setData] = useState<ReminderRecipients | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendToSelf, setSendToSelf] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const allEmails = useMemo(() => {
    if (!data) return [] as ReminderEmail[];
    const byId = new Map<string, ReminderEmail>();
    for (const c of data.children) for (const e of c.emails) byId.set(e.id, e);
    for (const e of data.otherEmails) byId.set(e.id, e);
    return Array.from(byId.values());
  }, [data]);

  useEffect(() => {
    api<ReminderRecipients>(`/api/admin/events/${eventId}/reminder-recipients`, { admin: true })
      .then((r) => {
        setData(r);
        const ids = new Set<string>();
        for (const c of r.children) for (const e of c.emails) if (!e.hasOrdered) ids.add(e.id);
        for (const e of r.otherEmails) if (!e.hasOrdered) ids.add(e.id);
        setSelected(ids);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Empfänger konnten nicht ermittelt werden.'),
      )
      .finally(() => setLoading(false));
  }, [eventId]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allChecked = allEmails.length > 0 && selected.size === allEmails.length;
  const toggleAll = () =>
    setSelected(allChecked ? new Set() : new Set(allEmails.map((e) => e.id)));

  const send = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api<{ sent: number; failed: number; total: number; sentToSelf: boolean; devLogOnly: boolean }>(
        `/api/admin/events/${eventId}/send-reminder`,
        {
          method: 'POST',
          admin: true,
          body: { emailIds: Array.from(selected), sendToSelf },
        },
      );
      const extra = res.failed > 0 ? ` ${res.failed} konnten nicht zugestellt werden.` : '';
      const self = res.sentToSelf ? ' Eine Kopie wurde an dich gesendet.' : '';
      const note = res.devLogOnly
        ? ' Hinweis: Kein SMTP konfiguriert – die E-Mails wurden nur ins Server-Log geschrieben.'
        : '';
      onSent(`Erinnerung an ${res.sent} von ${res.total} Adresse(n) gesendet.${extra}${self}${note}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Versand fehlgeschlagen.');
      setBusy(false);
    }
  };

  const canSend = !loading && !busy && (selected.size > 0 || sendToSelf);
  const hasAny = allEmails.length > 0;

  return (
    <Modal
      title="Erinnerung versenden"
      width={760}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button type="button" className="btn" onClick={send} disabled={!canSend}>
            {busy ? 'Wird gesendet …' : 'Jetzt senden'}
          </button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      <p style={{ fontSize: '0.92rem', lineHeight: 1.6, marginTop: 0 }}>
        Die Erinnerung ist ähnlich wie die ursprüngliche Einladung (Link zur App, Hinweise zu den
        Fotos
        {data?.daysLeft != null ? ` – „noch ${data.daysLeft} Tage verfügbar“` : ''}). Jede Zeile ist
        ein Kind. Standardmässig sind nur Adressen ausgewählt, die noch{' '}
        <strong>keine Bestellung</strong> erfasst haben.
      </p>
      {loading ? (
        <p className="muted">Empfänger werden ermittelt …</p>
      ) : !hasAny ? (
        <Alert kind="error">Diesem Auftrag sind noch keine (aktiven) E-Mail-Adressen zugeordnet.</Alert>
      ) : data ? (
        <>
          <div className="row between" style={{ marginBottom: 6 }}>
            <strong style={{ fontSize: '0.85rem' }}>
              {selected.size} von {allEmails.length} ausgewählt
            </strong>
            <button type="button" className="btn ghost small" onClick={toggleAll}>
              {allChecked ? 'Alle abwählen' : 'Alle auswählen'}
            </button>
          </div>
          <div
            style={{
              maxHeight: 320,
              overflowY: 'auto',
              border: '1px solid var(--border)',
              borderRadius: 10,
            }}
          >
            {data.children.map((c) => (
              <ReminderChildGroup
                key={c.id}
                title={c.name}
                emails={c.emails}
                selected={selected}
                onToggle={toggle}
              />
            ))}
            {data.otherEmails.length > 0 && (
              <ReminderChildGroup
                title="Ohne Kind zugeordnet"
                emails={data.otherEmails}
                selected={selected}
                onToggle={toggle}
              />
            )}
          </div>
          <SendToSelfCheckbox
            checked={sendToSelf}
            onChange={setSendToSelf}
            adminEmail={data.adminEmail}
          />
          {data.devLogOnly && (
            <p className="muted" style={{ fontSize: '0.8rem', marginTop: 8, marginBottom: 0 }}>
              Achtung: Kein SMTP konfiguriert – die E-Mails landen nur im Server-Log.
            </p>
          )}
        </>
      ) : null}
    </Modal>
  );
}

function ReminderChildGroup({
  title,
  emails,
  selected,
  onToggle,
}: {
  title: string;
  emails: ReminderEmail[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div>
      <div
        style={{
          padding: '6px 10px',
          background: 'var(--surface-2)',
          borderBottom: '1px solid var(--border)',
          fontSize: '0.82rem',
          fontWeight: 600,
          position: 'sticky',
          top: 0,
        }}
      >
        {title}
      </div>
      {emails.length === 0 ? (
        <p className="muted" style={{ fontSize: '0.8rem', padding: '6px 10px', margin: 0 }}>
          Keine E-Mail-Adresse verknüpft.
        </p>
      ) : (
        emails.map((e) => (
          <label
            key={e.id}
            className="row"
            style={{
              flexWrap: 'nowrap',
              alignItems: 'center',
              gap: 8,
              padding: '7px 10px',
              borderBottom: '1px solid var(--border)',
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={selected.has(e.id)}
              onChange={() => onToggle(e.id)}
              style={{ marginRight: 4, flex: 'none' }}
            />
            <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-all' }}>{e.email}</span>
            {e.verified ? (
              <span className="badge green" style={{ flexShrink: 0 }}>Bestätigt</span>
            ) : (
              <span className="badge amber" style={{ flexShrink: 0 }}>Nicht bestätigt</span>
            )}
            {e.hasOrdered ? (
              <span className="badge green" style={{ flexShrink: 0 }}>Bestellt</span>
            ) : (
              <span className="badge gray" style={{ flexShrink: 0 }}>Keine Bestellung</span>
            )}
          </label>
        ))
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
              <title>{`Erinnerung ${formatDateShort(r.sent_at)}${r.note ? ` – ${r.note}` : ''}`}</title>
            </g>
          );
        })}

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
          <span style={{ color: '#c026d3' }}>▮</span> = protokollierte Erinnerung
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
