import {
  Database,
  Images,
  LayoutDashboard,
  LogOut,
  Settings,
  ShieldAlert,
  ShoppingCart
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { apiGet } from "../api/photosApi";
import { AdminLoginPage } from "../pages/AdminLoginPage";
import { MeResponse } from "../types/domain";
import { Button } from "./Button";
import { ErrorState } from "./ErrorState";
import { Loading } from "./Loading";

type GateState =
  | { status: "checking" }
  | { status: "allowed" }
  | { status: "denied"; message: string };

export function AdminRoute() {
  const { user, loading, getIdToken, signOut } = useAuth();
  const location = useLocation();
  const [gate, setGate] = useState<GateState>({ status: "checking" });

  useEffect(() => {
    let active = true;

    if (!user) {
      return;
    }

    setGate({ status: "checking" });
    apiGet<MeResponse>("/api/me", getIdToken)
      .then((me) => {
        if (!active) return;
        setGate(
          me.role === "admin"
            ? { status: "allowed" }
            : {
                status: "denied",
                message: "Dieser Bereich ist nur fuer Administratorinnen und Administratoren freigegeben."
              }
        );
      })
      .catch((error: Error) => {
        if (!active) return;
        setGate({
          status: "denied",
          message: error.message || "Die Admin-Berechtigung konnte nicht geprueft werden."
        });
      });

    return () => {
      active = false;
    };
  }, [getIdToken, user]);

  if (loading) {
    return <Loading label="Anmeldung wird geprueft..." />;
  }

  if (!user) {
    return <AdminLoginPage redirectTo={location.pathname} />;
  }

  if (gate.status === "checking") {
    return <Loading label="Admin-Berechtigung wird geprueft..." />;
  }

  if (gate.status === "denied") {
    return (
      <div className="grid">
        <div className="pill">
          <ShieldAlert size={16} /> Kein Adminzugriff
        </div>
        <ErrorState message={gate.message} />
        <div className="actions">
          <Button type="button" variant="secondary" icon={<LogOut size={18} />} onClick={signOut}>
            Abmelden und als Admin einloggen
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <nav className="section-tabs" aria-label="Adminbereiche">
        <NavLink className="section-tab" to="/admin" end>
          <LayoutDashboard size={17} />
          <span>Uebersicht</span>
        </NavLink>
        <NavLink className="section-tab" to="/admin/setup">
          <Database size={17} />
          <span>Stammdaten</span>
        </NavLink>
        <NavLink className="section-tab" to="/admin/upload">
          <Images size={17} />
          <span>Upload</span>
        </NavLink>
        <NavLink className="section-tab" to="/admin/photos">
          <Settings size={17} />
          <span>Verwaltung</span>
        </NavLink>
        <NavLink className="section-tab" to="/admin/gallery">
          <Images size={17} />
          <span>Galerie</span>
        </NavLink>
        <NavLink className="section-tab" to="/admin/cart">
          <ShoppingCart size={17} />
          <span>Warenkorb</span>
        </NavLink>
      </nav>
      <Outlet />
    </>
  );
}
