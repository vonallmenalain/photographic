import { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { api, setAdminToken } from '../../api/client';

const links = [
  { to: 'events', label: 'Aufträge' },
  { to: 'import', label: 'Import' },
  { to: 'emails', label: 'E-Mail-Adressen' },
  { to: 'orders', label: 'Bestellungen' },
  { to: 'reports', label: 'Meldungen' },
];

export default function AdminLayout({
  username,
  onLogout,
  children,
}: {
  username: string;
  onLogout: () => void;
  children: ReactNode;
}) {
  const logout = async () => {
    try {
      await api('/api/admin/logout', { method: 'POST', admin: true });
    } catch {
      /* ignore */
    }
    setAdminToken(null);
    onLogout();
  };

  return (
    <div className="admin-shell">
      <aside className="admin-side" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="logo">🔒 Foto-Admin</div>
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? 'active' : '')}>
            {l.label}
          </NavLink>
        ))}
        <div className="spacer" />
        <div className="side-user">Angemeldet als {username}</div>
        <NavLink to="account" className={({ isActive }) => (isActive ? 'active' : '')}>
          Konto
        </NavLink>
        <button type="button" className="side-action" onClick={logout}>
          Abmelden
        </button>
      </aside>
      <div className="admin-main">{children}</div>
    </div>
  );
}
