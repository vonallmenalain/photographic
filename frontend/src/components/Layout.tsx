import { ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useParentAuth } from '../context/ParentAuth';
import { useCart } from '../context/Cart';

export function Layout({ children }: { children: ReactNode }) {
  const { verified } = useParentAuth();
  return (
    <>
      <header className="appbar">
        <div className="container appbar-inner">
          <Link to="/" className="brand">
            <span className="brand-mark">Photographic</span>
          </Link>
          <nav className="nav-actions">
            {verified ? (
              <>
                <Link to="/galerie" className="nav-link">
                  Galerie
                </Link>
                <CartButton />
                <ProfileMenu />
              </>
            ) : (
              <Link to="/hilfe" className="nav-link">
                Hilfe
              </Link>
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

function CartButton() {
  const { count } = useCart();
  return (
    <Link
      to="/warenkorb"
      className="icon-btn cart-btn"
      aria-label={count > 0 ? `Warenkorb (${count})` : 'Warenkorb'}
      title="Warenkorb"
    >
      <CartIcon />
      {count > 0 && (
        <span className="cart-badge" aria-hidden="true">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}

function ProfileMenu() {
  const { email, logout } = useParentAuth();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleLogout = async () => {
    setOpen(false);
    await logout();
    navigate('/');
  };

  return (
    <div className="profile-menu" ref={wrapperRef}>
      <button
        type="button"
        className="icon-btn profile-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={email ? `Angemeldet als ${email}` : 'Profil'}
        title={email ?? 'Profil'}
        onClick={() => setOpen((o) => !o)}
      >
        <UserIcon />
        <span className="profile-status" aria-hidden="true" />
      </button>
      {open && (
        <div className="profile-dropdown" role="menu">
          <div className="profile-dropdown-header">
            <span className="profile-dropdown-label">Angemeldet als</span>
            <span className="profile-dropdown-email" title={email ?? ''}>
              {email}
            </span>
          </div>
          <div className="profile-dropdown-divider" />
          <Link
            to="/bestellungen"
            role="menuitem"
            className="profile-dropdown-item"
            onClick={() => setOpen(false)}
          >
            <span className="profile-dropdown-icon" aria-hidden="true">
              🧾
            </span>
            <span>Bestellungen</span>
          </Link>
          <button
            type="button"
            role="menuitem"
            className="profile-dropdown-item profile-dropdown-item-danger"
            onClick={handleLogout}
          >
            <span className="profile-dropdown-icon" aria-hidden="true">
              🚪
            </span>
            <span>Abmelden</span>
          </button>
        </div>
      )}
    </div>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="20" height="20">
      <path
        fill="currentColor"
        d="M12 12.5a4.25 4.25 0 1 0 0-8.5a4.25 4.25 0 0 0 0 8.5Zm0 1.75c-3.314 0-9 1.667-9 5v1.5c0 .414.336.75.75.75h16.5a.75.75 0 0 0 .75-.75v-1.5c0-3.333-5.686-5-9-5Z"
      />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="20" height="20">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 4h2l2.4 12.2a1.5 1.5 0 0 0 1.5 1.2h8.2a1.5 1.5 0 0 0 1.5-1.2L21 8H6"
      />
      <circle cx="10" cy="20.5" r="1.4" fill="currentColor" />
      <circle cx="18" cy="20.5" r="1.4" fill="currentColor" />
    </svg>
  );
}
