import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { Alert, Modal } from '../../components/common';
import { ConsentDispatchModal } from '../../components/consentDispatch';
import { formatPrice, formatDateShort } from '../../lib/format';
import {
  DISPATCH_META,
  DispatchTimeline,
  InvitationSection,
  type DispatchEntry,
  type DispatchKind,
} from './invitations';

export interface Buyer {
  email_id: string;
  email: string;
  name: string;
  verified: boolean;
  order_count: number;
  revenue_cents: number;
}
export type ReminderRow = DispatchEntry;
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
  invited_at: string | null;
  /** Automatische Erinnerung an Eltern ohne Bestellung, X Tage vor der Bestellfrist. */
  auto_order_reminder?: boolean;
  auto_order_reminder_days?: number;
  auto_order_reminder_sent_at?: string | null;
  /** Einverständnis (Klassenerfassung oder nachträglich eingeholt), sonst null. */
  registration?: {
    consent_required: boolean;
    consent_only?: boolean;
    open: boolean;
  } | null;
  consent_summary?: { children: number; answered: number; none: number } | null;
  revenue_cents: number;
  order_count: number;
  email_total: number;
  email_verified: number;
  buyers: Buyer[];
  daily: DailyPoint[];
  reminders: ReminderRow[];
}

/**
 * Inhalt eines aufgeklappten Auftrags (bzw. der Detailseite): zuerst
 * „Einladungen & Erinnerungen“ mit Verlauf, automatischer Erinnerung und der
 * Elternliste, danach der Umsatzverlauf und – eingeklappt, weil selten
 * gebraucht – die Einverständniserklärung.
 */
export function EventAnalyticsPanel({
  ev,
  currency,
  onReload,
  showSummary = true,
}: {
  ev: EventAnalytics;
  currency: string;
  onReload: () => void;
  // Die Aufträge-Übersicht zeigt ihre eigenen Kennzahl-Kacheln (mit Kindern und
  // Einverständnissen); die eigenständige Detailseite nutzt diese hier.
  showSummary?: boolean;
}) {
  return (
    <div>
      {showSummary && (
        <div className="analytics-summary" style={{ marginTop: 0, marginBottom: 18 }}>
          <SummaryStat label="Umsatz" value={formatPrice(ev.revenue_cents, currency)} />
          <SummaryStat label="Bestellungen" value={String(ev.order_count)} />
          <SummaryStat
            label="Verifizierte E-Mails"
            value={`${ev.email_verified} von ${ev.email_total}`}
          />
          <OrderableUntilStat
            eventId={ev.id}
            status={ev.status}
            expiresAt={ev.expires_at}
            onReload={onReload}
          />
        </div>
      )}

      <InvitationSection event={ev} currency={currency} onChanged={onReload} />

      <h3 style={{ marginTop: 24, marginBottom: 8 }}>Umsatzverlauf</h3>
      <RevenueChart daily={ev.daily} reminders={ev.reminders} currency={currency} />

      <ConsentSection ev={ev} onReload={onReload} />
    </div>
  );
}

/**
 * Einverständniserklärung – eingeklappt, weil sie nur selten gebraucht wird.
 * Zeigt den Stand, den Versand-Verlauf und die Knöpfe zum Ansehen bzw. Einholen.
 */
function ConsentSection({ ev, onReload }: { ev: EventAnalytics; onReload: () => void }) {
  const [showDispatch, setShowDispatch] = useState(false);
  const [msg, setMsg] = useState('');
  const reg = ev.registration ?? null;
  // Nachträglich einholen geht auch ohne Klassenerfassung (z. B. Excel-Import);
  // in der laufenden Erfassung macht das die Erfassungsansicht, im Archiv ist es zu spät.
  const canSend = ev.status !== 'collecting' && ev.status !== 'archived';
  if (!reg && !canSend) return null;

  const sum = ev.consent_summary;
  const status =
    reg && reg.consent_required && sum
      ? `${sum.answered} von ${sum.children} beantwortet${sum.none ? ` · ${sum.none}× Nein` : ''}`
      : 'nicht eingeholt';

  return (
    <details className="consent-details">
      <summary>
        <span>Einverständniserklärung</span>
        <span className="muted">{status}</span>
      </summary>
      <div className="consent-details-body">
        {msg && <Alert kind="success">{msg}</Alert>}
        <DispatchTimeline
          entries={ev.reminders}
          kinds={['consent', 'consent_reminder']}
          emptyText="Noch keine Einverständniserklärung versendet."
        />
        <div className="row" style={{ marginTop: 10 }}>
          {reg && (
            <Link className="btn secondary small" to={`/admin/events/${ev.id}/erfassung`}>
              {reg.consent_only ? 'Antworten ansehen' : 'Klassenliste & Einverständnisse'}
            </Link>
          )}
          {canSend && (
            <button
              type="button"
              className="btn secondary small"
              onClick={() => {
                setMsg('');
                setShowDispatch(true);
              }}
              title="Die Eltern auffordern, die Einverständniserklärung auszufüllen"
            >
              Einverständniserklärung versenden
            </button>
          )}
        </div>
      </div>
      {showDispatch && (
        <ConsentDispatchModal
          eventId={ev.id}
          onClose={() => setShowDispatch(false)}
          onSent={(message) => {
            setShowDispatch(false);
            setMsg(message);
            onReload();
          }}
        />
      )}
    </details>
  );
}

