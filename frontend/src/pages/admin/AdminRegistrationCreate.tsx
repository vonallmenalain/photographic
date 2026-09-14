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

/**
 * „Klasse erfassen lassen“: Der Fotograf legt eine oder mehrere Klassen einer
 * Schule an und entscheidet, wer was tut – Klassenlink für die Eltern,
 * Erfassung der E-Mail-Adressen durch die Lehrperson, Einverständnis ja/nein.
 * Jede Klasse wird ein Auftrag im Status „Erfassung“; die Lehrperson erhält
 * ihren persönlichen Link per E-Mail.
 */
export default function AdminRegistrationCreate({ onCancel }: { onCancel: () => void }) {
  const navigate = useNavigate();
  const [school, setSchool] = useState('');
  const [shootingDate, setShootingDate] = useState('');
  const [deadline, setDeadline] = useState('');
  const [parentLinkEnabled, setParentLinkEnabled] = useState(true);
  const [teacherEntersEmails, setTeacherEntersEmails] = useState(false);
  const [consentRequired, setConsentRequired] = useState(true);
  const [autoReminder, setAutoReminder] = useState(false);
  const [autoReminderDays, setAutoReminderDays] = useState('3');
  const [sendTeacherLink, setSendTeacherLink] = useState(true);
  // Eine Zeile je Klasse: „Klasse; E-Mail Lehrperson; Name Lehrperson“
  const [classesText, setClassesText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CreatedClass[] | null>(null);

  const parsedClasses = classesText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/[;\t|]/).map((p) => p.trim());
      const name = parts[0] ?? '';
      const emailIdx = parts.findIndex((p, i) => i > 0 && p.includes('@'));
      const teacherEmail = emailIdx > 0 ? parts[emailIdx] : '';
      const teacherName = parts.filter((p, i) => i > 0 && i !== emailIdx).join(' ');
      return { name, teacherEmail, teacherName };
    })
    .filter((c) => c.name);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (parsedClasses.length === 0) {
      setError('Bitte mindestens eine Klasse eintragen.');
      return;
    }
    if (!parentLinkEnabled && !teacherEntersEmails) {
      setError('Bitte mindestens einen Weg wählen: Klassenlink für die Eltern oder E-Mail-Adressen durch die Lehrperson.');
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ classes: CreatedClass[]; devLogOnly: boolean }>('/api/admin/registrations', {
        method: 'POST',
        admin: true,
        body: {
          classes: parsedClasses,
          settings: {
            school,
            shootingDate: shootingDate || null,
            deadline: deadline || null,
            teacherEntersEmails,
            parentLinkEnabled,
            consentRequired,
            autoConsentReminder: autoReminder,
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
              <a href={`/admin/events/${c.id}/erfassung`} onClick={(e) => { e.preventDefault(); navigate(`/admin/events/${c.id}/erfassung`); }}>
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
          ein, die Eltern bestätigen ihre E-Mail-Adresse selbst und geben dabei ihr Einverständnis.
          Du entscheidest hier, welche Wege offenstehen. Jede Klasse wird ein Auftrag im Status
          „Erfassung“ und lässt sich danach mit einem Klick übernehmen.
        </p>
        {error && <Alert kind="error">{error}</Alert>}

        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <div className="field" style={{ flex: '2 1 240px' }}>
            <label htmlFor="reg-school">Schule / Schulhaus</label>
            <input id="reg-school" value={school} onChange={(e) => setSchool(e.target.value)} placeholder="z. B. Schulhaus Stöckern" />
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

        <div className="field">
          <label htmlFor="reg-classes">
            Klassen und Lehrpersonen <span style={{ color: 'var(--danger)' }}>*</span>
          </label>
          <textarea
            id="reg-classes"
            rows={4}
            value={classesText}
            onChange={(e) => setClassesText(e.target.value)}
            placeholder={'KG 1; lehrperson@schule.ch; Anna Muster\n3b; b.keller@schule.ch; Beat Keller'}
            style={{ width: '100%' }}
          />
          <p className="muted" style={{ fontSize: '0.8rem', marginTop: 6, marginBottom: 0 }}>
            Eine Zeile pro Klasse: Klasse; E-Mail der Lehrperson; Name der Lehrperson. Ohne
            E-Mail-Adresse erfasst du die Klasse selbst (kein Lehrpersonen-Link).
            {parsedClasses.length > 0 && ` ${parsedClasses.length} Klasse(n) erkannt.`}
          </p>
        </div>
      </div>

      <div className="card mb">
        <h2 style={{ marginTop: 0 }}>Wie werden die Eltern erreicht?</h2>
        <label className="consent-option" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={parentLinkEnabled} onChange={(e) => setParentLinkEnabled(e.target.checked)} />
          <span>
            <strong>Klassenlink mit QR-Code</strong>
            <br />
            <span className="muted">
              Die Lehrperson (oder du) gibt den Link über den üblichen Kanal der Schule weiter. Die
              Eltern tragen ihre E-Mail-Adresse und ihr Kind selbst ein. Die Lehrperson sieht keine
              E-Mail-Adressen.
            </span>
          </span>
        </label>
        <label className="consent-option" style={{ cursor: 'pointer', marginTop: 8 }}>
          <input type="checkbox" checked={teacherEntersEmails} onChange={(e) => setTeacherEntersEmails(e.target.checked)} />
          <span>
            <strong>Lehrperson erfasst die E-Mail-Adressen</strong>
            <br />
            <span className="muted">
              Die Lehrperson trägt Kind und Adresse ein, die App lädt die Eltern per E-Mail ein. Die
              Lehrperson sieht dadurch alle Adressen der Klasse.
            </span>
          </span>
        </label>
        <p className="muted" style={{ fontSize: '0.8rem', margin: '8px 0 0' }}>
          Beides zusammen ist möglich. Alles, was die Lehrperson kann, kannst du auch selbst in der
          Erfassungsansicht erledigen.
        </p>
      </div>

      <div className="card mb">
        <h2 style={{ marginTop: 0 }}>Einverständnis</h2>
        <label className="consent-option" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={consentRequired} onChange={(e) => setConsentRequired(e.target.checked)} />
          <span>
            <strong>Einverständniserklärung über die App einholen</strong>
            <br />
            <span className="muted">
              Die Eltern wählen: alles, nur Klassenfoto, nur Einzelfotos oder nein. Ausschalten, wenn
              die Schule das Einverständnis bereits auf Papier eingeholt hat; dann dient die Erfassung
              nur der Klassenliste.
            </span>
          </span>
        </label>
        {consentRequired && (
          <div className="row" style={{ marginTop: 10, alignItems: 'center', gap: 8 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={autoReminder} onChange={(e) => setAutoReminder(e.target.checked)} style={{ width: 'auto' }} />
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
            <span className="muted" style={{ fontSize: '0.85rem' }}>Tage vor der Rückmeldefrist (einmalig)</span>
          </div>
        )}
      </div>

      <div className="card mb">
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={sendTeacherLink} onChange={(e) => setSendTeacherLink(e.target.checked)} style={{ width: 'auto' }} />
          Lehrpersonen sofort den persönlichen Link per E-Mail schicken
        </label>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn" disabled={busy || parsedClasses.length === 0}>
            {busy ? 'Wird angelegt …' : parsedClasses.length > 1 ? `${parsedClasses.length} Klassen anlegen` : 'Klasse anlegen'}
          </button>
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            Abbrechen
          </button>
        </div>
      </div>
    </form>
  );
}
