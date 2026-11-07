import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { Alert, Modal } from './common';

/**
 * „Vorschau“ einer E-Mail an die Eltern – direkt vor dem Versand. Das Backend
 * baut die E-Mail mit denselben Funktionen wie beim echten Versand, die
 * Vorschau zeigt also genau, was die Eltern erhalten: Absender, Betreff und die
 * gestaltete E-Mail (umschaltbar auf die reine Textversion).
 *
 * Sind mehrere Varianten im Spiel (z. B. Einladung für neue und Erinnerung für
 * bereits eingeladene Adressen), lässt sich oben zwischen ihnen wechseln.
 */

export type PreviewType = 'invitation' | 'reminder' | 'consent' | 'consent_reminder';

const TYPE_LABELS: Record<PreviewType, string> = {
  invitation: 'Einladung',
  reminder: 'Erinnerung',
  consent: 'Einverständniserklärung',
  consent_reminder: 'Erinnerung Einverständnis',
};

interface PreviewMail {
  subject: string;
  html: string;
  text: string;
  from: string;
  replyTo: string;
  sample: string;
}

export function EmailPreviewModal({
  eventId,
  types,
  initialType,
  mentionExtension = false,
  emailId,
  recipientHint,
  onClose,
}: {
  eventId: string;
  /** Varianten, zwischen denen umgeschaltet werden kann (mind. eine). */
  types: PreviewType[];
  initialType?: PreviewType;
  /** Erinnerung: Hinweis auf den verlängerten Bestellzeitraum einbauen. */
  mentionExtension?: boolean;
  /** Einverständnis: Kindernamen dieser Adresse verwenden. */
  emailId?: string;
  /** Text für die Zeile „An“, z. B. „jede ausgewählte E-Mail-Adresse einzeln“. */
  recipientHint?: string;
  onClose: () => void;
}) {
  const [type, setType] = useState<PreviewType>(initialType ?? types[0]);
  const [mail, setMail] = useState<PreviewMail | null>(null);
  const [view, setView] = useState<'html' | 'text'>('html');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ type });
    if (mentionExtension) params.set('mentionExtension', '1');
    if (emailId) params.set('emailId', emailId);
    api<PreviewMail>(`/api/admin/events/${eventId}/email-preview?${params.toString()}`, { admin: true })
      .then((m) => {
        if (active) setMail(m);
      })
      .catch((err) => {
        if (active) setError(err instanceof ApiError ? err.message : 'Vorschau konnte nicht geladen werden.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [eventId, type, mentionExtension, emailId]);

  // Links in der Vorschau sollen nichts öffnen: Ziel „neues Fenster“ ist im
  // abgeschotteten iframe (ohne allow-popups) gesperrt.
  const srcDoc = mail
    ? mail.html.replace(/<body/i, '<head><base target="_blank"></head><body')
    : '';

  const to =
    recipientHint ??
    (mail?.sample ? `${mail.sample} (Beispiel – jede Adresse erhält die E-Mail einzeln)` : 'jede ausgewählte E-Mail-Adresse einzeln');

  return (
    <Modal
      title="Vorschau der E-Mail"
      width={920}
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Schliessen
        </button>
      }
    >
      {types.length > 1 && (
        <div className="seg-tabs" role="tablist" aria-label="Variante der E-Mail">
          {types.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={type === t}
              className={type === t ? 'active' : ''}
              onClick={() => setType(t)}
            >
              {TYPE_LABELS[t]}
            </button>
          ))}
        </div>
      )}
      {error && <Alert kind="error">{error}</Alert>}
      {loading && !mail ? (
        <p className="muted">Vorschau wird erstellt …</p>
      ) : mail ? (
        <>
          <dl className="preview-meta">
            <dt>Von</dt>
            <dd>{mail.from}</dd>
            {mail.replyTo && (
              <>
                <dt>Antwort an</dt>
                <dd>{mail.replyTo}</dd>
              </>
            )}
            <dt>An</dt>
            <dd>{to}</dd>
            <dt>Betreff</dt>
            <dd>
              <strong>{mail.subject}</strong>
            </dd>
          </dl>
          <div className="row between" style={{ margin: '10px 0 8px' }}>
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              {type === 'consent' || type === 'consent_reminder'
                ? 'Der persönliche Link ist in der Vorschau durch einen Platzhalter ersetzt.'
                : 'Links sind in der Vorschau deaktiviert.'}
            </span>
            <div className="seg-tabs small" role="tablist" aria-label="Darstellung">
              <button
                type="button"
                role="tab"
                aria-selected={view === 'html'}
                className={view === 'html' ? 'active' : ''}
                onClick={() => setView('html')}
              >
                Gestaltet
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'text'}
                className={view === 'text' ? 'active' : ''}
                onClick={() => setView('text')}
              >
                Nur Text
              </button>
            </div>
          </div>
          {view === 'html' ? (
            <iframe
              title={`Vorschau: ${mail.subject}`}
              className="preview-frame"
              sandbox=""
              srcDoc={srcDoc}
              style={{ opacity: loading ? 0.5 : 1 }}
            />
          ) : (
            <pre className="preview-text">{mail.text}</pre>
          )}
        </>
      ) : null}
    </Modal>
  );
}