export function SummaryStat({ label, value }: { label: string; value: string }) {
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
export function OrderableUntilStat({
  eventId,
  status,
  expiresAt,
  onReload,
}: {
  eventId: string;
  status: string;
  expiresAt: string | null;
  onReload: () => void;
}) {
  const [editing, setEditing] = useState(false);

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
      <div className="row between" style={{ gap: 6, alignItems: 'flex-start' }}>
        <span className="analytics-stat-num">{value}</span>
        <button
          type="button"
          className="stat-edit-btn"
          onClick={(e) => {
            // Verhindert, dass der Klick die eingeklappte Auftragszeile toggelt.
            e.stopPropagation();
            setEditing(true);
          }}
          title="Bestellzeitraum manuell anpassen"
          aria-label="Bestellzeitraum manuell anpassen"
        >
          ✎
        </button>
      </div>
      <span className="analytics-stat-lbl">Bestellbar bis</span>
      <span className="analytics-stat-lbl" style={{ marginTop: 0 }}>
        {hint}
      </span>
      {editing && (
        <OrderableUntilEditor
          eventId={eventId}
          expiresAt={expiresAt}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onReload();
          }}
        />
      )}
    </div>
  );
}

/**
 * Kleiner Dialog, um das Enddatum ("Bestellbar bis") eines Auftrags manuell zu
 * setzen – z. B. um einen einmal veröffentlichten Bestellzeitraum gezielt zu
 * verlängern, ohne dass sich das Fenster beim erneuten Veröffentlichen ändert.
 */
function OrderableUntilEditor({
  eventId,
  expiresAt,
  onClose,
  onSaved,
}: {
  eventId: string;
  expiresAt: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toDateInput = (iso: string | null) => {
    const d = iso ? new Date(iso) : new Date();
    if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
    return d.toISOString().slice(0, 10);
  };
  const [date, setDate] = useState(() => toDateInput(expiresAt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      // Auf das Tagesende setzen, damit der gewählte Tag noch vollständig
      // bestellbar bleibt.
      const end = new Date(`${date}T23:59:59`);
      await api(`/api/admin/events/${eventId}`, {
        method: 'PATCH',
        admin: true,
        body: { expires_at: end.toISOString() },
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Datum konnte nicht gespeichert werden.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Bestellzeitraum anpassen"
      width={420}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button type="button" className="btn" onClick={save} disabled={busy}>
            {busy ? 'Wird gespeichert …' : 'Speichern'}
          </button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      <p style={{ fontSize: '0.9rem', lineHeight: 1.6, marginTop: 0 }}>
        Lege fest, bis zu welchem Tag Eltern in diesem Auftrag bestellen können. Der Zeitraum
        bleibt unverändert, wenn der Auftrag erneut veröffentlicht wird.
      </p>
      <div className="field" style={{ marginBottom: 0 }}>
        <label style={{ fontSize: '0.8rem' }}>Bestellbar bis</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
    </Modal>
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
          const kind = r.kind ?? 'manual';
          const color = MARK_COLORS[kind];
          return (
            <g key={r.id}>
              <line
                x1={cx}
                y1={padT}
                x2={cx}
                y2={padT + chartH}
                stroke={color}
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
              <polygon
                points={`${cx - 5},${padT} ${cx + 5},${padT} ${cx},${padT + 8}`}
                fill={color}
              />
              <title>{`${DISPATCH_META[kind].label} ${formatDateShort(r.sent_at)}${
                r.count != null ? ` – an ${r.count} E-Mail-Adresse(n)` : r.note ? ` – ${r.note}` : ''
              }`}</title>
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
        <p className="muted chart-legend">
          {LEGEND.filter((l) => reminderMarks.some((m) => l.kinds.includes(m.kind ?? 'manual'))).map((l) => (
            <span key={l.label}>
              <span style={{ color: MARK_COLORS[l.kinds[0]] }}>▮</span> {l.label}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

// Farben der Markierungen in der Umsatzgrafik je Versandart.
const MARK_COLORS: Record<DispatchKind, string> = {
  invitation: '#1b7a52',
  reminder: '#c026d3',
  auto_reminder: '#c026d3',
  consent: '#c98a00',
  consent_reminder: '#c98a00',
  manual: '#7b8794',
};
const LEGEND: { label: string; kinds: DispatchKind[] }[] = [
  { label: 'Einladung', kinds: ['invitation'] },
  { label: 'Erinnerung', kinds: ['reminder', 'auto_reminder'] },
  { label: 'Einverständnis', kinds: ['consent', 'consent_reminder'] },
  { label: 'Protokolliert', kinds: ['manual'] },
];

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
