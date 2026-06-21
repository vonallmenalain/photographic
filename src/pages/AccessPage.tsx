import { KeyRound, LogIn, Mail, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../app/AuthProvider";
import { ErrorState, LoadingState } from "../components/PageState";
import { callFunction, type RedeemAccessCodeResponse } from "../services/functions";

export function AccessPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const {
    user,
    loading,
    loginWithEmail,
    registerWithEmail,
    sendMagicLink,
    completeMagicLink
  } = useAuth();
  const queryCode = searchParams.get("code") ?? "";
  const storedCode = window.localStorage.getItem("photoguard_code") ?? "";
  const [code, setCode] = useState(queryCode || storedCode);
  const [email, setEmail] = useState(window.localStorage.getItem("photoguard_email") ?? "");
  const [password, setPassword] = useState("");
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [autoRedeem, setAutoRedeem] = useState(Boolean(queryCode || storedCode));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const trimmedCode = useMemo(() => code.trim(), [code]);

  const redeem = useCallback(async () => {
    if (!user || !trimmedCode || isRedeeming) {
      return;
    }

    setIsRedeeming(true);
    setError("");
    try {
      const token = await user.getIdToken();
      const result = await callFunction<RedeemAccessCodeResponse>(
        "redeem-access-code",
        { code: trimmedCode },
        token
      );
      window.localStorage.removeItem("photoguard_code");
      navigate(`/gallery/${result.jobId}`);
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Der Code konnte nicht eingelöst werden.");
    } finally {
      setIsRedeeming(false);
      setAutoRedeem(false);
    }
  }, [isRedeeming, navigate, trimmedCode, user]);

  useEffect(() => {
    if (queryCode) {
      window.localStorage.setItem("photoguard_code", queryCode);
      setCode(queryCode);
      setAutoRedeem(true);
    }
  }, [queryCode]);

  useEffect(() => {
    const storedEmail = window.localStorage.getItem("photoguard_email");
    if (!storedEmail || !window.location.href.includes("mode=signIn")) {
      return;
    }

    completeMagicLink(storedEmail)
      .then(() => {
        setMessage("Angemeldet.");
        setAutoRedeem(true);
      })
      .catch(() => setError("Der E-Mail-Link ist ungültig oder abgelaufen."));
  }, [completeMagicLink]);

  useEffect(() => {
    if (user && trimmedCode && autoRedeem) {
      void redeem();
    }
  }, [autoRedeem, redeem, trimmedCode, user]);

  async function handleCodeSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!trimmedCode) {
      setError("Bitte gib deinen Zugangscode ein.");
      return;
    }

    window.localStorage.setItem("photoguard_code", trimmedCode);
    setAutoRedeem(Boolean(user));
    if (user) {
      await redeem();
    } else {
      setMessage("Code gespeichert. Bitte melde dich an.");
    }
  }

  async function handleAuth(action: "login" | "register" | "magic") {
    setIsSubmitting(true);
    setError("");
    setMessage("");

    try {
      if (!email.trim()) {
        throw new Error("Bitte gib deine E-Mail-Adresse ein.");
      }

      if (action === "magic") {
        await sendMagicLink(email.trim());
        setMessage("E-Mail-Link gesendet.");
        return;
      }

      if (password.length < 6) {
        throw new Error("Das Passwort braucht mindestens 6 Zeichen.");
      }

      if (action === "login") {
        await loginWithEmail(email.trim(), password);
      } else {
        await registerWithEmail(email.trim(), password);
      }
      setAutoRedeem(Boolean(trimmedCode));
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : "Die Anmeldung ist fehlgeschlagen.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loading) {
    return <LoadingState />;
  }

  return (
    <section className="page narrow">
      <div className="panel">
        <p className="eyebrow">Eltern-Zugang</p>
        <h1>Galerie öffnen</h1>
        <form className="stack" onSubmit={handleCodeSubmit}>
          <label>
            Zugangscode
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="one-time-code"
              placeholder="ABCD-1234"
            />
          </label>
          <button className="button primary" type="submit" disabled={isRedeeming}>
            <KeyRound size={18} aria-hidden="true" />
            {user ? "Code einlösen" : "Code speichern"}
          </button>
        </form>

        {!user ? (
          <div className="stack auth-box">
            <label>
              E-Mail
              <input
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  window.localStorage.setItem("photoguard_email", event.target.value);
                }}
                autoComplete="email"
                type="email"
                placeholder="name@example.ch"
              />
            </label>
            <label>
              Passwort
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                type="password"
                placeholder="Mindestens 6 Zeichen"
              />
            </label>
            <div className="button-row">
              <button
                className="button primary"
                type="button"
                onClick={() => void handleAuth("login")}
                disabled={isSubmitting}
              >
                <LogIn size={18} aria-hidden="true" />
                Einloggen
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => void handleAuth("register")}
                disabled={isSubmitting}
              >
                Konto erstellen
              </button>
            </div>
            <button
              className="button ghost"
              type="button"
              onClick={() => void handleAuth("magic")}
              disabled={isSubmitting}
            >
              <Mail size={18} aria-hidden="true" />
              E-Mail-Link senden
            </button>
          </div>
        ) : (
          <div className="inline-note success">
            <ShieldCheck size={18} aria-hidden="true" />
            Angemeldet als {user.email}
          </div>
        )}

        {isRedeeming ? <LoadingState label="Code wird geprüft..." /> : null}
        {message ? <p className="inline-note">{message}</p> : null}
        {error ? <ErrorState message={error} /> : null}
        <Link className="text-link" to="/">
          Zurück
        </Link>
      </div>
    </section>
  );
}
