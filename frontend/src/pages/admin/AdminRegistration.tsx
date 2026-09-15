import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { API_BASE, api, ApiError } from '../../api/client';
import { Alert, Modal, Spinner, StatusBadge } from '../../components/common';
import { formatDate } from '../../lib/format';
import {
  ClassLinkBox,
  CONSENT_SHORT,
  InviteForm,
  RosterTable,
  StatRow,
  printSection,
  type ParentLink,
  type Roster,
} from '../../components/registration';

interface Registration {
  school: string;
  shooting_date: string | null;
  shooting_date_text: string;
  deadline: string | null;
  deadline_text: string;
  teacher_name: string;
  teacher_email: string;
  teacher_email_id: string | null;
  teacher_enters_emails: boolean;
  parent_link_enabled: boolean;
  parent_link_url: string | null;
  consent_required: boolean;
  auto_consent_reminder: boolean;
  auto_consent_reminder_days: number;
  auto_consent_reminder_sent_at: string | null;
  teacher_link_sent_at: string | null;
  teacher_completed_at: string | null;
  last_reminder_at: string | null;
  closed_at: string | null;
  open: boolean;
}
interface HistoryRow {
  id: string;
  child_name: string;
  email: string;
  parent_name: string;
  decision: string;
  decision_label: string;
  given_at: string;
  text_hash: string;
  superseded: boolean;
}
interface RegistrationResponse {
  event: { id: string; name: string; status: string; expires_at: string | null };
  registration: Registration;
  roster: Roster;
  history: HistoryRow[];
  parentLink: ParentLink | null;
  devLogOnly: boolean;
}

/**
 * Erfassungsansicht eines Auftrags im Adminbereich: alles, was die Lehrperson
 * auf ihrer Klassenseite kann – plus volle Sicht auf die E-Mail-Adressen, den
 * Verlauf der Entscheidungen, Einstellungen, Lehrpersonen-Link, Export für den
 * Fototermin und die Übernahme in den Auftrag.
 */
