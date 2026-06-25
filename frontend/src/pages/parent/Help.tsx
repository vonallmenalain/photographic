import { useState } from 'react';
import { api, ApiError } from '../../api/client';
import { Alert, TrustNote } from '../../components/common';

const TYPES = [
  { value: 'wrong_email', label: 'Meine E-Mail-Adresse ist falsch oder veraltet' },
  { value: 'missing_photo', label: 'Ich sehe keine / zu wenige Fotos' },
  { value: 'wrong_photo', label: 'Ein Foto scheint nicht zu meinem Kind zu gehören' },
  { value: 'link_problem', label: 'Problem mit dem Bestätigungslink / Code' },
  { value: 'purchase_problem', label: 'Problem beim Kauf' },
  { value: 'other', label: 'Etwas anderes' },
];

export default function Help() {
  const [type, setType] = useState('missing_photo');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await api<{ message: string }>('/api/parent/report', {
        method: 'POST',
        body: { type, message, email: email || undefined },
      });
      setSent(true);
      setMessage('');
      void res;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Konnte nicht gesendet werden.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="narrow" style={{ margin: '0 auto' }}>
      <h1>Hilfe &amp; Kontakt</h1>
      <p className="soft">
        Sie finden keine Fotos, die hinterlegte E-Mail-Adresse stimmt nicht, oder etwas funktioniert
        nicht? Schreiben Sie uns kurz – wir kümmern uns darum.
      </p>

      <div className="card">
        {sent ? (
          <Alert kind="success">
            Danke, Ihre Meldung ist bei uns eingegangen. Wir melden uns bei Ihnen.
          </Alert>
        ) : (
          <form onSubmit={submit}>
            {error && <Alert kind="error">{error}</Alert>}
            <div className="field">
              <label htmlFor="type">Worum geht es?</label>
              <select id="type" value={type} onChange={(e) => setType(e.target.value)}>
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="email">Ihre E-Mail-Adresse (für unsere Antwort)</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@beispiel.de"
              />
            </div>
            <div className="field">
              <label htmlFor="msg">Nachricht</label>
              <textarea
                id="msg"
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Beschreiben Sie kurz Ihr Anliegen …"
                required
              />
            </div>
            <button className="btn" disabled={busy || !message.trim()}>
              {busy ? 'Wird gesendet …' : 'Meldung senden'}
            </button>
          </form>
        )}
      </div>

      <div style={{ marginTop: 18 }}>
        <TrustNote>
          Aus Sicherheitsgründen verraten wir nicht, ob eine bestimmte E-Mail-Adresse hinterlegt ist.
          Wenn Ihre Adresse freigeschaltet ist, erhalten Sie immer einen Zugangscode.
        </TrustNote>
      </div>
    </div>
  );
}
