import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { Alert } from '../../components/common';

export default function AdminResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!token) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
        <div className="narrow" style={{ width: '100%' }}>
          <div className="card">
            <Alert kind="error">Ungültiger oder fehlender Token. Bitte fordere einen neuen Link an.</Alert>
            <p style={{ marginTop: 16, textAlign: 'center' }}>
              <Link to="/admin/passwort-vergessen" style={{ color: 'var(--blue, #2f6fed)', fontWeight: 600, textDecoration: 'none' }}>
                Neuen Link anfordern
              </Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== passwordConfirm) {
      setError('Die Passwörter stimmen nicht überein.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      await api('/api/admin/reset-password', {
        method: 'POST',
        body: { token, password },
      });
      setDone(true);
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
          <div className="lock-big">🔐</div>
          <h1>Neues Passwort vergeben</h1>
          <p className="soft">Wähle ein neues Passwort für deinen Admin-Zugang.</p>
        </div>
        <div className="card">
          {done ? (
            <>
              <Alert kind="success">Dein Passwort wurde erfolgreich geändert.</Alert>
              <p style={{ marginTop: 16, textAlign: 'center' }}>
                <Link to="/admin" style={{ color: 'var(--blue, #2f6fed)', fontWeight: 600, textDecoration: 'none' }}>
                  → Zur Anmeldung
                </Link>
              </p>
            </>
          ) : (
            <>
              {error && <Alert kind="error">{error}</Alert>}
              <form onSubmit={submit}>
                <div className="field">
                  <label htmlFor="pw">Neues Passwort</label>
                  <input
                    id="pw"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    minLength={8}
                    autoFocus
                    required
                  />
                  <span style={{ fontSize: 12, color: '#7b8794' }}>Mindestens 8 Zeichen</span>
                </div>
                <div className="field">
                  <label htmlFor="pw2">Passwort wiederholen</label>
                  <input
                    id="pw2"
                    type="password"
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </div>
                <button className="btn block" disabled={busy}>
                  {busy ? 'Speichern …' : 'Passwort speichern'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
