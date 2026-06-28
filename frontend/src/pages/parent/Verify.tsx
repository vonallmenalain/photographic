import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { useParentAuth } from '../../context/ParentAuth';
import { Alert, Spinner, TrustNote } from '../../components/common';
import {
  firebaseEnabled,
  isParentSignInLink,
  getStoredSignInEmail,
  completeParentSignIn,
  sendParentSignInLink,
} from '../../lib/firebase';

export default function Verify() {
  const [params] = useSearchParams();
  const linkToken = params.get('token');
  const navigate = useNavigate();
  const { setVerified, refresh } = useParentAuth();

  const [email, setEmail] = useState(
    sessionStorage.getItem('pending_email') ?? getStoredSignInEmail(),
  );
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resent, setResent] = useState('');
  // Confirmation text carried over from the request step. It should stay
  // visible the whole time the parent is entering their code.
  const [requestInfo] = useState(() => sessionStorage.getItem('pending_message') ?? '');
  const linkTried = useRef(false);
  const firebaseTried = useRef(false);

  // Is this page being opened from a Firebase passwordless e-mail link?
  const isFirebaseLink =
    typeof window !== 'undefined' && isParentSignInLink(window.location.href);

  // Firebase email-link flow: complete sign-in and exchange the ID token.
  useEffect(() => {
    if (!isFirebaseLink || firebaseTried.current) return;
    const knownEmail = sessionStorage.getItem('pending_email') ?? getStoredSignInEmail();
    // Firebase requires the e-mail to finish sign-in. If we don't have it (link
    // opened on another device), ask the user to type it before continuing.
    if (!knownEmail) return;
    firebaseTried.current = true;
    (async () => {
      setBusy(true);
      try {
        const idToken = await completeParentSignIn(window.location.href, knownEmail);
        const res = await api<{ verified: boolean; email: string }>('/api/parent/firebase-session', {
          method: 'POST',
          body: { idToken },
        });
        setVerified(res.email);
        await refresh();
        sessionStorage.removeItem('pending_email');
        navigate('/galerie', { replace: true });
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Bestätigung fehlgeschlagen.');
      } finally {
        setBusy(false);
      }
    })();
  }, [isFirebaseLink, navigate, setVerified, refresh]);

  // Complete Firebase sign-in once the user supplies the e-mail manually.
  const completeFirebaseWithEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const idToken = await completeParentSignIn(window.location.href, email);
      const res = await api<{ verified: boolean; email: string }>('/api/parent/firebase-session', {
        method: 'POST',
        body: { idToken },
      });
      setVerified(res.email);
      await refresh();
      sessionStorage.removeItem('pending_email');
      navigate('/galerie', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Bestätigung fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  // Magic link flow (non-Firebase backend codes): verify when a token is present.
  useEffect(() => {
    if (!linkToken || linkTried.current) return;
    linkTried.current = true;
    (async () => {
      setBusy(true);
      try {
        const res = await api<{ verified: boolean; email: string }>('/api/parent/verify-link', {
          method: 'POST',
          body: { token: linkToken },
        });
        setVerified(res.email);
        await refresh();
        navigate('/galerie', { replace: true });
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Bestätigung fehlgeschlagen.');
      } finally {
        setBusy(false);
      }
    })();
  }, [linkToken, navigate, setVerified, refresh]);

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api<{ verified: boolean; email: string }>('/api/parent/verify-code', {
        method: 'POST',
        body: { email, code },
      });
      setVerified(res.email);
      await refresh();
      sessionStorage.removeItem('pending_email');
      sessionStorage.removeItem('pending_message');
      navigate('/galerie', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Bestätigung fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError('');
    setResent('');
    try {
      if (firebaseEnabled) {
        await sendParentSignInLink(email);
        setResent('Wir haben Ihnen erneut einen Anmeldelink an Ihre E-Mail-Adresse gesendet.');
        return;
      }
      const res = await api<{ message: string }>('/api/parent/request-code', {
        method: 'POST',
        body: { email },
      });
      setResent(res.message);
    } catch {
      setResent('Falls die Adresse freigeschaltet ist, haben wir Ihnen erneut eine Nachricht gesendet.');
    }
  };

  if ((linkToken || isFirebaseLink) && busy) {
    return (
      <div className="narrow" style={{ margin: '0 auto' }}>
        <Spinner label="Wir bestätigen Ihre E-Mail-Adresse …" />
      </div>
    );
  }

  // Firebase mode: passwordless e-mail-link sign-in.
  if (firebaseEnabled) {
    const needsEmailForLink = isFirebaseLink; // link opened but e-mail unknown
    return (
      <div className="narrow" style={{ margin: '0 auto' }}>
        <div className="hero">
          <div className="lock-big">✉️</div>
          <h1>E-Mail bestätigen</h1>
          <p className="soft">
            {needsEmailForLink
              ? 'Bitte bestätigen Sie Ihre E-Mail-Adresse, um die Anmeldung abzuschliessen.'
              : 'Wir haben Ihnen einen Anmeldelink an Ihre E-Mail-Adresse gesendet. Bitte öffnen Sie die E-Mail und klicken Sie auf den Link.'}
          </p>
        </div>

        <div className="card">
          {error && <Alert kind="error">{error}</Alert>}
          {resent && <Alert kind="success">{resent}</Alert>}
          <form onSubmit={needsEmailForLink ? completeFirebaseWithEmail : (e) => { e.preventDefault(); resend(); }}>
            <div className="field">
              <label htmlFor="email">E-Mail-Adresse</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@beispiel.de"
                required
              />
            </div>
            <button className="btn block" disabled={busy || !email}>
              {busy
                ? 'Wird geprüft …'
                : needsEmailForLink
                  ? 'Anmeldung abschliessen'
                  : 'Anmeldelink erneut senden'}
            </button>
          </form>
        </div>

        <div style={{ marginTop: 18 }}>
          <TrustNote>
            Der Link ist nur kurze Zeit gültig. Bitte geben Sie ihn nicht weiter – er schützt den
            Zugang zu Ihren Fotos.
          </TrustNote>
        </div>
      </div>
    );
  }

  // Fallback mode: 6-digit verification code (no Firebase configured).
  return (
    <div className="narrow" style={{ margin: '0 auto' }}>
      <div className="hero">
        <div className="lock-big">✉️</div>
        <h1>E-Mail bestätigen</h1>
        <p className="soft">
          Wir haben Ihnen einen 6-stelligen Code an Ihre E-Mail-Adresse gesendet. Geben Sie ihn hier
          ein.
        </p>
      </div>

      <div className="card">
        {requestInfo && <Alert kind="info">{requestInfo}</Alert>}
        {error && <Alert kind="error">{error}</Alert>}
        {resent && <Alert kind="success">{resent}</Alert>}
        <form onSubmit={submitCode}>
          <div className="field">
            <label htmlFor="email">E-Mail-Adresse</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@beispiel.de"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="code">Bestätigungscode</label>
            <input
              id="code"
              className="code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              required
            />
          </div>
          <button className="btn block" disabled={busy || code.length !== 6}>
            {busy ? 'Wird geprüft …' : 'Bestätigen & Fotos ansehen'}
          </button>
        </form>
        <p className="center muted" style={{ marginTop: 14, marginBottom: 0, fontSize: '0.85rem' }}>
          Keinen Code erhalten?{' '}
          <button type="button" className="linklike" onClick={resend}>
            Erneut senden
          </button>
        </p>
      </div>

      <div style={{ marginTop: 18 }}>
        <TrustNote>
          Der Code ist nur kurze Zeit gültig. Bitte geben Sie ihn nicht weiter – er schützt den
          Zugang zu Ihren Fotos.
        </TrustNote>
      </div>
    </div>
  );
}
