import { Camera, LogOut, ShieldCheck } from "lucide-react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../app/AuthProvider";

export function AppShell() {
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="PhotoGuard Startseite">
          <span className="brand-mark">
            <Camera size={20} aria-hidden="true" />
          </span>
          <span>PhotoGuard</span>
        </Link>
        <nav className="topnav" aria-label="Hauptnavigation">
          {isAdmin ? (
            <NavLink to="/admin" className={({ isActive }) => (isActive ? "active" : "")}>
              <ShieldCheck size={16} aria-hidden="true" />
              Admin
            </NavLink>
          ) : null}
          {user ? (
            <button className="icon-text ghost" type="button" onClick={handleLogout}>
              <LogOut size={16} aria-hidden="true" />
              Abmelden
            </button>
          ) : null}
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
