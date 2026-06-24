import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { useParentAuth } from '../../context/ParentAuth';
import { Alert, TrustNote } from '../../components/common';

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
      const res = await api<{ message: string }>('/api/parent/request-code', {
        method: 'POST',
        body: { email },
      });
      setMessage(res.message);
      // Pass the e-mail to the verify page so the code can be checked.
      sessionStorage.setItem('pending_email', email.trim().toLowerCase());
      setTimeout(() => navigate('/verifizieren'), 900);
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
        <h1>Deine Kinderfotos – sicher &amp; geschützt</h1>
        <p className="soft">
          Gib deine E-Mail-Adresse ein. Wir senden dir einen Zugangscode, damit nur du deine
          zugeordneten Fotos sehen kannst.
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
            {sending ? 'Wird gesendet …' : 'Zugangscode anfordern'}
          </button>
        </form>
        <p className="muted center" style={{ marginTop: 14, marginBottom: 0, fontSize: '0.85rem' }}>
          Schon einen Code? <a onClick={() => navigate('/verifizieren')} style={{ cursor: 'pointer' }}>Hier bestätigen</a>
        </p>
      </div>

      <div style={{ marginTop: 18 }}>
        <TrustNote>
          <strong>Warum eine Bestätigung?</strong> Wir zeigen Fotos erst nach Bestätigung deiner
          E-Mail-Adresse an. So sehen nur berechtigte Personen die Bilder. Es gibt keine offenen
          Galerien und keine erratbaren Links.
        </TrustNote>
      </div>
    </div>
  );
}
