import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api/client';
import { Alert, Spinner } from '../../components/common';

interface AccountResponse {
  token?: string;
  username: string;
  email: string;
}

interface AdminRow {
  username: string;
  email: string;
  created_at: string;
  is_self: boolean;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
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
      .catch((err) => setError(errorMessage(err, 'Konto konnte nicht geladen werden.')))
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
      // Renaming re-issues the admin cookie server-side; nothing to store here.
      setUsername(res.username);
      setEmail(res.email ?? '');
      onUsernameChange?.(res.username);
      setSuccess('Deine Kontodaten wurden gespeichert.');
    } catch (err) {
      setError(errorMessage(err, 'Speichern fehlgeschlagen.'));
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

      <ChangePasswordCard />

      <ManageAdminsCard />
    </div>
  );
}

function ChangePasswordCard() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (newPassword.length < 8) {
      setError('Das neue Passwort muss mindestens 8 Zeichen lang sein.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Die beiden neuen Passwörter stimmen nicht überein.');
      return;
    }
    setBusy(true);
    try {
      await api('/api/admin/change-password', {
        method: 'POST',
        admin: true,
        body: { currentPassword, newPassword },
      });
      setSuccess('Dein Passwort wurde geändert. Es bleibt auch nach einem Neustart erhalten.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(errorMessage(err, 'Passwort konnte nicht geändert werden.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 style={{ marginTop: 32 }}>Passwort ändern</h2>
      <p className="soft">
        Lege hier direkt ein neues Passwort fest – ganz ohne „Passwort vergessen“-E-Mail. Das neue Passwort gilt sofort und
        bleibt dauerhaft gespeichert.
      </p>
      <div className="card" style={{ maxWidth: 520 }}>
        {error && <Alert kind="error">{error}</Alert>}
        {success && <Alert kind="success">{success}</Alert>}
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="cur-pw">Aktuelles Passwort</label>
            <input
              id="cur-pw"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="new-pw">Neues Passwort</label>
            <input
              id="new-pw"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
            <p className="soft" style={{ fontSize: 13, marginTop: 6 }}>
              Mindestens 8 Zeichen.
            </p>
          </div>
          <div className="field">
            <label htmlFor="confirm-pw">Neues Passwort bestätigen</label>
            <input
              id="confirm-pw"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>
          <button className="btn" disabled={busy}>
            {busy ? 'Speichern …' : 'Passwort ändern'}
          </button>
        </form>
      </div>
    </>
  );
}

function ManageAdminsCard() {
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');

  const [newUsername, setNewUsername] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setListError('');
    try {
      const res = await api<{ admins: AdminRow[] }>('/api/admin/admins', { admin: true });
      setAdmins(res.admins);
    } catch (err) {
      setListError(errorMessage(err, 'Admin-Liste konnte nicht geladen werden.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');
    if (newPassword.length < 8) {
      setFormError('Das Passwort muss mindestens 8 Zeichen lang sein.');
      return;
    }
    setBusy(true);
    try {
      await api('/api/admin/admins', {
        method: 'POST',
        admin: true,
        body: { username: newUsername.trim(), email: newEmail.trim(), password: newPassword },
      });
      setFormSuccess(`Admin „${newUsername.trim()}“ wurde angelegt.`);
      setNewUsername('');
      setNewEmail('');
      setNewPassword('');
      await load();
    } catch (err) {
      setFormError(errorMessage(err, 'Admin konnte nicht angelegt werden.'));
    } finally {
      setBusy(false);
    }
  };

  const removeAdmin = async (uname: string) => {
    if (!window.confirm(`Admin „${uname}“ wirklich löschen? Dieser Zugang kann sich danach nicht mehr anmelden.`)) {
      return;
    }
    setListError('');
    setFormSuccess('');
    try {
      await api(`/api/admin/admins/${encodeURIComponent(uname)}`, { method: 'DELETE', admin: true });
      await load();
    } catch (err) {
      setListError(errorMessage(err, 'Admin konnte nicht gelöscht werden.'));
    }
  };

  return (
    <>
      <h2 style={{ marginTop: 32 }}>Weitere Administratoren</h2>
      <p className="soft">
        Lege zusätzliche Admin-Konten an oder entferne sie. Jeder Admin meldet sich mit eigenem Benutzernamen (oder E-Mail)
        und Passwort an. Dein eigenes Konto und das letzte verbleibende Konto lassen sich nicht löschen.
      </p>

      <div className="card" style={{ maxWidth: 640 }}>
        {listError && <Alert kind="error">{listError}</Alert>}
        {loading ? (
          <Spinner label="Admins werden geladen …" />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>Benutzername</th>
                <th style={{ padding: '6px 8px' }}>E-Mail</th>
                <th style={{ padding: '6px 8px' }} />
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.username} style={{ borderTop: '1px solid var(--border, #e5e7eb)' }}>
                  <td style={{ padding: '8px' }}>
                    {a.username}
                    {a.is_self && <span className="soft" style={{ fontSize: 12 }}> (du)</span>}
                  </td>
                  <td style={{ padding: '8px' }}>{a.email || <span className="soft">—</span>}</td>
                  <td style={{ padding: '8px', textAlign: 'right' }}>
                    {!a.is_self && admins.length > 1 && (
                      <button
                        type="button"
                        className="btn ghost small"
                        onClick={() => removeAdmin(a.username)}
                      >
                        Löschen
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h3 style={{ marginTop: 24 }}>Neuen Admin anlegen</h3>
      <div className="card" style={{ maxWidth: 520 }}>
        {formError && <Alert kind="error">{formError}</Alert>}
        {formSuccess && <Alert kind="success">{formSuccess}</Alert>}
        <form onSubmit={createAdmin}>
          <div className="field">
            <label htmlFor="na-username">Benutzername</label>
            <input
              id="na-username"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              autoComplete="off"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="na-email">E-Mail-Adresse (optional)</label>
            <input
              id="na-email"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              autoComplete="off"
              placeholder="z. B. name@example.com"
            />
            <p className="soft" style={{ fontSize: 13, marginTop: 6 }}>
              Ermöglicht die Anmeldung per E-Mail und „Passwort vergessen“ für diesen Admin.
            </p>
          </div>
          <div className="field">
            <label htmlFor="na-password">Passwort</label>
            <input
              id="na-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
            <p className="soft" style={{ fontSize: 13, marginTop: 6 }}>
              Mindestens 8 Zeichen. Teile es dem neuen Admin sicher mit; er kann es anschließend selbst ändern.
            </p>
          </div>
          <button className="btn" disabled={busy}>
            {busy ? 'Anlegen …' : 'Admin anlegen'}
          </button>
        </form>
      </div>
    </>
  );
}
