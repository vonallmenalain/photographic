import { FormEvent, useMemo, useState } from "react";
import { sendSignInLinkToEmail } from "firebase/auth";
import { MailCheck, Send } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { auth, firebaseConfigError } from "../firebase/client";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ErrorState } from "../components/ErrorState";

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const emailFromQuery = searchParams.get("email") ?? "";
  const jobId = searchParams.get("jobId") ?? "";
  const [email, setEmail] = useState(emailFromQuery);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  const callbackUrl = useMemo(() => {
    const url = new URL("/auth/callback", window.location.origin);
    if (emailFromQuery) url.searchParams.set("email", emailFromQuery);
    if (jobId) url.searchParams.set("jobId", jobId);
    return url.toString();
  }, [emailFromQuery, jobId]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      if (!auth) {
        throw new Error(firebaseConfigError || "Firebase ist nicht konfiguriert.");
      }

      await sendSignInLinkToEmail(auth, email.trim(), {
        url: callbackUrl,
        handleCodeInApp: true
      });
      window.localStorage.setItem("emailForSignIn", email.trim());
      if (jobId) {
        window.localStorage.setItem("inviteJobId", jobId);
      }
      setSuccess("Der Login-Link wurde versendet. Bitte oeffne die E-Mail auf diesem Geraet.");
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : "Der Login-Link konnte nicht versendet werden."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid two">
      <Card>
        <div className="card-header">
          <div>
            <h1>Einloggen</h1>
            <p>Du erhaeltst einen sicheren Login-Link per E-Mail.</p>
          </div>
          <MailCheck aria-hidden="true" />
        </div>
        <form className="form" onSubmit={handleSubmit}>
          <div className="form-row">
            <label htmlFor="email">E-Mail-Adresse</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
            />
          </div>
          <Button disabled={loading} icon={<Send size={18} />}>
            {loading ? "Wird gesendet..." : "Login-Link senden"}
          </Button>
        </form>
        {firebaseConfigError ? <ErrorState message={firebaseConfigError} /> : null}
        {success ? <div className="success-box">{success}</div> : null}
        {error ? <ErrorState message={error} /> : null}
      </Card>
      <Card>
        <h2>Sicherer Zugriff</h2>
        <p>
          Ein weitergeleiteter Link allein reicht nicht aus. Nach dem Login
          prueft das Foto-Backend deine verifizierte Firebase-E-Mail-Adresse und
          gibt nur passende Bilder frei.
        </p>
        {jobId ? <p className="pill">Einladung fuer Auftrag {jobId}</p> : null}
      </Card>
    </div>
  );
}
