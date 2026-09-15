import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { Alert, DeliveryProblemBadge, type DeliveryProblemInfo } from './common';
import { formatDate } from '../lib/format';

/**
 * Bausteine der Klassenerfassung, die Lehrpersonen (Klassenseite) und der
 * Fotograf (Adminbereich) gemeinsam nutzen: Kennzahlen, Klassenliste mit
 * Einverständnis-Status, Einladen per „Kind; E-Mail“-Liste und der Klassenlink
 * mit QR-Code und druckbarem Elternbrief.
 */

export interface RosterParent {
  id: string;
  email: string;
  masked: boolean;
  name: string;
  status: string;
  verified: boolean;
  invited_at: string | null;
  delivery_problem: DeliveryProblemInfo | null;
  decision: string | null;
  decided_at: string | null;
}
export interface RosterChild {
  id: string;
  name: string;
  source: string;
  needs_review: boolean;
  consent: string | null;
  conflict: boolean;
  consent_updated_at: string | null;
  parents: RosterParent[];
  state: 'answered' | 'invited' | 'no_email';
}
export interface RosterStats {
  children: number;
  answered: number;
  all: number;
  group_only: number;
  individual_only: number;
  none: number;
  invited_pending: number;
  no_email: number;
  conflicts: number;
  needs_review: number;
  parents: number;
  parents_verified: number;
}
export interface Roster {
  children: RosterChild[];
  stats: RosterStats;
}
export interface ParentLink {
  url: string;
  qrSvg: string;
  shareText: string;
}

export const CONSENT_SHORT: Record<string, string> = {
  all: 'Ja, alles',
  group_only: 'Nur Klassenfoto',
  individual_only: 'Nur Einzelfotos',
  none: 'Nein',
};

export function ConsentBadge({ consent, conflict }: { consent: string | null; conflict?: boolean }) {
  if (!consent) return <span className="badge gray">keine Antwort</span>;
  const cls = consent === 'all' ? 'green' : consent === 'none' ? 'red' : 'amber';
  return (
    <>
      <span className={`badge ${cls}`}>{CONSENT_SHORT[consent] ?? consent}</span>
      {conflict && (
        <span className="badge red" title="Die Elternteile haben unterschiedlich geantwortet; es gilt die vorsichtigere Antwort.">
          Widerspruch
        </span>
      )}
    </>
  );
}

export function StatRow({ stats, consentRequired }: { stats: RosterStats; consentRequired: boolean }) {
  const items: { label: string; value: string }[] = [{ label: 'Kinder', value: String(stats.children) }];
  if (consentRequired) {
    items.push(
      { label: 'Antworten', value: `${stats.answered} von ${stats.children}` },
      { label: 'Ja, alles', value: String(stats.all) },
      { label: 'Nur Klassenfoto', value: String(stats.group_only) },
      { label: 'Nur Einzelfotos', value: String(stats.individual_only) },
      { label: 'Nein', value: String(stats.none) },
      { label: 'Eingeladen, keine Antwort', value: String(stats.invited_pending) },
    );
  } else {
    items.push({ label: 'Mit E-Mail-Adresse', value: String(stats.children - stats.no_email) });
  }
  items.push({ label: 'Ohne E-Mail-Adresse', value: String(stats.no_email) });
  if (stats.needs_review > 0) items.push({ label: 'Von Eltern ergänzt, zu prüfen', value: String(stats.needs_review) });
  return (
    <div className="stat-row">
      {items.map((it) => (
        <div className="analytics-stat" key={it.label}>
          <span className="analytics-stat-num">{it.value}</span>
          <span className="analytics-stat-lbl">{it.label}</span>
        </div>
      ))}
    </div>
  );
}

export interface RosterActions {
  rename: (childId: string, name: string) => Promise<void>;
  confirm: (childId: string) => Promise<void>;
  merge: (childId: string, targetId: string) => Promise<void>;
  remove: (childId: string) => Promise<void>;
}

