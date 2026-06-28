import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { useParentAuth } from '../../context/ParentAuth';
import { Alert, TrustNote } from '../../components/common';
import { firebaseEnabled, sendParentSignInLink } from '../../lib/firebase';

export default function Landing() {
  const { verified, loading } = useParentAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && verified) navigate('/galerie', { replace: true });
  }, [verified, loading, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setSending(true);
    try {
      if (firebaseEnabled) {
        // Firebase Authentication: send a passwordless e-mail sign-in link.
        await sendParentSignInLink(email);
        sessionStorage.setItem('pending_email', email.trim().toLowerCase());
        setMessage(
          'Wir haben Ihnen einen Anmeldelink an Ihre E-Mail-Adresse gesendet. Bitte öffnen Sie die E-Mail und klicken Sie auf den Link, um Ihre Fotos zu sehen.',
        );
      } else {
        const res = await api<{ message: string }>('/api/parent/request-code', {
          method: 'POST',
          body: { email },
        });
        setMessage(res.message);
        // Pass the e-mail to the verify page so the code can be checked, and
        // carry the confirmation text along so it stays visible there instead of
        // vanishing the moment the code field appears.
        sessionStorage.setItem('pending_email', email.trim().toLowerCase());
        sessionStorage.setItem('pending_message', res.message);
        setTimeout(() => navigate('/verifizieren'), 900);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Es ist ein Fehler aufgetreten.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="narrow" style={{ margin: '0 auto' }}>
      <div className="hero">
        <div className="lock-big">🔒</div>
        <h1>Ihre Kinderfotos – sicher &amp; geschützt</h1>
        <p className="soft">
          Geben Sie Ihre E-Mail-Adresse ein. Wir senden Ihnen{' '}
          {firebaseEnabled ? 'einen sicheren Anmeldelink' : 'einen Zugangscode'}, damit nur Sie Ihre
          zugeordneten Fotos sehen können. Die Fotos sind sicher auf einem lokalen Schweizer Server
          gespeichert.
        </p>
      </div>

      <div className="card">
        {message && <Alert kind="success">{message}</Alert>}
        {error && <Alert kind="error">{error}</Alert>}
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">E-Mail-Adresse</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="name@beispiel.de"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <button className="btn block" disabled={sending}>
            {sending
              ? 'Wird gesendet …'
              : firebaseEnabled
                ? 'Anmeldelink anfordern'
                : 'Zugangscode anfordern'}
          </button>
        </form>
        <p className="muted center" style={{ marginTop: 14, marginBottom: 0, fontSize: '0.85rem' }}>
          {firebaseEnabled ? 'Schon einen Link erhalten?' : 'Schon einen Code?'}{' '}
          <Link to="/verifizieren">Hier bestätigen</Link>
        </p>
      </div>

      <div style={{ marginTop: 18 }}>
        <TrustNote>
          <strong>Warum eine Bestätigung?</strong> Zum Schutz Ihrer Fotos zeigen wir die Bilder erst
          an, nachdem Ihre E-Mail-Adresse bestätigt wurde. Die Fotos sind genau dieser E-Mail-Adresse
          zugeordnet und können nur nach erfolgreicher Bestätigung angezeigt werden.
        </TrustNote>
      </div>
    </div>
  );
}
