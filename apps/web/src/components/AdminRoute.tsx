import { ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { apiGet } from "../api/photosApi";
import { MeResponse } from "../types/domain";
import { ErrorState } from "./ErrorState";
import { Loading } from "./Loading";

type GateState =
  | { status: "checking" }
  | { status: "allowed" }
  | { status: "denied"; message: string };

export function AdminRoute() {
  const { user, loading, getIdToken } = useAuth();
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
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
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
      </div>
    );
  }

  return <Outlet />;
}
