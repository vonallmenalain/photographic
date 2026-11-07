import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import {
  Alert,
  DeliveryProblemBadge,
  Modal,
  SendToSelfCheckbox,
  type DeliveryProblemInfo,
} from '../../components/common';
import { EmailPreviewModal, type PreviewType } from '../../components/emailPreview';
import { formatDate, formatDateShort, formatPrice } from '../../lib/format';

// ---------------------------------------------------------------------------
// Einladungen & Erinnerungen an die Eltern eines Auftrags.
//
// Eine Erinnerung ist nichts anderes als eine zweite Einladung – deshalb gibt
// es nur noch EINEN Versand: Wer noch nie eingeladen wurde, erhält die
// Einladung („Ihre Fotos sind bereit“), alle anderen die Erinnerung („Ihre
// Fotos sind noch X Tage verfügbar“). Genutzt im Assistenten (Schritt 5, als
// normales Fenster) und in der Aufträge-Übersicht (als Popup), dazu der
// Versand-Verlauf, die automatische Erinnerung und die Elternliste.
// ---------------------------------------------------------------------------

export interface Recipient {
  id: string;
  email: string;
  name: string;
  status: string;
  verified: boolean;
  hasOrdered: boolean;
  firstInvitedAt: string | null;
  invitedAt: string | null;
  remindedAt: string | null;
  reminderCount: number;
  /** Letzte bekannte Anmeldung (Sitzung oder Bestätigung der Adresse). */
  lastSeenAt: string | null;
  deliveryProblem?: DeliveryProblemInfo | null;
}

interface RecipientsResponse {
  children: { id: string; name: string; emails: Recipient[] }[];
  otherEmails: Recipient[];
  adminEmail: string;
  devLogOnly: boolean;
  daysLeft: number | null;
  eventStatus: string;
  expiresAt: string | null;
}

/** Eine Zeile pro E-Mail-Adresse, mit allen Kindern dieses Auftrags. */
export interface ParentRow extends Recipient {
  childNames: string[];
  /** Nur für Käufer, die nicht (mehr) mit dem Auftrag verknüpft sind. */
  orderCount?: number;
  revenueCents?: number;
}

function flatten(data: RecipientsResponse | null): ParentRow[] {
  if (!data) return [];
  const byId = new Map<string, ParentRow>();
  for (const c of data.children) {
    for (const e of c.emails) {
      const row = byId.get(e.id) ?? { ...e, childNames: [] };
      row.childNames.push(c.name);
      byId.set(e.id, row);
    }
  }
  for (const e of data.otherEmails) if (!byId.has(e.id)) byId.set(e.id, { ...e, childNames: [] });
  return Array.from(byId.values()).sort((a, b) => a.email.localeCompare(b.email));
}

/** Wurde diese Adresse in diesem Auftrag schon eingeladen oder erinnert? */
export function wasContacted(r: Recipient): boolean {
  return !!(r.invitedAt || r.remindedAt);
}

/**
 * Stand einer Familie:
 *  - ordered:  hat bestellt
 *  - active:   hat sich (seit der Einladung) angemeldet, aber nichts bestellt
 *  - stale:    war früher angemeldet, seit der Einladung aber nicht mehr
 *  - never:    hat sich noch nie angemeldet
 */
export type ParentState = 'ordered' | 'active' | 'stale' | 'never';

export function parentState(r: Recipient): ParentState {
  if (r.hasOrdered) return 'ordered';
  if (!r.lastSeenAt) return 'never';
  const contacted = r.firstInvitedAt ?? r.invitedAt ?? r.remindedAt;
  if (contacted && r.lastSeenAt < contacted) return 'stale';
  return 'active';
}

