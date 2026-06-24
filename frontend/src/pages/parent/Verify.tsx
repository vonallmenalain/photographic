import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { useParentAuth } from '../../context/ParentAuth';
import { Alert, Spinner, TrustNote } from '../../components/common';

export default function Verify() {
  const [params] = useSearchParams();
  const linkToken = params.get('token');
  const navigate = useNavigate();
  const { setVerified, refresh } = useParentAuth();

  const [email, setEmail] = useState(sessionStorage.getItem('pending_email') ?? '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resent, setResent] = useState('');
  const linkTried = useRef(false);

  // Magic link flow: verify automatically when a token is present.
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
      const res = await api<{ message: string }>('/api/parent/request-code', {
        method: 'POST',
        body: { email },
      });
      setResent(res.message);
    } catch {
      setResent('Falls die Adresse freigeschaltet ist, haben wir dir erneut einen Code gesendet.');
    }
  };

  if (linkToken && busy) {
    return (
      <div className="narrow" style={{ margin: '0 auto' }}>
        <Spinner label="Wir bestätigen deine E-Mail-Adresse …" />
      </div>
    );
  }

  return (
    <div className="narrow" style={{ margin: '0 auto' }}>
      <div className="hero">
        <div className="lock-big">✉️</div>
        <h1>E-Mail bestätigen</h1>
        <p className="soft">
          Wir haben dir einen 6-stelligen Code an deine E-Mail-Adresse gesendet. Gib ihn hier ein.
        </p>
      </div>

      <div className="card">
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
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              required
            />
          </div>
          <button className="btn block" disabled={busy || code.length < 4}>
            {busy ? 'Wird geprüft …' : 'Bestätigen & Fotos ansehen'}
          </button>
        </form>
        <p className="center muted" style={{ marginTop: 14, marginBottom: 0, fontSize: '0.85rem' }}>
          Keinen Code erhalten?{' '}
          <a style={{ cursor: 'pointer' }} onClick={resend}>
            Erneut senden
          </a>
        </p>
      </div>

      <div style={{ marginTop: 18 }}>
        <TrustNote>
          Der Code ist nur kurze Zeit gültig. Bitte gib ihn nicht weiter – er schützt den Zugang zu
          deinen Fotos.
        </TrustNote>
      </div>
    </div>
  );
}
