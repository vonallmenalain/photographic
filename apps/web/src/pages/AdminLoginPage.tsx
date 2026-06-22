import { FormEvent, useState } from "react";
import { signInWithEmailAndPassword, signOut as firebaseSignOut } from "firebase/auth";
import { LockKeyhole, LogIn } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "../api/photosApi";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ErrorState } from "../components/ErrorState";
import { auth, firebaseConfigError } from "../firebase/client";
import { MeResponse } from "../types/domain";

export function AdminLoginPage({ redirectTo = "/admin" }: { redirectTo?: string }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const safeRedirect = redirectTo.startsWith("/admin") ? redirectTo : "/admin";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      if (!auth) {
        throw new Error(firebaseConfigError || "Firebase ist nicht konfiguriert.");
      }

      const result = await signInWithEmailAndPassword(auth, email.trim(), password);
      const me = await apiGet<MeResponse>("/api/me", () => result.user.getIdToken());

      if (me.role !== "admin") {
        await firebaseSignOut(auth);
        throw new Error("Dieses Konto hat keine Admin-Berechtigung.");
      }

      navigate(safeRedirect, { replace: true });
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : "Der Admin-Login konnte nicht abgeschlossen werden."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="admin-login-wrap">
      <Card>
        <div className="card-header">
          <div>
            <h1>Admin Login</h1>
            <p>Mit E-Mail und Passwort anmelden.</p>
          </div>
          <LockKeyhole aria-hidden="true" />
        </div>
        <form className="form" onSubmit={handleSubmit}>
          <div className="form-row">
            <label htmlFor="admin-email">E-Mail-Adresse</label>
            <input
              id="admin-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@example.com"
            />
          </div>
          <div className="form-row">
            <label htmlFor="admin-password">Passwort</label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <Button disabled={loading} icon={<LogIn size={18} />}>
            {loading ? "Wird geprueft..." : "Einloggen"}
          </Button>
        </form>
        {firebaseConfigError ? <ErrorState message={firebaseConfigError} /> : null}
        {error ? <ErrorState message={error} /> : null}
      </Card>
    </div>
  );
}
