import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { Alert } from '../../components/common';

interface CreatedClass {
  id: string;
  name: string;
  teacherLinkSent: boolean;
  teacherLinkError: string | null;
}

/** Eine Zeile der Klassen-Tabelle. In der Regel bleibt es bei einer Zeile. */
interface ClassRow {
  uid: number;
  name: string;
  teacherEmail: string;
  teacherName: string;
}

let rowUid = 1;
const makeRow = (): ClassRow => ({ uid: rowUid++, name: '', teacherEmail: '', teacherName: '' });

/** Der Weg, auf dem die Eltern erreicht werden – genau einer der beiden. */
type ParentWay = 'link' | 'teacher';

/**
 * „Klasse erfassen lassen“: Der Fotograf legt eine Klasse (oder mehrere Klassen
 * derselben Schule) an und entscheidet, wer was tut.
 *
 * Die Reihenfolge folgt der Entscheidung: zuerst die Klasse, dann das
 * Einverständnis, und erst daraus ergibt sich der Weg zu den Eltern. Ohne
 * Einverständnis haben die Eltern nichts zu tun – dann erfasst die Lehrperson
 * die E-Mail-Adressen, ein Klassenlink wäre zwecklos. Mit Einverständnis gibt
 * es genau einen Weg: Klassenlink mit QR-Code ODER Erfassung durch die
 * Lehrperson.
 *
 * Jede Klasse wird ein Auftrag im Status „Erfassung“; die Lehrperson erhält
 * ihren persönlichen Link per E-Mail.
 */
