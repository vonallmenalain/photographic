import { useEffect, useState } from 'react';
import { api, ApiError, setAdminToken } from '../../api/client';
import { Alert, Spinner } from '../../components/common';

interface AccountResponse {
  token?: string;
  username: string;
  email: string;
}

export default function AdminAccount({ onUsernameChange }: { onUsernameChange?: (username: string) => void }) {
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<AccountResponse>('/api/admin/account', { admin: true })
      .then((acc) => {
        setUsername(acc.username);
        setEmail(acc.email ?? '');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Konto konnte nicht geladen werden.'))
      .finally(() => setLoading(false));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setBusy(true);
    try {
      const res = await api<AccountResponse>('/api/admin/account', {
        method: 'PUT',
        admin: true,
        body: { username: username.trim(), email: email.trim() },
      });
      if (res.token) setAdminToken(res.token);
      setUsername(res.username);
      setEmail(res.email ?? '');
      onUsernameChange?.(res.username);
      setSuccess('Deine Kontodaten wurden gespeichert.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner label="Konto wird geladen …" />;

  return (
    <div>
      <h1>Konto</h1>
      <p className="soft">
        Hier kannst du deinen Benutzernamen und deine E-Mail-Adresse ändern. Mit beidem kannst du dich anschließend anmelden.
      </p>
      <div className="card" style={{ maxWidth: 520 }}>
        {error && <Alert kind="error">{error}</Alert>}
        {success && <Alert kind="success">{success}</Alert>}
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="username">Benutzername</label>
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
            <p className="soft" style={{ fontSize: 13, marginTop: 6 }}>
              Erlaubt sind Buchstaben, Zahlen, Leerzeichen sowie die Zeichen . _ -
            </p>
          </div>
          <div className="field">
            <label htmlFor="email">E-Mail-Adresse</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="z. B. name@example.com"
            />
            <p className="soft" style={{ fontSize: 13, marginTop: 6 }}>
              Wird für die Anmeldung per E-Mail und für „Passwort vergessen“ verwendet.
            </p>
          </div>
          <button className="btn" disabled={busy}>
            {busy ? 'Speichern …' : 'Änderungen speichern'}
          </button>
        </form>
      </div>
    </div>
  );
}
