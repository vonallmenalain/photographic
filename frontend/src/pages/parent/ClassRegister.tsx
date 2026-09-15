import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { useParentAuth } from '../../context/ParentAuth';
import { Alert, Spinner, TrustNote } from '../../components/common';

interface ClassInfo {
  className: string;
  school: string;
  shootingDate: string;
  deadline: string;
  consentRequired: boolean;
  teacherSeesEmails: boolean;
  open: boolean;
  contactEmail: string;
}

/**
 * Klassenlink („/k/<token>“): Eltern tragen ihr Kind selbst ein – E-Mail-Adresse,
 * Vor- und Nachname des Kindes, optional der eigene Name. Erst der Klick auf
 * den Bestätigungslink in der E-Mail trägt das Kind in die Klassenliste ein;
 * danach folgt direkt das Einverständnis-Formular. Wer schon angemeldet ist,
 * überspringt die E-Mail und landet sofort im Formular.
 */
export default function ClassRegister() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { verified, email: sessionEmail, loading: authLoading, refresh } = useParentAuth();

  const [info, setInfo] = useState<ClassInfo | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);

  const [email, setEmail] = useState('');
  const [childFirst, setChildFirst] = useState('');
  const [childLast, setChildLast] = useState('');
  const [parentName, setParentName] = useState('');
  const [guardian, setGuardian] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sentMessage, setSentMessage] = useState('');

  useEffect(() => {
    let active = true;
    api<ClassInfo>(`/api/parent/registration/${encodeURIComponent(token)}`)
      .then((r) => {
        if (active) setInfo(r);
      })
      .catch((err) => {
        if (active) setLoadError(err instanceof ApiError ? err.message : 'Dieser Link ist ungültig.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    if (verified && sessionEmail && !email) setEmail(sessionEmail);
  }, [verified, sessionEmail, email]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!guardian) {
      setError('Bitte bestätigen Sie, dass Sie erziehungsberechtigt sind.');
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ direct: boolean; next: string; message: string }>(
        `/api/parent/registration/${encodeURIComponent(token)}`,
        {
          method: 'POST',
          body: {
            email,
            childFirstName: childFirst,
            childLastName: childLast,
            parentName,
            guardian,
          },
        },
      );
      if (res.direct) {
        await refresh();
        navigate(res.next || '/einverstaendnis', { replace: true });
        return;
      }
      setSentMessage(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Es ist ein Fehler aufgetreten.');
    } finally {
      setBusy(false);
    }
  };

  if (loading || authLoading) return <Spinner label="Einen Moment …" />;

  if (loadError || !info) {
    return (
      <div className="narrow" style={{ margin: '0 auto' }}>
        <div className="hero">
          <div className="lock-big">🔗</div>
          <h1>Link nicht mehr gültig</h1>
          <p className="soft">
            {loadError || 'Dieser Link ist ungültig.'} Bitte wenden Sie sich an die Lehrperson oder
            die Fotografin bzw. den Fotografen Ihrer Klasse.
          </p>
        </div>
      </div>
    );
  }

  const facts = [
    info.school ? `Schule: ${info.school}` : '',
    info.shootingDate ? `Fototermin: ${info.shootingDate}` : '',
    info.deadline ? `Rückmeldung bis: ${info.deadline}` : '',
  ].filter(Boolean);

  return (
    <div className="narrow" style={{ margin: '0 auto' }}>
      <div className="hero">
        <div className="lock-big">📸</div>
        <h1>Schulfotografie {info.className}</h1>
        {facts.length > 0 && <p className="soft">{facts.join(' · ')}</p>}
      </div>

      {!info.open ? (
        <div className="card">
          <Alert kind="info">
            Die Erfassung für diese Klasse ist abgeschlossen. Nachträgliche Einträge oder Änderungen
            melden Sie bitte über <Link to="/hilfe">Hilfe &amp; Kontakt</Link>.
          </Alert>
        </div>
      ) : sentMessage ? (
        <div className="card">
          <Alert kind="success">{sentMessage}</Alert>
          <p className="soft" style={{ marginBottom: 0 }}>
            Keine E-Mail erhalten? Prüfen Sie den Spam-Ordner. Der Link in der E-Mail ist 48 Stunden
            gültig.
          </p>
        </div>
      ) : (
        <div className="card">
          <p className="soft" style={{ marginTop: 0 }}>
            Tragen Sie hier Ihr Kind für die Schulfotografie ein.{' '}
            {verified
              ? info.consentRequired
                ? 'Sie sind bereits angemeldet und gelangen direkt zum Einverständnis.'
                : 'Sie sind bereits angemeldet; Ihr Kind wird sofort eingetragen.'
              : info.consentRequired
                ? 'Sie erhalten eine E-Mail zur Bestätigung Ihrer E-Mail-Adresse und gelangen danach direkt zum Einverständnis.'
                : 'Sie erhalten eine E-Mail zur Bestätigung Ihrer E-Mail-Adresse.'}{' '}
            Pro Kind ein Eintrag; Geschwister können Sie danach ergänzen.
          </p>
          {error && <Alert kind="error">{error}</Alert>}
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="reg-email">Ihre E-Mail-Adresse</label>
              <input
                id="reg-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@beispiel.ch"
                required
                readOnly={verified && !!sessionEmail}
              />
              <p className="muted" style={{ fontSize: '0.8rem', marginTop: 6, marginBottom: 0 }}>
                Über diese E-Mail-Adresse sehen Sie später die Fotos Ihres Kindes.
              </p>
            </div>
            <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <div className="field" style={{ flex: '1 1 160px', marginBottom: 12 }}>
                <label htmlFor="reg-first">Vorname des Kindes</label>
                <input
                  id="reg-first"
                  value={childFirst}
                  onChange={(e) => setChildFirst(e.target.value)}
                  required
                  autoComplete="off"
                />
              </div>
              <div className="field" style={{ flex: '1 1 160px', marginBottom: 12 }}>
                <label htmlFor="reg-last">Nachname des Kindes</label>
                <input
                  id="reg-last"
                  value={childLast}
                  onChange={(e) => setChildLast(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="reg-parent">Ihr Name (optional)</label>
              <input
                id="reg-parent"
                value={parentName}
                onChange={(e) => setParentName(e.target.value)}
                autoComplete="name"
                placeholder="Vor- und Nachname"
              />
            </div>
            <label
              style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 10, alignItems: 'start', marginBottom: 16, fontSize: '0.92rem' }}
            >
              <input
                type="checkbox"
                checked={guardian}
                onChange={(e) => setGuardian(e.target.checked)}
                style={{ width: 'auto', marginTop: 4 }}
              />
              <span>Ich bin erziehungsberechtigt für dieses Kind.</span>
            </label>
            <button className="btn block" disabled={busy || !email || !childFirst.trim()}>
              {busy ? 'Wird gesendet …' : verified ? 'Kind eintragen' : 'Eintragen & E-Mail bestätigen'}
            </button>
          </form>
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <TrustNote>
          <strong>Wer sieht was?</strong> Ihre Angaben sehen nur Sie und die Fotografin bzw. der
          Fotograf.{' '}
          {info.teacherSeesEmails
            ? 'Die Lehrperson sieht den Namen Ihres Kindes und Ihre E-Mail-Adresse.'
            : 'Die Lehrperson sieht nur den Namen Ihres Kindes und ob eine Antwort vorliegt.'}{' '}
          Andere Eltern sehen nichts von Ihnen. Diese Seite zeigt keine Angaben anderer Familien.
        </TrustNote>
      </div>
    </div>
  );
}