export default function AdminRegistrationCreate({ onCancel }: { onCancel: () => void }) {
  const navigate = useNavigate();
  const [school, setSchool] = useState('');
  const [shootingDate, setShootingDate] = useState('');
  const [deadline, setDeadline] = useState('');
  const [rows, setRows] = useState<ClassRow[]>([makeRow()]);
  const [consentRequired, setConsentRequired] = useState(true);
  const [parentWay, setParentWay] = useState<ParentWay>('link');
  const [autoReminder, setAutoReminder] = useState(false);
  const [autoReminderDays, setAutoReminderDays] = useState('3');
  const [sendTeacherLink, setSendTeacherLink] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CreatedClass[] | null>(null);

  // Ohne Einverständnis erfasst immer die Lehrperson die E-Mail-Adressen.
  const effectiveWay: ParentWay = consentRequired ? parentWay : 'teacher';

  const updateRow = (uid: number, patch: Partial<ClassRow>) =>
    setRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
  const addRow = () => setRows((prev) => [...prev, makeRow()]);
  const removeRow = (uid: number) =>
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.uid !== uid)));

  const filledRows = rows.filter((r) => r.name.trim());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (filledRows.length === 0) {
      setError('Bitte mindestens eine Klasse eintragen.');
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ classes: CreatedClass[]; devLogOnly: boolean }>('/api/admin/registrations', {
        method: 'POST',
        admin: true,
        body: {
          classes: filledRows.map((r) => ({
            name: r.name.trim(),
            teacherEmail: r.teacherEmail.trim(),
            teacherName: r.teacherName.trim(),
          })),
          settings: {
            school,
            shootingDate: shootingDate || null,
            deadline: deadline || null,
            teacherEntersEmails: effectiveWay === 'teacher',
            parentLinkEnabled: effectiveWay === 'link',
            consentRequired,
            autoConsentReminder: consentRequired && autoReminder,
            autoConsentReminderDays: Math.max(1, parseInt(autoReminderDays, 10) || 3),
          },
          sendTeacherLink,
        },
      });
      setResult(res.classes);
      if (res.classes.length === 1) {
        navigate(`/admin/events/${res.classes[0].id}/erfassung`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Klassen konnten nicht angelegt werden.');
    } finally {
      setBusy(false);
    }
  };

  if (result && result.length > 1) {
    return (
      <div className="card mb">
        <Alert kind="success">{result.length} Klassen angelegt.</Alert>
        <ul style={{ lineHeight: 1.8 }}>
          {result.map((c) => (
            <li key={c.id}>
              <a
                href={`/admin/events/${c.id}/erfassung`}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(`/admin/events/${c.id}/erfassung`);
                }}
              >
                {c.name}
              </a>
              {c.teacherLinkSent && <span className="muted"> – Link an Lehrperson verschickt</span>}
              {c.teacherLinkError && <span style={{ color: 'var(--danger)' }}> – {c.teacherLinkError}</span>}
            </li>
          ))}
        </ul>
        <button type="button" className="btn secondary" onClick={() => navigate('/admin/events')}>
          Zu den Aufträgen
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <div className="card mb">
        <h2 style={{ marginTop: 0 }}>Klasse erfassen lassen</h2>
        <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
          Die Klassenliste entsteht vor dem Fototermin online: Die Lehrperson trägt die Kindernamen
          ein, die Eltern bestätigen ihre E-Mail-Adresse selbst. Jede Klasse wird ein Auftrag im
          Status „Erfassung“ und lässt sich danach mit einem Klick übernehmen.
        </p>
        {error && <Alert kind="error">{error}</Alert>}

        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <div className="field" style={{ flex: '2 1 240px' }}>
            <label htmlFor="reg-school">Schule / Schulhaus</label>
            <input
              id="reg-school"
              value={school}
              onChange={(e) => setSchool(e.target.value)}
              placeholder="z. B. Schulhaus Stöckern"
            />
          </div>
          <div className="field" style={{ flex: '1 1 160px' }}>
            <label htmlFor="reg-date">Fototermin</label>
            <input id="reg-date" type="date" value={shootingDate} onChange={(e) => setShootingDate(e.target.value)} />
          </div>
          <div className="field" style={{ flex: '1 1 160px' }}>
            <label htmlFor="reg-deadline">Rückmeldefrist</label>
            <input id="reg-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </div>
        </div>

        <h3 style={{ marginBottom: 6 }}>
          Klasse <span style={{ color: 'var(--danger)' }}>*</span>
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <table className="entry-table">
            <thead>
              <tr>
                <th style={{ minWidth: 150 }}>Klasse</th>
                <th style={{ minWidth: 220 }}>E-Mail-Adresse Lehrperson</th>
                <th style={{ minWidth: 180 }}>Name Lehrperson</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.uid}>
                  <td>
                    <input
                      value={row.name}
                      onChange={(e) => updateRow(row.uid, { name: e.target.value })}
                      placeholder="z. B. KG 1"
                      aria-label={`Klasse ${i + 1}`}
                      autoFocus={i === 0}
                    />
                  </td>
                  <td>
                    <input
                      type="email"
                      value={row.teacherEmail}
                      onChange={(e) => updateRow(row.uid, { teacherEmail: e.target.value })}
                      placeholder="lehrperson@schule.ch"
                      aria-label={`E-Mail-Adresse Lehrperson ${i + 1}`}
                    />
                  </td>
                  <td>
                    <input
                      value={row.teacherName}
                      onChange={(e) => updateRow(row.uid, { teacherName: e.target.value })}
                      placeholder="Vor- und Nachname"
                      aria-label={`Name Lehrperson ${i + 1}`}
                    />
                  </td>
                  <td>
                    {rows.length > 1 && (
                      <button
                        type="button"
                        className="btn ghost small"
                        style={{ color: 'var(--danger)' }}
                        onClick={() => removeRow(row.uid)}
                        title="Zeile entfernen"
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button type="button" className="btn secondary small" onClick={addRow}>
            + weitere Klasse derselben Schule
          </button>
        </div>
        <p className="muted" style={{ fontSize: '0.8rem', marginTop: 8, marginBottom: 0 }}>
          Ohne E-Mail-Adresse der Lehrperson erfasst du die Klasse selbst; es wird dann kein
          Lehrpersonen-Link verschickt.
        </p>
      </div>

      <div className="card mb">
        <h2 style={{ marginTop: 0 }}>Einverständnis</h2>
        <label className="consent-option" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={consentRequired}
            onChange={(e) => setConsentRequired(e.target.checked)}
          />
          <span>
            <strong>Einverständniserklärung über die App einholen</strong>
            <br />
            <span className="muted">
              Die Eltern wählen: alles, nur Klassenfoto, nur Einzelfotos oder nein. Ausschalten,
              wenn die Schule das Einverständnis bereits auf Papier eingeholt hat; dann dient die
              Erfassung nur der Klassenliste.
            </span>
          </span>
        </label>
        {consentRequired && (
          <div className="row" style={{ marginTop: 10, alignItems: 'center', gap: 8 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={autoReminder}
                onChange={(e) => setAutoReminder(e.target.checked)}
                style={{ width: 'auto' }}
              />
              Automatische Erinnerung an Eltern ohne Antwort
            </label>
            <input
              type="number"
              min={1}
              max={60}
              value={autoReminderDays}
              onChange={(e) => setAutoReminderDays(e.target.value)}
              disabled={!autoReminder}
              style={{ width: 70 }}
            />
            <span className="muted" style={{ fontSize: '0.85rem' }}>
              Tage vor der Rückmeldefrist (einmalig)
            </span>
          </div>
        )}
      </div>

      <div className="card mb">
        <h2 style={{ marginTop: 0 }}>Wie werden die Eltern erreicht?</h2>
        {consentRequired ? (
          <>
            <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
              Genau ein Weg – sonst bekäme dieselbe Familie zwei Aufforderungen.
            </p>
            <label className={`consent-option${parentWay === 'link' ? ' selected' : ''}`} style={{ cursor: 'pointer' }}>
              <input
                type="radio"
                name="parent-way"
                checked={parentWay === 'link'}
                onChange={() => setParentWay('link')}
              />
              <span>
                <strong>Klassenlink mit QR-Code</strong>
                <br />
                <span className="muted">
                  Die Lehrperson (oder du) gibt den Link über den üblichen Kanal der Schule weiter.
                  Die Eltern tragen ihre E-Mail-Adresse und ihr Kind selbst ein. Die Lehrperson
                  sieht keine E-Mail-Adressen.
                </span>
              </span>
            </label>
            <label
              className={`consent-option${parentWay === 'teacher' ? ' selected' : ''}`}
              style={{ cursor: 'pointer', marginTop: 8 }}
            >
              <input
                type="radio"
                name="parent-way"
                checked={parentWay === 'teacher'}
                onChange={() => setParentWay('teacher')}
              />
              <span>
                <strong>Lehrperson erfasst die E-Mail-Adressen</strong>
                <br />
                <span className="muted">
                  Die Lehrperson trägt Kind und E-Mail-Adresse ein, die App lädt die Eltern per
                  E-Mail zum Einverständnis ein. Die Lehrperson sieht dadurch alle E-Mail-Adressen
                  der Klasse.
                </span>
              </span>
            </label>
          </>
        ) : (
          <p className="soft" style={{ marginTop: 0, marginBottom: 0 }}>
            Ohne Einverständnis über die App müssen die Eltern nichts tun. Die{' '}
            <strong>Lehrperson erfasst die E-Mail-Adressen</strong>, damit die Fotos später den
            Familien zugeordnet werden können. Ein Klassenlink wäre hier zwecklos und entfällt.
          </p>
        )}
        <p className="muted" style={{ fontSize: '0.8rem', margin: '10px 0 0' }}>
          Alles, was die Lehrperson kann, kannst du auch selbst in der Erfassungsansicht erledigen.
        </p>
      </div>

      <div className="card mb">
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={sendTeacherLink}
            onChange={(e) => setSendTeacherLink(e.target.checked)}
            style={{ width: 'auto' }}
          />
          Lehrpersonen sofort den persönlichen Link per E-Mail schicken
        </label>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn" disabled={busy || filledRows.length === 0}>
            {busy
              ? 'Wird angelegt …'
              : filledRows.length > 1
                ? `${filledRows.length} Klassen anlegen`
                : 'Klasse anlegen'}
          </button>
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            Abbrechen
          </button>
        </div>
      </div>
    </form>
  );
}