export function RosterTable({
  roster,
  consentRequired,
  editable,
  showEmails,
  actions,
  busy,
  emailLink,
}: {
  roster: Roster;
  consentRequired: boolean;
  editable: boolean;
  showEmails: boolean;
  actions: RosterActions;
  busy: boolean;
  /** Adminbereich: E-Mail-Adresse verlinkt auf die E-Mail-Verwaltung. */
  emailLink?: (parent: RosterParent) => string;
}) {
  const [mergeFor, setMergeFor] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState('');

  if (roster.children.length === 0) {
    return <p className="muted">Noch keine Kinder eingetragen.</p>;
  }

  const stateLabel = (c: RosterChild) =>
    c.state === 'invited' ? 'eingeladen, keine Antwort' : 'keine E-Mail-Adresse bekannt';

  return (
    <div style={{ overflowX: 'auto', marginTop: 10 }}>
      <table className="roster-table">
        <thead>
          <tr>
            <th>Kind</th>
            <th>{consentRequired ? 'Antwort' : 'Stand'}</th>
            <th>Eltern</th>
            {editable && <th></th>}
          </tr>
        </thead>
        <tbody>
          {roster.children.map((c) => (
            <tr key={c.id}>
              <td>
                <strong>{c.name}</strong>
                {c.needs_review && (
                  <div>
                    <span className="badge amber" title="Von den Eltern über den Klassenlink eingetragen, aber keinem Eintrag der Klassenliste zugeordnet.">
                      von Eltern ergänzt
                    </span>
                  </div>
                )}
              </td>
              <td>
                {consentRequired ? (
                  c.consent ? (
                    <>
                      <ConsentBadge consent={c.consent} conflict={c.conflict} />
                      {c.consent_updated_at && (
                        <div className="muted" style={{ fontSize: '0.78rem' }}>{formatDate(c.consent_updated_at)}</div>
                      )}
                    </>
                  ) : (
                    <span className={`badge ${c.state === 'invited' ? 'amber' : 'gray'}`}>{stateLabel(c)}</span>
                  )
                ) : c.parents.length > 0 ? (
                  <span className="badge green">E-Mail erfasst</span>
                ) : (
                  <span className="badge gray">keine E-Mail-Adresse</span>
                )}
              </td>
              <td>
                {c.parents.length === 0 ? (
                  <span className="muted">—</span>
                ) : (
                  <ul className="list-reset" style={{ margin: 0, padding: 0 }}>
                    {c.parents.map((p) => (
                      <li key={p.id} style={{ whiteSpace: 'nowrap' }}>
                        {emailLink && showEmails ? <Link to={emailLink(p)}>{p.email}</Link> : <span>{p.email}</span>}
                        {showEmails && p.name ? <span className="muted"> ({p.name})</span> : null}{' '}
                        {consentRequired && p.decision && (
                          <span className="muted" style={{ fontSize: '0.78rem' }}>
                            · {CONSENT_SHORT[p.decision] ?? p.decision}
                          </span>
                        )}
                        {p.verified && !p.decision && (
                          <span className="muted" style={{ fontSize: '0.78rem' }}> · bestätigt</span>
                        )}
                        {p.invited_at && !p.decision && (
                          <span className="muted" style={{ fontSize: '0.78rem' }}> · eingeladen {formatDate(p.invited_at)}</span>
                        )}{' '}
                        <DeliveryProblemBadge problem={p.delivery_problem} />
                      </li>
                    ))}
                  </ul>
                )}
              </td>
              {editable && (
                <td style={{ whiteSpace: 'nowrap' }}>
                  {mergeFor === c.id ? (
                    <span className="row" style={{ gap: 6 }}>
                      <select value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)} style={{ width: 180 }}>
                        <option value="">— zusammenführen mit —</option>
                        {roster.children
                          .filter((o) => o.id !== c.id)
                          .map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                      </select>
                      <button
                        type="button"
                        className="btn small"
                        disabled={busy || !mergeTarget}
                        onClick={async () => {
                          await actions.merge(c.id, mergeTarget);
                          setMergeFor(null);
                          setMergeTarget('');
                        }}
                      >
                        OK
                      </button>
                      <button type="button" className="btn ghost small" onClick={() => setMergeFor(null)}>
                        Abbrechen
                      </button>
                    </span>
                  ) : (
                    <span className="row" style={{ gap: 4 }}>
                      {c.needs_review && (
                        <button
                          type="button"
                          className="btn secondary small"
                          disabled={busy}
                          title="Eintrag als richtiges Kind der Klasse bestätigen"
                          onClick={() => actions.confirm(c.id)}
                        >
                          Bestätigen
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn ghost small"
                        disabled={busy}
                        title="Namen korrigieren"
                        onClick={() => {
                          const name = prompt('Name des Kindes', c.name);
                          if (name && name.trim() && name.trim() !== c.name) void actions.rename(c.id, name.trim());
                        }}
                      >
                        ✎
                      </button>
                      {roster.children.length > 1 && (
                        <button
                          type="button"
                          className="btn ghost small"
                          disabled={busy}
                          title="Mit einem anderen Eintrag zusammenführen (Doppel-Eintrag)"
                          onClick={() => {
                            setMergeFor(c.id);
                            setMergeTarget('');
                          }}
                        >
                          ⇄
                        </button>
                      )}
                      {!c.consent && (
                        <button
                          type="button"
                          className="btn ghost small"
                          style={{ color: 'var(--danger)' }}
                          disabled={busy}
                          title="Eintrag entfernen"
                          onClick={() => actions.remove(c.id)}
                        >
                          ×
                        </button>
                      )}
                    </span>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface InviteEntry {
  childName: string;
  emails: string[];
  parentName: string;
}

/** „Lena Müller; anna@x.ch, papa@x.ch“ → Kind + E-Mail-Adressen; Wörter ohne @ bilden den Namen. */
export function parseInviteLines(text: string): { entries: InviteEntry[]; problems: string[] } {
  const entries: InviteEntry[] = [];
  const problems: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const raw = line.trim();
    if (!raw) return;
    const words = raw.split(/[;,\t|]+|\s+/).map((w) => w.trim()).filter(Boolean);
    const emails = words.filter((w) => w.includes('@')).map((w) => w.toLowerCase());
    const childName = words.filter((w) => !w.includes('@')).join(' ');
    const invalid = emails.filter((e) => !EMAIL_RE.test(e));
    if (!childName) problems.push(`Zeile ${i + 1}: Name des Kindes fehlt.`);
    else if (emails.length === 0) problems.push(`Zeile ${i + 1}: keine E-Mail-Adresse für „${childName}“.`);
    else if (invalid.length) problems.push(`Zeile ${i + 1}: ungültige E-Mail-Adresse ${invalid.join(', ')}.`);
    else entries.push({ childName, emails: [...new Set(emails)], parentName: '' });
  });
  return { entries, problems };
}

export function InviteForm({
  endpoint,
  consentRequired,
  onDone,
}: {
  endpoint: string;
  consentRequired: boolean;
  onDone: (message: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const parsed = useMemo(() => parseInviteLines(text), [text]);

  const send = async () => {
    setError('');
    if (parsed.entries.length === 0) {
      setError('Bitte mindestens eine Zeile mit Kind und E-Mail-Adresse eintragen.');
      return;
    }
    setBusy(true);
    try {
      const res = await api<{
        childrenCreated: number;
        emailsCreated: number;
        sent: number;
        failed: string[];
        invalid: string[];
        devLogOnly: boolean;
      }>(endpoint, { method: 'POST', body: { entries: parsed.entries } });
      setText('');
      await onDone(
        `${res.sent} Einladung(en) verschickt${res.childrenCreated ? `, ${res.childrenCreated} Kind(er) neu eingetragen` : ''}.` +
          (res.failed.length ? ` Fehlgeschlagen: ${res.failed.join(', ')}.` : '') +
          (res.devLogOnly ? ' (Testbetrieb: E-Mails werden nur protokolliert.)' : ''),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Einladungen konnten nicht verschickt werden.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card mb">
      <h2>Eltern per E-Mail einladen</h2>
      <p className="muted" style={{ fontSize: '0.88rem', marginTop: 0 }}>
        Pro Zeile ein Kind und die E-Mail-Adresse(n) der Eltern, z. B.{' '}
        <code>Lena Müller; anna@beispiel.ch, papa@beispiel.ch</code>. Die Eltern erhalten sofort eine
        E-Mail{consentRequired ? ' mit dem Link zum Einverständnis' : ' zur Bestätigung ihrer E-Mail-Adresse'}.
        Bereits eingetragene Kinder werden anhand des Namens erkannt.
      </p>
      {error && <Alert kind="error">{error}</Alert>}
      <textarea
        rows={6}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'Lena Müller; anna@beispiel.ch, papa@beispiel.ch\nTim Weber; weber@beispiel.ch'}
        style={{ width: '100%' }}
      />
      {text.trim() && (
        <div style={{ marginTop: 10 }}>
          {parsed.problems.length > 0 && (
            <Alert kind="info">
              {parsed.problems.slice(0, 5).map((p) => (
                <div key={p}>{p}</div>
              ))}
            </Alert>
          )}
          {parsed.entries.length > 0 && (
            <p className="muted" style={{ fontSize: '0.85rem', margin: '0 0 8px' }}>
              {parsed.entries.length} Kind(er),{' '}
              {new Set(parsed.entries.flatMap((e) => e.emails)).size} E-Mail-Adresse(n) erkannt.
            </p>
          )}
        </div>
      )}
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn" type="button" onClick={send} disabled={busy || parsed.entries.length === 0}>
          {busy ? 'Wird verschickt …' : 'Einladungen verschicken'}
        </button>
      </div>
    </div>
  );
}

/**
 * Druckt genau einen Druckblock der Seite (Elternbrief oder Liste für den
 * Fototermin). Das Attribut am <body> schaltet im Print-Stylesheet den
 * passenden Block frei (siehe index.css) und wird nach dem Drucken entfernt.
 */
export function printSection(kind: 'letter' | 'roster'): void {
  document.body.dataset.print = kind;
  const cleanup = () => {
    delete document.body.dataset.print;
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  window.setTimeout(cleanup, 60_000);
  window.print();
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function ClassLinkBox({
  link,
  className,
  school,
  shootingDate,
  deadline,
  consentRequired,
  canRotate,
  onRotate,
}: {
  link: ParentLink;
  className: string;
  school: string;
  shootingDate: string;
  deadline: string;
  consentRequired: boolean;
  canRotate: boolean;
  onRotate: () => Promise<void>;
}) {
  const [copied, setCopied] = useState('');
  const copy = async (what: string, text: string) => {
    setCopied((await copyText(text)) ? what : '');
    window.setTimeout(() => setCopied(''), 2500);
  };

  return (
    <div className="card mb">
      <h2>Klassenlink für die Eltern</h2>
      <p className="muted" style={{ fontSize: '0.88rem', marginTop: 0 }}>
        Über diesen Link (oder den QR-Code) tragen die Eltern ihr Kind selbst ein
        {consentRequired ? ' und geben ihr Einverständnis' : ''}. Der Link zeigt keine Angaben anderer
        Familien. Weitergeben per Elternbrief, Klassen-App oder E-Mail.
      </p>
      <div className="qr-box">
        <div dangerouslySetInnerHTML={{ __html: link.qrSvg }} aria-label="QR-Code zum Klassenlink" />
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <div className="link-box">{link.url}</div>
          <div className="row" style={{ marginTop: 8, gap: 8 }}>
            <button type="button" className="btn secondary small" onClick={() => copy('link', link.url)}>
              {copied === 'link' ? 'Kopiert ✓' : 'Link kopieren'}
            </button>
            <button type="button" className="btn secondary small" onClick={() => copy('text', link.shareText)}>
              {copied === 'text' ? 'Kopiert ✓' : 'Text für die Eltern kopieren'}
            </button>
            <button type="button" className="btn secondary small" onClick={() => printSection('letter')}>
              Elternbrief drucken
            </button>
            {canRotate && (
              <button type="button" className="btn ghost small" onClick={() => void onRotate()} title="Falls der Link ausserhalb der Klasse gelandet ist">
                Link neu erzeugen
              </button>
            )}
          </div>
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: 'pointer', fontSize: '0.88rem' }}>Textvorschlag anzeigen</summary>
            <textarea readOnly rows={8} value={link.shareText} style={{ width: '100%', marginTop: 8, fontSize: '0.85rem' }} />
          </details>
        </div>
      </div>

      {/* Nur beim Drucken sichtbar: Elternbrief mit QR-Code. */}
      <div className="print-only print-letter">
        <h1 style={{ fontSize: '20pt' }}>Schulfotografie Klasse {className}</h1>
        <p style={{ fontSize: '12pt' }}>
          {[school, shootingDate ? `Fototermin: ${shootingDate}` : '', deadline ? `Rückmeldung bis: ${deadline}` : '']
            .filter(Boolean)
            .join(' · ')}
        </p>
        <p style={{ whiteSpace: 'pre-line', fontSize: '12pt', lineHeight: 1.5 }}>{link.shareText}</p>
        <div style={{ marginTop: 16 }} dangerouslySetInnerHTML={{ __html: link.qrSvg }} />
        <p style={{ fontSize: '10pt' }}>{link.url}</p>
      </div>
    </div>
  );
}
