import { Camera, Home, Images, LogOut, Shield, ShoppingCart } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/useAuth";

export function AppShell() {
  const { user, signOut } = useAuth();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand">
            <span className="brand-mark">
              <Camera size={20} />
            </span>
            <span>Photographic</span>
          </NavLink>
          <nav className="nav" aria-label="Hauptnavigation">
            <NavLink className="nav-link" to="/">
              <Home size={18} />
              <span>Start</span>
            </NavLink>
            {user ? (
              <>
                <NavLink className="nav-link" to="/gallery">
                  <Images size={18} />
                  <span>Galerie</span>
                </NavLink>
                <NavLink className="nav-link" to="/cart">
                  <ShoppingCart size={18} />
                  <span>Warenkorb</span>
                </NavLink>
                <NavLink className="nav-link" to="/admin">
                  <Shield size={18} />
                  <span>Admin</span>
                </NavLink>
                <button className="icon-button" type="button" onClick={signOut} title="Abmelden">
                  <LogOut size={18} />
                  <span>Abmelden</span>
                </button>
              </>
            ) : (
              <NavLink className="nav-link" to="/login">
                <LogOut size={18} />
                <span>Einloggen</span>
              </NavLink>
            )}
          </nav>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}
