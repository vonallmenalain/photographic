import { FormEvent, useState } from "react";
import { sendPasswordResetEmail, signInWithEmailAndPassword, signOut as firebaseSignOut } from "firebase/auth";
import { KeyRound, LockKeyhole, LogIn } from "lucide-react";
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
  const [resetLoading, setResetLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const safeRedirect = redirectTo.startsWith("/admin") ? redirectTo : "/admin";

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

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

  async function handlePasswordReset() {
    setResetLoading(true);
    setError("");
    setMessage("");

    try {
      if (!auth) {
        throw new Error(firebaseConfigError || "Firebase ist nicht konfiguriert.");
      }

      const trimmedEmail = email.trim();
      if (!trimmedEmail) {
        throw new Error("Bitte gib zuerst deine Admin-E-Mail-Adresse ein.");
      }

      await sendPasswordResetEmail(auth, trimmedEmail);
      setMessage("Wenn für diese E-Mail ein Konto existiert, wurde ein Link zum Passwort-Zurücksetzen gesendet.");
    } catch (resetError) {
      setError(
        resetError instanceof Error
          ? resetError.message
          : "Der Passwort-Link konnte nicht gesendet werden."
      );
    } finally {
      setResetLoading(false);
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
            {loading ? "Wird geprüft..." : "Einloggen"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={resetLoading || loading}
            icon={<KeyRound size={18} />}
            onClick={handlePasswordReset}
          >
            {resetLoading ? "Link wird gesendet..." : "Passwort vergessen"}
          </Button>
        </form>
        {firebaseConfigError ? <ErrorState message={firebaseConfigError} /> : null}
        {message ? <div className="success-box">{message}</div> : null}
        {error ? <ErrorState message={error} /> : null}
      </Card>
    </div>
  );
}
