import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { Alert } from '../../components/common';

export default function AdminForgotPassword() {
  const [username, setUsername] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/api/admin/forgot-password', {
        method: 'POST',
        body: { username },
      });
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Es ist ein Fehler aufgetreten.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div className="narrow" style={{ width: '100%' }}>
        <div className="hero">
          <div className="lock-big">🔑</div>
          <h1>Passwort vergessen</h1>
          <p className="soft">Gib deinen Benutzernamen oder deine E-Mail-Adresse ein. Wir senden dir einen Link zum Zurücksetzen deines Passworts.</p>
        </div>
        <div className="card">
          {sent ? (
            <>
              <Alert kind="success">
                Wir haben dir einen Link zum Zurücksetzen deines Passworts zugeschickt. Bitte prüfe auch deinen Spam-Ordner.
              </Alert>
              <p style={{ marginTop: 16, textAlign: 'center' }}>
                <Link to="/admin" style={{ color: 'var(--blue, #2f6fed)', fontWeight: 600, textDecoration: 'none' }}>
                  ← Zurück zur Anmeldung
                </Link>
              </p>
            </>
          ) : (
            <>
              {error && <Alert kind="error">{error}</Alert>}
              <form onSubmit={submit}>
                <div className="field">
                  <label htmlFor="u">Benutzername / E-Mail</label>
                  <input
                    id="u"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    autoFocus
                    required
                  />
                </div>
                <button className="btn block" disabled={busy}>
                  {busy ? 'Sende Link …' : 'Link anfordern'}
                </button>
              </form>
              <p style={{ marginTop: 16, textAlign: 'center', fontSize: 14, color: '#7b8794' }}>
                <Link to="/admin" style={{ color: 'var(--blue, #2f6fed)', textDecoration: 'none' }}>
                  ← Zurück zur Anmeldung
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
