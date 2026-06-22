import { FormEvent, useEffect, useState } from "react";
import { isSignInWithEmailLink, signInWithEmailLink, signOut as firebaseSignOut } from "firebase/auth";
import { useNavigate, useSearchParams } from "react-router-dom";
import { auth, firebaseConfigError } from "../firebase/client";
import { apiGet } from "../api/photosApi";
import { MeResponse } from "../types/domain";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ErrorState } from "../components/ErrorState";
import { Loading } from "../components/Loading";

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState(
    window.localStorage.getItem("emailForSignIn") || searchParams.get("email") || ""
  );
  const [needsEmail, setNeedsEmail] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function finishSignIn(emailAddress: string) {
    setLoading(true);
    setError("");
    try {
      if (!auth) {
        throw new Error(firebaseConfigError || "Firebase ist nicht konfiguriert.");
      }

      const href = window.location.href;
      if (!isSignInWithEmailLink(auth, href)) {
        throw new Error("Dieser Login-Link ist ungueltig oder abgelaufen.");
      }

      const result = await signInWithEmailLink(auth, emailAddress.trim(), href);
      window.localStorage.removeItem("emailForSignIn");
      const me = await apiGet<MeResponse>("/api/me", () => result.user.getIdToken());
      if (me.role === "admin") {
        await firebaseSignOut(auth);
        navigate("/admin", { replace: true });
        return;
      }
      navigate("/gallery", { replace: true });
    } catch (callbackError) {
      setError(
        callbackError instanceof Error
          ? callbackError.message
          : "Die Anmeldung konnte nicht abgeschlossen werden."
      );
      setLoading(false);
    }
  }

  useEffect(() => {
    const storedEmail =
      window.localStorage.getItem("emailForSignIn") || searchParams.get("email") || "";
    if (!storedEmail) {
      setNeedsEmail(true);
      setLoading(false);
      return;
    }
    void finishSignIn(storedEmail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setNeedsEmail(false);
    void finishSignIn(email);
  }

  if (loading) {
    return <Loading label="Login-Link wird geprueft..." />;
  }

  return (
    <Card>
      <h1>Login abschliessen</h1>
      {needsEmail ? (
        <form className="form" onSubmit={handleSubmit}>
          <p>Bitte gib dieselbe E-Mail-Adresse ein, an die der Login-Link gesendet wurde.</p>
          <div className="form-row">
            <label htmlFor="email">E-Mail-Adresse</label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <Button>Login abschliessen</Button>
        </form>
      ) : null}
      {error ? <ErrorState message={error} /> : null}
    </Card>
  );
}
