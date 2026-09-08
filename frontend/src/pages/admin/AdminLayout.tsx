import { ReactNode, useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { api } from '../../api/client';

const links = [
  { to: 'events', label: 'Aufträge' },
  { to: 'import', label: 'Aufträge erfassen' },
  { to: 'orders', label: 'Bestellungen' },
  { to: 'reports', label: 'Meldungen' },
  { to: 'settings', label: 'Einstellungen' },
];

interface Attention {
  openReports: number;
  deliveryProblems: number;
}

export default function AdminLayout({
  username,
  onLogout,
  children,
}: {
  username: string;
  onLogout: () => void;
  children: ReactNode;
}) {
  const location = useLocation();
  // Offene Meldungen + offene Zustellprobleme als Zahl neben „Meldungen“. Wird
  // bei jedem Seitenwechsel und alle paar Minuten aufgefrischt, damit z. B. eine
  // neue Meldung oder ein Bounce auch während der Arbeit auffällt.
  const [attention, setAttention] = useState<Attention | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api<Attention>('/api/admin/attention', { admin: true })
        .then((a) => {
          if (!cancelled) setAttention(a);
        })
        .catch(() => {
          /* der Zähler ist nur eine Bequemlichkeit – Fehler still ignorieren */
        });
    void load();
    const timer = window.setInterval(load, 3 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [location.pathname]);

  const attentionCount = (attention?.openReports ?? 0) + (attention?.deliveryProblems ?? 0);
  const attentionTitle = attention
    ? `${attention.openReports} offene Meldung(en), ${attention.deliveryProblems} nicht zustellbare E-Mail(s)`
    : undefined;

  const logout = async () => {
    // Clears the httpOnly admin cookie on the server.
    try {
      await api('/api/admin/logout', { method: 'POST', admin: true });
    } catch {
      /* ignore */
    }
    onLogout();
  };

  return (
    <div className="admin-shell">
      <aside className="admin-side">
        <div className="logo">🔒 Photographic</div>
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            className={({ isActive }) => (isActive ? 'active' : '')}
            title={l.to === 'reports' ? attentionTitle : undefined}
          >
            {l.label}
            {l.to === 'reports' && attentionCount > 0 && (
              <span className="side-badge" aria-label={attentionTitle}>
                {attentionCount > 99 ? '99+' : attentionCount}
              </span>
            )}
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