function useRecipients(eventId: string) {
  const [data, setData] = useState<RecipientsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    try {
      const r = await api<RecipientsResponse>(`/api/admin/events/${eventId}/reminder-recipients`, {
        admin: true,
      });
      setData(r);
      setError('');
      return r;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Empfänger konnten nicht ermittelt werden.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  const rows = useMemo(() => flatten(data), [data]);
  return { data, rows, loading, error, reload };
}

/** Wochentag + Datum, z. B. „Mo., 23.11.2026“. */
export function formatDay(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString('de-CH', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

// --- kleine Anzeige-Bausteine ------------------------------------------------

export function LoginCell({ r }: { r: Recipient }) {
  const state = parentState(r);
  const last = r.lastSeenAt ? `zuletzt ${formatDateShort(r.lastSeenAt)}` : '';
  if (state === 'never') return <span className="badge gray">Noch nie angemeldet</span>;
  if (state === 'stale')
    return (
      <span
        className="badge amber"
        title={`Seit der Einladung nicht mehr angemeldet (${last})`}
      >
        Seit Einladung nicht angemeldet
      </span>
    );
  return (
    <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
      <span className="badge green">Angemeldet</span>
      {last && <span className="muted cell-note">{last}</span>}
    </span>
  );
}

function DateCell({ at, count }: { at: string | null; count?: number }) {
  if (!at) return <span className="muted">—</span>;
  return (
    <span title={formatDate(at)}>
      {formatDateShort(at)}
      {count && count > 1 ? <span className="muted cell-note"> ({count}×)</span> : null}
    </span>
  );
}

// --- Versand (Einladung + Erinnerung in einem) --------------------------------

type Mode = 'auto' | 'invitation' | 'reminder';

const MODE_OPTIONS: { value: Mode; title: string; hint: string }[] = [
  {
    value: 'auto',
    title: 'Automatisch (empfohlen)',
    hint: 'Einladung beim ersten Mal, danach Erinnerung',
  },
  { value: 'invitation', title: 'Allen die Einladung', hint: '„Ihre Fotos sind bereit“' },
  { value: 'reminder', title: 'Allen die Erinnerung', hint: '„Ihre Fotos sind noch verfügbar“' },
];
type QuickFilter = 'all' | 'open' | 'not_contacted' | 'not_logged_in' | 'none';

interface SendResult {
  invited: number;
  reminded: number;
  sent: number;
  failed: number;
  failedEmails?: string[];
  total: number;
  sentToSelf: boolean;
  devLogOnly: boolean;
}

function resultMessage(res: SendResult): string {
  const parts: string[] = [];
  if (res.invited > 0) parts.push(`Einladung an ${res.invited}`);
  if (res.reminded > 0) parts.push(`Erinnerung an ${res.reminded}`);
  const main = parts.length
    ? `${parts.join(' und ')} E-Mail-Adresse(n) gesendet.`
    : 'Es wurde keine E-Mail an Eltern gesendet.';
  const extra =
    res.failed > 0
      ? ` ${res.failed} konnten nicht gesendet werden${
          res.failedEmails?.length ? ` (${res.failedEmails.join(', ')})` : ''
        } – Details unter „Meldungen“.`
      : '';
  const self = res.sentToSelf ? ' Eine Kopie wurde an dich gesendet.' : '';
  const note = res.devLogOnly
    ? ' Hinweis: Kein SMTP konfiguriert – die E-Mails wurden nur ins Server-Log geschrieben.'
    : '';
  return `${main}${extra}${self}${note}`;
}

/**
 * Versand von Einladung und Erinnerung. `variant="inline"` zeigt alles als
 * normales Fenster (Assistent, Schritt 5), `variant="modal"` als Popup.
 */
export function InvitationDispatch({
  eventId,
  variant,
  initialSelection,
  onSent,
  onClose,
}: {
  eventId: string;
  variant: 'inline' | 'modal';
  /** Vorauswahl, z. B. „alle, die noch nie angemeldet waren“ aus der Elternliste. */
  initialSelection?: string[];
  onSent?: (msg: string) => void;
  /** Nur Popup: schliessen. */
  onClose?: () => void;
}) {
  const { data, rows, loading, error: loadError, reload } = useRecipients(eventId);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);
  const [mode, setMode] = useState<Mode>('auto');
  const [mentionExtension, setMentionExtension] = useState(false);
  const [sendToSelf, setSendToSelf] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [preview, setPreview] = useState<PreviewType[] | null>(null);

  const anyContacted = rows.some(wasContacted);

  const idsFor = useCallback(
    (f: QuickFilter): string[] => {
      switch (f) {
        case 'all':
          return rows.map((r) => r.id);
        case 'open':
          return rows.filter((r) => !r.hasOrdered).map((r) => r.id);
        case 'not_contacted':
          return rows.filter((r) => !wasContacted(r)).map((r) => r.id);
        case 'not_logged_in':
          return rows
            .filter((r) => {
              const s = parentState(r);
              return s === 'never' || s === 'stale';
            })
            .map((r) => r.id);
        default:
          return [];
      }
    },
    [rows],
  );

  // Vorauswahl beim ersten Laden: vorgegebene Auswahl, sonst – solange noch
  // niemand eingeladen ist – alle, danach alle ohne Bestellung.
  useEffect(() => {
    if (!data || initialized) return;
    const known = new Set(rows.map((r) => r.id));
    if (initialSelection) setSelected(new Set(initialSelection.filter((id) => known.has(id))));
    else setSelected(new Set(idsFor(anyContacted ? 'open' : 'all')));
    setInitialized(true);
  }, [data, rows, initialized, initialSelection, idsFor, anyContacted]);

  const kindOf = (r: Recipient): 'invitation' | 'reminder' =>
    mode === 'auto' ? (wasContacted(r) ? 'reminder' : 'invitation') : mode;

  const selectedRows = rows.filter((r) => selected.has(r.id));
  const nInv = selectedRows.filter((r) => kindOf(r) === 'invitation').length;
  const nRem = selectedRows.length - nInv;
  const published = data?.eventStatus === 'published';

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allChecked = rows.length > 0 && selected.size === rows.length;

  const previewTypes = (): PreviewType[] => {
    const kinds = new Set<PreviewType>();
    if (nInv > 0) kinds.add('invitation');
    if (nRem > 0) kinds.add('reminder');
    if (kinds.size === 0) {
      if (mode === 'reminder') kinds.add('reminder');
      else {
        kinds.add('invitation');
        if (mode === 'auto' && anyContacted) kinds.add('reminder');
      }
    }
    return Array.from(kinds);
  };

  const send = async () => {
    setBusy(true);
    setError('');
    setMsg('');
    try {
      const res = await api<SendResult>(`/api/admin/events/${eventId}/send-invitations`, {
        method: 'POST',
        admin: true,
        body: {
          emailIds: Array.from(selected),
          sendToSelf,
          mentionExtension: nRem > 0 && mentionExtension,
          kind: mode,
        },
      });
      const message = resultMessage(res);
      if (variant === 'inline') {
        // Nach dem Versand nichts mehr vorausgewählt lassen – ein zweiter Klick
        // soll nicht versehentlich gleich die nächste Runde verschicken.
        setSelected(new Set());
        setMsg(message);
        await reload();
        setBusy(false);
      }
      onSent?.(message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Versand fehlgeschlagen.');
      setBusy(false);
    }
  };

  const canSend = !loading && !busy && published && (selected.size > 0 || sendToSelf);

  const quick: { key: QuickFilter; label: string }[] = [
    { key: 'all', label: 'Alle' },
    { key: 'open', label: 'Ohne Bestellung' },
    { key: 'not_contacted', label: 'Noch nicht eingeladen' },
    { key: 'not_logged_in', label: 'Nicht angemeldet' },
  ];

  const summary =
    selected.size === 0
      ? 'Keine E-Mail-Adresse ausgewählt.'
      : [
          nInv > 0 ? `${nInv} ${nInv === 1 ? 'Einladung' : 'Einladungen'}` : '',
          nRem > 0 ? `${nRem} ${nRem === 1 ? 'Erinnerung' : 'Erinnerungen'}` : '',
        ]
          .filter(Boolean)
          .join(' und ') + (selected.size === 1 ? ' wird versendet.' : ' werden versendet.');

  const body: ReactNode = (
    <>
      {loadError && <Alert kind="error">{loadError}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}
      <p style={{ fontSize: '0.92rem', lineHeight: 1.6, marginTop: 0 }}>
        Wer noch keine Einladung erhalten hat, bekommt die <strong>Einladung</strong> („Ihre Fotos
        sind bereit“). Wer schon eingeladen wurde, bekommt eine <strong>Erinnerung</strong> („Ihre
        Fotos sind noch {data?.daysLeft != null ? `${data.daysLeft} Tage` : 'einige Tage'} verfügbar“).
        Beide enthalten den Link zur App und die Hinweise zu den Fotos.
      </p>
      {data && !published && (
        <Alert kind="info">
          Der Auftrag ist noch nicht veröffentlicht – Einladungen lassen sich erst danach versenden,
          sonst sehen die Eltern nach dem Klick noch keine Fotos.
        </Alert>
      )}
      {loading && !data ? (
        <p className="muted">Empfänger werden ermittelt …</p>
      ) : rows.length === 0 ? (
        <Alert kind="error">Diesem Auftrag sind noch keine (aktiven) E-Mail-Adressen zugeordnet.</Alert>
      ) : (
        <>
          <div className="quick-select" aria-label="Schnellauswahl">
            <span className="muted">Auswählen:</span>
            {quick.map((q) => {
              const ids = idsFor(q.key);
              return (
                <button
                  key={q.key}
                  type="button"
                  className="btn ghost small"
                  disabled={ids.length === 0}
                  onClick={() => setSelected(new Set(ids))}
                >
                  {q.label} ({ids.length})
                </button>
              );
            })}
            <button type="button" className="btn ghost small" onClick={() => setSelected(new Set())}>
              Keine
            </button>
          </div>
          <div className="dispatch-scroll">
            <table className="dispatch-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={() => setSelected(allChecked ? new Set() : new Set(idsFor('all')))}
                      aria-label="Alle auswählen"
                      style={{ width: 'auto', margin: 0 }}
                    />
                  </th>
                  <th>E-Mail-Adresse</th>
                  <th>Kind</th>
                  <th>Anmeldung</th>
                  <th>Bestellung</th>
                  <th>Eingeladen</th>
                  <th>Erinnert</th>
                  <th>Erhält</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const on = selected.has(r.id);
                  const k = kindOf(r);
                  return (
                    <tr key={r.id} onClick={() => toggle(r.id)} style={{ cursor: 'pointer' }}>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggle(r.id)}
                          onClick={(ev) => ev.stopPropagation()}
                          aria-label={`${r.email} auswählen`}
                          style={{ width: 'auto', margin: 0 }}
                        />
                      </td>
                      <td className="dispatch-email">
                        <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                          {r.email}
                          <DeliveryProblemBadge problem={r.deliveryProblem} />
                        </span>
                      </td>
                      <td>{r.childNames.join(', ') || <span className="muted">—</span>}</td>
                      <td>
                        <LoginCell r={r} />
                      </td>
                      <td>
                        {r.hasOrdered ? (
                          <span className="badge green">Bestellt</span>
                        ) : (
                          <span className="badge gray">Keine</span>
                        )}
                      </td>
                      <td>
                        <DateCell at={r.invitedAt} />
                      </td>
                      <td>
                        <DateCell at={r.remindedAt} count={r.reminderCount} />
                      </td>
                      <td>
                        {on ? (
                          <span className={`badge ${k === 'invitation' ? 'class' : 'amber'}`}>
                            {k === 'invitation' ? 'Einladung' : 'Erinnerung'}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="dispatch-options">
            {/* Auswahlfelder statt Dropdown: Die Erklärungen sind zu lang für
                ein Auswahlfeld und wurden dort abgeschnitten. */}
            <fieldset className="mode-options">
              <legend>Inhalt der E-Mail</legend>
              {MODE_OPTIONS.map((o) => (
                <label key={o.value} className={`mode-option${mode === o.value ? ' active' : ''}`}>
                  <input
                    type="radio"
                    name={`mode-${eventId}`}
                    value={o.value}
                    checked={mode === o.value}
                    onChange={() => setMode(o.value)}
                  />
                  <span>
                    <strong>{o.title}</strong>
                    <span className="mode-option-hint">{o.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {nRem > 0 && (
              <label className="check-line">
                <input
                  type="checkbox"
                  checked={mentionExtension}
                  onChange={(e) => setMentionExtension(e.target.checked)}
                />
                <span>
                  In der Erinnerung auf den verlängerten Bestellzeitraum hinweisen
                  {mentionExtension && data?.expiresAt && (
                    <span className="muted" style={{ display: 'block', fontSize: '0.8rem' }}>
                      „Sie können noch bis zum {formatDateShort(data.expiresAt)} bestellen.“
                    </span>
                  )}
                </span>
              </label>
            )}
            {data && (
              <SendToSelfCheckbox
                checked={sendToSelf}
                onChange={setSendToSelf}
                adminEmail={data.adminEmail}
              />
            )}
            {data?.devLogOnly && (
              <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>
                Achtung: Kein SMTP konfiguriert – die E-Mails landen nur im Server-Log.
              </p>
            )}
          </div>
          <p className="dispatch-summary">{summary}</p>
        </>
      )}
    </>
  );

  const actions = (
    <>
      <button
        type="button"
        className="btn secondary"
        onClick={() => setPreview(previewTypes())}
        disabled={loading && !data}
        title="So sieht die E-Mail aus, die die Eltern erhalten"
      >
        Vorschau
      </button>
      <button type="button" className="btn" onClick={send} disabled={!canSend}>
        {busy ? 'Wird gesendet …' : selected.size > 0 ? `Jetzt senden (${selected.size})` : 'Jetzt senden'}
      </button>
    </>
  );

  const previewModal = preview && (
    <EmailPreviewModal
      eventId={eventId}
      types={preview}
      mentionExtension={nRem > 0 && mentionExtension}
      onClose={() => setPreview(null)}
    />
  );

  if (variant === 'modal') {
    return (
      <>
        <Modal
          title="Einladung / Erinnerung versenden"
          width={1120}
          onClose={onClose ?? (() => undefined)}
          footer={
            <>
              <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
                Abbrechen
              </button>
              {actions}
            </>
          }
        >
          {body}
        </Modal>
        {previewModal}
      </>
    );
  }

  return (
    <div>
      {body}
      <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
        {actions}
      </div>
      {previewModal}
    </div>
  );
}

// --- Automatische Erinnerung --------------------------------------------------

/**
 * Automatische Erinnerung an alle Eltern des Auftrags, die noch nichts bestellt
 * haben – einmalig, X Tage vor Ablauf der Bestellfrist. Standardmässig aus.
 * Zeigt gleich, wann sie rausgeht bzw. rausging.
 */
export function AutoOrderReminder({
  eventId,
  enabled: enabledProp,
  days: daysProp,
  sentAt,
  expiresAt,
  status,
  onChanged,
}: {
  eventId: string;
  enabled: boolean;
  days: number;
  sentAt: string | null;
  expiresAt: string | null;
  status: string;
  onChanged: () => void;
}) {
  const [enabled, setEnabled] = useState(enabledProp);
  const [days, setDays] = useState(String(daysProp));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setEnabled(enabledProp);
    setDays(String(daysProp));
  }, [enabledProp, daysProp]);

  const save = async (nextEnabled: boolean, nextDays: string) => {
    setBusy(true);
    setError('');
    try {
      await api(`/api/admin/events/${eventId}`, {
        method: 'PATCH',
        admin: true,
        body: {
          auto_order_reminder: nextEnabled,
          auto_order_reminder_days: Math.max(1, Math.min(60, parseInt(nextDays, 10) || 7)),
        },
      });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Einstellung konnte nicht gespeichert werden.');
    } finally {
      setBusy(false);
    }
  };

  const plannedAt = plannedAutoReminder(expiresAt, parseInt(days, 10) || daysProp);
  let state: ReactNode;
  if (!enabled) state = <span className="muted">Aus – es wird keine automatische Erinnerung verschickt.</span>;
  else if (enabledProp && sentAt) state = <span className="ok-text">✓ Verschickt am {formatDay(sentAt)}.</span>;
  else if (!plannedAt) state = <span className="warn-text">Ohne „Bestellbar bis“ wird nichts verschickt.</span>;
  else if (new Date(plannedAt).getTime() <= Date.now())
    state =
      status === 'published' ? (
        <span>Fällig – geht mit dem nächsten Lauf raus (alle paar Stunden).</span>
      ) : (
        <span className="warn-text">Geht nur raus, solange der Auftrag veröffentlicht ist.</span>
      );
  else
    state = (
      <span>
        Geplant für <strong>{formatDay(plannedAt)}</strong>
        {status !== 'published' ? ' – sofern der Auftrag dann veröffentlicht ist.' : '.'}
      </span>
    );

  return (
    <div className="auto-reminder">
      <label className="check-line" style={{ marginTop: 0 }}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={(e) => {
            setEnabled(e.target.checked);
            void save(e.target.checked, days);
          }}
        />
        <strong>Automatisch erinnern</strong>
      </label>
      <p className="auto-reminder-text">
        An alle Eltern <strong>ohne Bestellung</strong>, einmalig{' '}
        <input
          type="number"
          min={1}
          max={60}
          value={days}
          disabled={!enabled || busy}
          onChange={(e) => setDays(e.target.value)}
          onBlur={() => enabled && String(daysProp) !== days && void save(enabled, days)}
          aria-label="Tage vor Ablauf der Bestellfrist"
        />{' '}
        Tage vor Ablauf der Bestellfrist
        {expiresAt ? ` (${formatDateShort(expiresAt)})` : ''}.
      </p>
      <p className="auto-reminder-state">{state}</p>
      {error && <Alert kind="error">{error}</Alert>}
    </div>
  );
}

/** Zeitpunkt der automatischen Erinnerung (Bestellfrist minus X Tage). */
export function plannedAutoReminder(expiresAt: string | null, days: number): string | null {
  if (!expiresAt) return null;
  const end = new Date(expiresAt).getTime();
  if (isNaN(end)) return null;
  return new Date(end - Math.max(1, days) * 24 * 60 * 60 * 1000).toISOString();
}

// --- Versand-Verlauf ---------------------------------------------------------

export type DispatchKind =
  | 'invitation'
  | 'reminder'
  | 'auto_reminder'
  | 'consent'
  | 'consent_reminder'
  | 'manual';

export interface DispatchEntry {
  id: string;
  sent_at: string;
  note: string;
  kind?: DispatchKind;
  count?: number | null;
}

export const DISPATCH_META: Record<DispatchKind, { icon: string; label: string; cls: string }> = {
  invitation: { icon: '✉', label: 'Einladung', cls: 'inv' },
  reminder: { icon: '↻', label: 'Erinnerung', cls: 'rem' },
  auto_reminder: { icon: '⏱', label: 'Automatische Erinnerung', cls: 'rem' },
  consent: { icon: '✍', label: 'Einverständniserklärung', cls: 'con' },
  consent_reminder: { icon: '✍', label: 'Erinnerung Einverständnis', cls: 'con' },
  manual: { icon: '•', label: 'Protokolliert', cls: 'man' },
};

/**
 * Chronologischer Verlauf der versendeten E-Mails. Eine geplante automatische
 * Erinnerung erscheint gestrichelt als nächster Schritt.
 */
export function DispatchTimeline({
  entries,
  kinds,
  planned,
  emptyText,
  onRemove,
}: {
  entries: DispatchEntry[];
  kinds: DispatchKind[];
  planned?: { at: string; label: string } | null;
  emptyText: string;
  /** Nur für früher von Hand protokollierte Einträge. */
  onRemove?: (id: string) => void;
}) {
  const list = entries
    .filter((e) => kinds.includes(e.kind ?? 'manual'))
    .sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at)));
  if (list.length === 0 && !planned) return <p className="muted timeline-empty">{emptyText}</p>;
  return (
    <ol className="dispatch-timeline">
      {list.map((e) => {
        const kind = e.kind ?? 'manual';
        const meta = DISPATCH_META[kind];
        return (
          <li key={e.id} className={`tl-${meta.cls}`}>
            <span className="tl-icon" aria-hidden>
              {meta.icon}
            </span>
            <div className="tl-body">
              <strong>{meta.label}</strong>
              {e.count != null ? (
                <span className="muted"> · an {e.count} E-Mail-Adresse{e.count === 1 ? '' : 'n'}</span>
              ) : kind === 'manual' && e.note ? (
                <span className="muted"> · {e.note}</span>
              ) : null}
              <div className="tl-when">{formatDate(e.sent_at)}</div>
            </div>
            {kind === 'manual' && onRemove && (
              <button
                type="button"
                className="tl-remove"
                onClick={() => onRemove(e.id)}
                title="Eintrag entfernen"
                aria-label="Eintrag entfernen"
              >
                ×
              </button>
            )}
          </li>
        );
      })}
      {planned && (
        <li className="tl-planned">
          <span className="tl-icon" aria-hidden>
            ⏱
          </span>
          <div className="tl-body">
            <strong>{planned.label}</strong>
            <span className="muted"> · geplant</span>
            <div className="tl-when">{formatDay(planned.at)}</div>
          </div>
        </li>
      )}
    </ol>
  );
}

// --- Elternliste ---------------------------------------------------------------

type ParentFilter = 'all' | 'ordered' | 'active' | 'not_logged_in' | 'not_contacted';

export interface BuyerInfo {
  email_id: string;
  email: string;
  name: string;
  verified: boolean;
  order_count: number;
  revenue_cents: number;
}

/**
 * Alle Eltern des Auftrags auf einen Blick: angemeldet oder nicht, eingeladen
 * und erinnert wann, bestellt ja/nein (mit Umsatz). Die Filter oben zeigen die
 * Anzahl je Gruppe; aus einer Gruppe lässt sich direkt eine Erinnerung an genau
 * diese Eltern vorbereiten.
 */
export function ParentOverview({
  rows: recipientRows,
  loading,
  buyers,
  currency,
  canSend,
  onRemind,
}: {
  rows: ParentRow[];
  loading: boolean;
  buyers: BuyerInfo[];
  currency: string;
  canSend: boolean;
  onRemind: (ids: string[]) => void;
}) {
  const [filter, setFilter] = useState<ParentFilter>('all');

  const buyerById = useMemo(() => new Map(buyers.map((b) => [b.email_id, b])), [buyers]);
  // Käufer, die nicht (mehr) mit dem Auftrag verknüpft sind, trotzdem aufführen.
  const rows = useMemo(() => {
    const known = new Set(recipientRows.map((r) => r.id));
    const extra: ParentRow[] = buyers
      .filter((b) => !known.has(b.email_id))
      .map((b) => ({
        id: b.email_id,
        email: b.email,
        name: b.name,
        status: b.verified ? 'verified' : 'pending',
        verified: b.verified,
        hasOrdered: true,
        firstInvitedAt: null,
        invitedAt: null,
        remindedAt: null,
        reminderCount: 0,
        lastSeenAt: null,
        childNames: [],
      }));
    return [...recipientRows, ...extra];
  }, [recipientRows, buyers]);

  const matches = (r: ParentRow, f: ParentFilter) => {
    const s = parentState(r);
    switch (f) {
      case 'ordered':
        return s === 'ordered';
      case 'active':
        return s === 'active';
      case 'not_logged_in':
        return s === 'never' || s === 'stale';
      case 'not_contacted':
        return !wasContacted(r) && !r.hasOrdered;
      default:
        return true;
    }
  };

  const filters: { key: ParentFilter; label: string; tone: string }[] = [
    { key: 'all', label: 'Alle', tone: '' },
    { key: 'ordered', label: 'Bestellt', tone: 'green' },
    { key: 'active', label: 'Angemeldet, nicht bestellt', tone: 'blue' },
    { key: 'not_logged_in', label: 'Nicht angemeldet', tone: 'amber' },
    { key: 'not_contacted', label: 'Noch nicht eingeladen', tone: 'gray' },
  ];
  const visible = rows.filter((r) => matches(r, filter));
  const remindable = visible.filter((r) => recipientRows.some((x) => x.id === r.id)).map((r) => r.id);

  if (loading && rows.length === 0) return <p className="muted">Eltern werden geladen …</p>;
  if (rows.length === 0)
    return <p className="muted">Diesem Auftrag sind noch keine E-Mail-Adressen zugeordnet.</p>;

  return (
    <div>
      <div className="filter-chips" role="tablist" aria-label="Eltern filtern">
        {filters.map((f) => {
          const n = rows.filter((r) => matches(r, f.key)).length;
          if (f.key !== 'all' && n === 0) return null;
          return (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              className={`filter-chip ${f.tone}${filter === f.key ? ' active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label} <span className="filter-chip-count">{n}</span>
            </button>
          );
        })}
        {canSend && filter !== 'all' && filter !== 'ordered' && remindable.length > 0 && (
          <button
            type="button"
            className="btn small"
            style={{ marginLeft: 'auto' }}
            onClick={() => onRemind(remindable)}
          >
            {filter === 'not_contacted' ? 'Diese einladen' : 'Diese erinnern'} ({remindable.length})
          </button>
        )}
      </div>
      <div className="dispatch-scroll" style={{ maxHeight: 420 }}>
        <table className="dispatch-table">
          <thead>
            <tr>
              <th>E-Mail-Adresse</th>
              <th>Kind</th>
              <th>Anmeldung</th>
              <th>Eingeladen</th>
              <th>Erinnert</th>
              <th>Bestellung</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const b = buyerById.get(r.id);
              return (
                <tr key={r.id}>
                  <td className="dispatch-email">
                    <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                      <span>
                        {r.email}
                        {r.name ? <span className="muted cell-note"> · {r.name}</span> : null}
                      </span>
                      <DeliveryProblemBadge problem={r.deliveryProblem} />
                    </span>
                  </td>
                  <td>{r.childNames.join(', ') || <span className="muted">—</span>}</td>
                  <td>
                    <LoginCell r={r} />
                  </td>
                  <td>
                    <DateCell at={r.invitedAt} />
                  </td>
                  <td>
                    <DateCell at={r.remindedAt} count={r.reminderCount} />
                  </td>
                  <td>
                    {r.hasOrdered || b ? (
                      <span className="badge green">
                        {b
                          ? `${b.order_count}× · ${formatPrice(b.revenue_cents, currency)}`
                          : 'Bestellt'}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <Link to={`/admin/emails/${r.id}`}>Verwalten</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Abschnitt „Einladungen & Erinnerungen“ im aufgeklappten Auftrag -------------

export interface InvitationEventInfo {
  id: string;
  status: string;
  expires_at: string | null;
  invited_at: string | null;
  auto_order_reminder?: boolean;
  auto_order_reminder_days?: number;
  auto_order_reminder_sent_at?: string | null;
  reminders: DispatchEntry[];
  buyers: BuyerInfo[];
}

export function InvitationSection({
  event,
  currency,
  onChanged,
}: {
  event: InvitationEventInfo;
  currency: string;
  onChanged: () => void;
}) {
  const { rows, loading, error, reload } = useRecipients(event.id);
  const [dispatch, setDispatch] = useState<{ initial?: string[] } | null>(null);
  const [msg, setMsg] = useState('');
  const published = event.status === 'published';
  const invited = rows.some(wasContacted) || !!event.invited_at;

  const autoDays = Math.max(1, event.auto_order_reminder_days ?? 7);
  const plannedAt =
    event.auto_order_reminder && !event.auto_order_reminder_sent_at
      ? plannedAutoReminder(event.expires_at, autoDays)
      : null;

  const removeEntry = async (id: string) => {
    if (!confirm('Diesen protokollierten Eintrag entfernen?')) return;
    await api(`/api/admin/reminders/${id}`, { method: 'DELETE', admin: true });
    onChanged();
  };

  return (
    <section className="invite-section">
      <div className="section-head">
        <h3>Einladungen &amp; Erinnerungen</h3>
        {published ? (
          <button
            type="button"
            className={`btn small${invited ? ' secondary' : ''}`}
            onClick={() => {
              setMsg('');
              setDispatch({});
            }}
          >
            {invited ? 'Erinnerung versenden' : 'Einladung versenden'}
          </button>
        ) : (
          <span className="muted" style={{ fontSize: '0.82rem' }}>
            Versand erst nach dem Veröffentlichen möglich.
          </span>
        )}
      </div>
      {msg && <Alert kind="success">{msg}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}

      <div className="invite-grid">
        <div>
          <h4 className="sub-head">Verlauf</h4>
          <DispatchTimeline
            entries={event.reminders}
            kinds={['invitation', 'reminder', 'auto_reminder', 'manual']}
            planned={plannedAt ? { at: plannedAt, label: 'Automatische Erinnerung' } : null}
            emptyText="Noch keine Einladung versendet."
            onRemove={removeEntry}
          />
        </div>
        <AutoOrderReminder
          eventId={event.id}
          enabled={event.auto_order_reminder === true}
          days={autoDays}
          sentAt={event.auto_order_reminder_sent_at ?? null}
          expiresAt={event.expires_at}
          status={event.status}
          onChanged={onChanged}
        />
      </div>

      <h4 className="sub-head" style={{ marginTop: 18 }}>
        Eltern
      </h4>
      <ParentOverview
        rows={rows}
        loading={loading}
        buyers={event.buyers}
        currency={currency}
        canSend={published}
        onRemind={(ids) => {
          setMsg('');
          setDispatch({ initial: ids });
        }}
      />

      {dispatch && (
        <InvitationDispatch
          eventId={event.id}
          variant="modal"
          initialSelection={dispatch.initial}
          onClose={() => setDispatch(null)}
          onSent={(message) => {
            setDispatch(null);
            setMsg(message);
            void reload();
            onChanged();
          }}
        />
      )}
    </section>
  );
}
