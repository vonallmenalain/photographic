import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useParentAuth } from '../context/ParentAuth';

export function Layout({ children }: { children: ReactNode }) {
  const { verified, email, logout } = useParentAuth();
  return (
    <>
      <header className="appbar">
        <div className="container appbar-inner">
          <Link to="/" className="brand">
            <span className="lock">🔒</span>
            <span>Geschützte Foto-Galerie</span>
          </Link>
          <nav className="nav-actions">
            {verified ? (
              <>
                <Link to="/galerie">Galerie</Link>
                <Link to="/warenkorb">Warenkorb</Link>
                <Link to="/bestellungen">Bestellungen</Link>
                <span className="muted" title={email ?? ''}>
                  {email}
                </span>
                <button className="btn ghost small" onClick={() => logout()}>
                  Abmelden
                </button>
              </>
            ) : (
              <Link to="/hilfe">Hilfe</Link>
            )}
          </nav>
        </div>
      </header>
      <main className="container page-pad">{children}</main>
      <footer className="footer">
        <div className="container">
          Diese App schützt Kinderfotos bewusst. Die Fotos sind nur nach Bestätigung Ihrer
          E-Mail-Adresse sichtbar. · <Link to="/datenschutz">Datenschutz</Link> ·{' '}
          <Link to="/hilfe">Hilfe & Kontakt</Link>
        </div>
      </footer>
    </>
  );
}
