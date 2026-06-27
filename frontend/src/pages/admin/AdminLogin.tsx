import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { Alert } from '../../components/common';

export default function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      // The backend sets the httpOnly admin cookie; nothing to store client-side.
      await api('/api/admin/login', {
        method: 'POST',
        body: { username, password },
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Anmeldung fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
      <div className="narrow" style={{ width: '100%' }}>
        <div className="hero">
          <div className="lock-big">🛠️</div>
          <h1>Adminbereich</h1>
          <p className="soft">Bitte melde dich an, um Fotos und Zuordnungen zu verwalten.</p>
        </div>
        <div className="card">
          {error && <Alert kind="error">{error}</Alert>}
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="u">Benutzername / E-Mail</label>
              <input id="u" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
            </div>
            <div className="field">
              <label htmlFor="p">Passwort</label>
              <input
                id="p"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
            <button className="btn block" disabled={busy}>
              {busy ? 'Anmelden …' : 'Anmelden'}
            </button>
          </form>
          <p style={{ marginTop: 16, textAlign: 'center', fontSize: 14, color: '#7b8794' }}>
            <Link to="/admin/passwort-vergessen" style={{ color: 'var(--blue, #2f6fed)', textDecoration: 'none' }}>
              Passwort vergessen?
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
