import { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { api, setAdminToken } from '../../api/client';

const links = [
  { to: 'dashboard', label: 'Übersicht' },
  { to: 'import', label: 'Import' },
  { to: 'events', label: 'Events / Foto-Sets' },
  { to: 'emails', label: 'E-Mail-Adressen' },
  { to: 'orders', label: 'Bestellungen' },
  { to: 'reports', label: 'Meldungen' },
  { to: 'account', label: 'Konto' },
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
        <div style={{ fontSize: '0.82rem', color: '#94a3b8', padding: '8px 12px' }}>{username}</div>
        <button className="btn ghost small" style={{ color: '#cbd5e1' }} onClick={logout}>
          Abmelden
        </button>
      </aside>
      <div className="admin-main">{children}</div>
    </div>
  );
}