export default function AdminRegistration() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<RegistrationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [names, setNames] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const base = `/api/admin/events/${id}/registration`;

  const load = async () => {
    try {
      setData(await api<RegistrationResponse>(base, { admin: true }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erfassung konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const run = async (fn: () => Promise<void>, fallback: string) => {
    setError('');
    setMsg('');
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  const rosterActions = useMemo(
    () => ({
      rename: (childId: string, name: string) =>
        run(() => api(`${base}/children/${childId}`, { method: 'PATCH', admin: true, body: { name } }).then(() => undefined), 'Umbenennen fehlgeschlagen.'),
      confirm: (childId: string) =>
        run(() => api(`${base}/children/${childId}`, { method: 'PATCH', admin: true, body: { confirm: true } }).then(() => undefined), 'Bestätigen fehlgeschlagen.'),
      merge: (childId: string, targetId: string) =>
        run(() => api(`${base}/children/${childId}`, { method: 'PATCH', admin: true, body: { mergeInto: targetId } }).then(() => undefined), 'Zusammenführen fehlgeschlagen.'),
      remove: (childId: string) =>
        run(async () => {
          if (!confirm('Diesen Eintrag entfernen?')) return;
          await api(`${base}/children/${childId}`, { method: 'DELETE', admin: true });
        }, 'Entfernen fehlgeschlagen.'),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base],
  );

  const addNames = () =>
    run(async () => {
      const list = names.split(/\r?\n/).map((n) => n.trim()).filter(Boolean);
      if (list.length === 0) return;
      const res = await api<{ created: string[]; existing: string[] }>(`${base}/children`, {
        method: 'POST',
        admin: true,
        body: { names: list },
      });
      setNames('');
      setMsg(`${res.created.length} Kind(er) eingetragen${res.existing.length ? `, ${res.existing.length} bereits vorhanden` : ''}.`);
    }, 'Kinder konnten nicht eingetragen werden.');

  const sendTeacherLink = () =>
    run(async () => {
      const res = await api<{ devLogOnly: boolean }>(`${base}/teacher-link`, { method: 'POST', admin: true });
      setMsg(`Der persönliche Link wurde an die Lehrperson verschickt.${res.devLogOnly ? ' (Testbetrieb: nur protokolliert.)' : ''}`);
    }, 'Link konnte nicht verschickt werden.');

  const remind = () =>
    run(async () => {
      if (!confirm('Erinnerung an alle Eltern schicken, deren Kind noch keine Antwort hat?')) return;
      const res = await api<{ sent: number; failed: string[]; withoutEmail: number }>(`${base}/remind`, { method: 'POST', admin: true });
      setMsg(
        `Erinnerung an ${res.sent} E-Mail-Adresse(n) verschickt.${res.withoutEmail ? ` ${res.withoutEmail} Kind(er) ohne bekannte E-Mail-Adresse.` : ''}${res.failed.length ? ` Fehlgeschlagen: ${res.failed.join(', ')}` : ''}`,
      );
    }, 'Erinnerung konnte nicht verschickt werden.');

  const close = async () => {
    if (
      !confirm(
        'Klasse in den Auftrag übernehmen? Klassenlink und Einverständnis-Formular werden geschlossen; der Auftrag wechselt auf „In Bearbeitung“ und öffnet sich im Assistenten bei den Fotos. Die Erfassung lässt sich später wieder öffnen.',
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await api(`${base}/close`, { method: 'POST', admin: true });
      navigate(`/admin/import?eventId=${id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Übernahme fehlgeschlagen.');
      setBusy(false);
    }
  };

  const reopen = () =>
    run(async () => {
      if (!confirm('Erfassung wieder öffnen? Klassenlink und Formular sind danach wieder aktiv.')) return;
      await api(`${base}/reopen`, { method: 'POST', admin: true });
    }, 'Öffnen fehlgeschlagen.');

  if (loading) return <Spinner label="Erfassung wird geladen …" />;
  if (!data) return <Alert kind="error">{error || 'Erfassung nicht gefunden.'}</Alert>;

  const reg = data.registration;
  const open = reg.open;
  const facts = [
    reg.school,
    reg.shooting_date_text ? `Fototermin ${reg.shooting_date_text}` : '',
    reg.deadline_text ? `Rückmeldung bis ${reg.deadline_text}` : '',
  ].filter(Boolean);

  return (
    <div>
      <p>
        <Link to="/admin/events">← Alle Aufträge</Link>
      </p>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>{data.event.name}</h1>
          <p className="soft" style={{ marginTop: 0 }}>
            Klassenerfassung{facts.length ? ` · ${facts.join(' · ')}` : ''}
          </p>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <StatusBadge status={data.event.status} />
          <button className="btn secondary" type="button" onClick={() => setShowSettings(true)} disabled={busy}>
            Einstellungen
          </button>
          {open ? (
            <button className="btn" type="button" onClick={close} disabled={busy}>
              In Auftrag übernehmen
            </button>
          ) : (
            <>
              <Link className="btn secondary" to={`/admin/import?eventId=${id}`}>
                Zum Assistenten
              </Link>
              {data.event.status !== 'published' && (
                <button className="btn ghost" type="button" onClick={reopen} disabled={busy}>
                  Erfassung wieder öffnen
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {data.devLogOnly && (
        <Alert kind="info">Testbetrieb: E-Mails werden nicht verschickt, sondern nur im Server-Log protokolliert.</Alert>
      )}
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}
      {!open && (
        <Alert kind="info">
          Die Erfassung ist geschlossen{reg.closed_at ? ` (${formatDate(reg.closed_at)})` : ''}. Klassenlink und Formular sind
          inaktiv; die Liste bleibt hier einsehbar.
        </Alert>
      )}

      <StatRow stats={data.roster.stats} consentRequired={reg.consent_required} />

      <div className="card mb">
        <h2 style={{ marginTop: 0 }}>Lehrperson</h2>
        {reg.teacher_email ? (
          <p style={{ margin: 0 }}>
            {reg.teacher_name ? `${reg.teacher_name}, ` : ''}
            {reg.teacher_email}
            <span className="muted">
              {reg.teacher_link_sent_at ? ` · Link verschickt ${formatDate(reg.teacher_link_sent_at)}` : ' · noch kein Link verschickt'}
              {reg.teacher_completed_at ? ` · als vollständig gemeldet ${formatDate(reg.teacher_completed_at)}` : ''}
            </span>
          </p>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            Keine Lehrperson hinterlegt; du erfasst die Klasse selbst. Eine Lehrperson kannst du unter „Einstellungen“ eintragen.
          </p>
        )}
        <div className="row" style={{ marginTop: 10 }}>
          {reg.teacher_email && (
            <button className="btn secondary small" type="button" onClick={sendTeacherLink} disabled={busy}>
              {reg.teacher_link_sent_at ? 'Link erneut senden' : 'Link an Lehrperson senden'}
            </button>
          )}
          <span className="muted" style={{ fontSize: '0.82rem' }}>
            {reg.teacher_enters_emails ? 'Die Lehrperson erfasst E-Mail-Adressen und sieht sie.' : 'Die Lehrperson sieht keine E-Mail-Adressen.'}{' '}
            {reg.parent_link_enabled ? 'Klassenlink aktiv.' : 'Kein Klassenlink.'}{' '}
            {reg.consent_required ? 'Einverständnis wird abgefragt.' : 'Kein Einverständnis (über die Schule).'}
            {reg.auto_consent_reminder && reg.consent_required
              ? ` Automatische Erinnerung ${reg.auto_consent_reminder_days} Tage vor der Frist${reg.auto_consent_reminder_sent_at ? ` (verschickt ${formatDate(reg.auto_consent_reminder_sent_at)})` : ''}.`
              : ''}
          </span>
        </div>
      </div>

      <div className="card mb">
        <div className="row between">
          <h2 style={{ marginBottom: 0 }}>Klassenliste</h2>
          <div className="row" style={{ gap: 8 }}>
            {open && reg.consent_required && data.roster.stats.invited_pending > 0 && (
              <button className="btn secondary small" type="button" onClick={remind} disabled={busy}>
                Erinnerung an Ausstehende
              </button>
            )}
            <a className="btn secondary small" href={`${API_BASE}${base}/export.csv`} target="_blank" rel="noreferrer">
              Liste für den Fototermin (CSV)
            </a>
            <button className="btn secondary small" type="button" onClick={() => printSection('roster')}>
              Drucken
            </button>
          </div>
        </div>
        {reg.last_reminder_at && (
          <p className="muted" style={{ fontSize: '0.82rem', margin: '4px 0 0' }}>
            Letzte Erinnerung: {formatDate(reg.last_reminder_at)}
          </p>
        )}
        <RosterTable
          roster={data.roster}
          consentRequired={reg.consent_required}
          editable={open}
          showEmails
          actions={rosterActions}
          busy={busy}
          emailLink={(p) => `/admin/emails/${p.id}`}
        />
        {/* Druckversion: Liste für den Fototermin */}
        <div className="print-only print-roster">
          <h1 style={{ fontSize: '18pt' }}>
            {data.event.name}
            {reg.school ? ` · ${reg.school}` : ''}
            {reg.shooting_date_text ? ` · ${reg.shooting_date_text}` : ''}
          </h1>
          <table>
            <thead>
              <tr>
                <th>Kind</th>
                <th>Antwort</th>
                <th>Klassenfoto</th>
                <th>Einzelfotos</th>
                <th>Hinweis</th>
              </tr>
            </thead>
            <tbody>
              {data.roster.children.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.consent ? CONSENT_SHORT[c.consent] : 'keine Antwort'}</td>
                  <td>{c.consent ? (c.consent === 'all' || c.consent === 'group_only' ? 'ja' : 'nein') : '?'}</td>
                  <td>{c.consent ? (c.consent === 'all' || c.consent === 'individual_only' ? 'ja' : 'nein') : '?'}</td>
                  <td>
                    {[c.conflict ? 'Widerspruch' : '', c.needs_review ? 'von Eltern ergänzt' : '', c.state === 'no_email' ? 'keine E-Mail' : '']
                      .filter(Boolean)
                      .join(', ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {open && (
        <div className="card mb">
          <h2 style={{ marginTop: 0 }}>Kinder eintragen</h2>
          <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
            Ein Kind pro Zeile, Vor- und Nachname (Basis für die automatische Foto-Zuordnung).
          </p>
          <textarea rows={5} value={names} onChange={(e) => setNames(e.target.value)} placeholder={'Lena Müller\nTim Weber'} style={{ width: '100%' }} />
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" type="button" onClick={addNames} disabled={busy || !names.trim()}>
              Kinder eintragen
            </button>
          </div>
        </div>
      )}

      {open && (
        <InviteForm
          endpoint={`${base}/invite`}
          consentRequired={reg.consent_required}
          onDone={async (text) => {
            setMsg(text);
            await load();
          }}
        />
      )}

      {data.parentLink && (
        <ClassLinkBox
          link={data.parentLink}
          className={data.event.name}
          school={reg.school}
          shootingDate={reg.shooting_date_text}
          deadline={reg.deadline_text}
          consentRequired={reg.consent_required}
          canRotate={open}
          onRotate={async () => {
            if (!confirm('Einen neuen Klassenlink erzeugen? Der bisherige Link und QR-Code funktionieren danach nicht mehr.')) return;
            await run(() => api(`${base}/parent-link`, { method: 'POST', admin: true }).then(() => undefined), 'Link konnte nicht erneuert werden.');
          }}
        />
      )}

      <div className="card mb">
        <div className="row between">
          <h2 style={{ marginBottom: 0 }}>Verlauf der Antworten ({data.history.length})</h2>
          <button className="btn ghost small" type="button" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? 'Ausblenden' : 'Anzeigen'}
          </button>
        </div>
        {showHistory &&
          (data.history.length === 0 ? (
            <p className="muted" style={{ marginTop: 10 }}>Noch keine Antworten.</p>
          ) : (
            <div style={{ overflowX: 'auto', marginTop: 10 }}>
              <table>
                <thead>
                  <tr>
                    <th>Zeitpunkt</th>
                    <th>Kind</th>
                    <th>Eltern</th>
                    <th>Antwort</th>
                    <th>Textversion</th>
                  </tr>
                </thead>
                <tbody>
                  {data.history.map((h) => (
                    <tr key={h.id} style={h.superseded ? { opacity: 0.55 } : undefined}>
                      <td>{formatDate(h.given_at)}</td>
                      <td>{h.child_name}</td>
                      <td>
                        {h.email}
                        {h.parent_name ? <span className="muted"> ({h.parent_name})</span> : null}
                      </td>
                      <td>
                        {h.decision_label}
                        {h.superseded && <span className="muted"> · ersetzt</span>}
                      </td>
                      <td className="muted" style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{h.text_hash}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </div>

      {showSettings && (
        <SettingsModal
          reg={reg}
          onClose={() => setShowSettings(false)}
          onSaved={async (text) => {
            setShowSettings(false);
            setMsg(text);
            await load();
          }}
          endpoint={base}
        />
      )}
    </div>
  );
}

function SettingsModal({
  reg,
  endpoint,
  onClose,
  onSaved,
}: {
  reg: Registration;
  endpoint: string;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [school, setSchool] = useState(reg.school);
  const [shootingDate, setShootingDate] = useState(reg.shooting_date ?? '');
  const [deadline, setDeadline] = useState(reg.deadline ?? '');
  const [teacherEmail, setTeacherEmail] = useState(reg.teacher_email);
  const [teacherName, setTeacherName] = useState(reg.teacher_name);
  const [teacherEntersEmails, setTeacherEntersEmails] = useState(reg.teacher_enters_emails);
  const [parentLinkEnabled, setParentLinkEnabled] = useState(reg.parent_link_enabled);
  const [consentRequired, setConsentRequired] = useState(reg.consent_required);
  const [autoReminder, setAutoReminder] = useState(reg.auto_consent_reminder);
  const [autoReminderDays, setAutoReminderDays] = useState(String(reg.auto_consent_reminder_days));
  const [sendLink, setSendLink] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const teacherChanged = teacherEmail.trim().toLowerCase() !== reg.teacher_email;

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api<{ teacherLinkSent: boolean; teacherLinkError: string | null }>(endpoint, {
        method: 'PATCH',
        admin: true,
        body: {
          school,
          shootingDate: shootingDate || null,
          deadline: deadline || null,
          teacherEmail: teacherEmail.trim(),
          teacherName,
          teacherEntersEmails,
          parentLinkEnabled,
          consentRequired,
          autoConsentReminder: autoReminder,
          autoConsentReminderDays: Math.max(1, parseInt(autoReminderDays, 10) || 3),
          sendTeacherLink: sendLink || (teacherChanged && !!teacherEmail.trim()),
        },
      });
      await onSaved(
        `Einstellungen gespeichert.${res.teacherLinkSent ? ' Link an die Lehrperson verschickt.' : ''}${res.teacherLinkError ? ` ${res.teacherLinkError}` : ''}`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Einstellungen der Erfassung"
      width={560}
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
      <div className="field">
        <label>Schule / Schulhaus</label>
        <input value={school} onChange={(e) => setSchool(e.target.value)} />
      </div>
      <div className="row" style={{ gap: 12 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Fototermin</label>
          <input type="date" value={shootingDate} onChange={(e) => setShootingDate(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Rückmeldefrist</label>
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>E-Mail der Lehrperson</label>
          <input type="email" value={teacherEmail} onChange={(e) => setTeacherEmail(e.target.value)} placeholder="leer = keine Lehrperson" />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label>Name der Lehrperson</label>
          <input value={teacherName} onChange={(e) => setTeacherName(e.target.value)} />
        </div>
      </div>
      {teacherChanged && teacherEmail.trim() && (
        <p className="muted" style={{ fontSize: '0.82rem', marginTop: -8 }}>
          Neue Lehrperson: Der bisherige Zugang verfällt, die neue E-Mail-Adresse erhält beim Speichern ihren Link.
        </p>
      )}
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <input type="checkbox" checked={parentLinkEnabled} onChange={(e) => setParentLinkEnabled(e.target.checked)} style={{ width: 'auto' }} />
        Klassenlink mit QR-Code für die Eltern
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <input type="checkbox" checked={teacherEntersEmails} onChange={(e) => setTeacherEntersEmails(e.target.checked)} style={{ width: 'auto' }} />
        Lehrperson erfasst und sieht die E-Mail-Adressen
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <input type="checkbox" checked={consentRequired} onChange={(e) => setConsentRequired(e.target.checked)} style={{ width: 'auto' }} />
        Einverständnis über die App einholen
      </label>
      <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={autoReminder} disabled={!consentRequired} onChange={(e) => setAutoReminder(e.target.checked)} style={{ width: 'auto' }} />
          Automatische Erinnerung
        </label>
        <input type="number" min={1} max={60} value={autoReminderDays} onChange={(e) => setAutoReminderDays(e.target.value)} disabled={!autoReminder || !consentRequired} style={{ width: 70 }} />
        <span className="muted" style={{ fontSize: '0.85rem' }}>Tage vor der Rückmeldefrist</span>
      </div>
      {reg.teacher_email && !teacherChanged && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="checkbox" checked={sendLink} onChange={(e) => setSendLink(e.target.checked)} style={{ width: 'auto' }} />
          Lehrpersonen-Link nach dem Speichern erneut senden
        </label>
      )}
    </Modal>
  );
}
