import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { Alert, Modal } from './common';

/**
 * „Vorschau“ einer E-Mail an die Eltern. Das Backend baut die E-Mail mit
 * denselben Funktionen wie beim echten Versand, die Vorschau zeigt also genau,
 * was die Eltern erhalten: Absender, Betreff und die gestaltete E-Mail
 * (umschaltbar auf die reine Textversion und auf die Breite eines Handys).
 *
 * - `EmailPreviewModal`: E-Mails eines Auftrags (Einladung, Erinnerung,
 *   Einverständnis). Sind mehrere Varianten im Spiel, lässt sich oben zwischen
 *   ihnen wechseln.
 * - `OrderEmailPreviewModal`: E-Mails einer Bestellung (Bestellbestätigung,
 *   Versandbestätigung).
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

/** Lädt die Vorschau von `url` neu, sobald sich die Adresse ändert. */
function useMailPreview(url: string) {
  const [mail, setMail] = useState<PreviewMail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api<PreviewMail>(url, { admin: true })
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
  }, [url]);

  return { mail, loading, error };
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
  const params = new URLSearchParams({ type });
  if (mentionExtension) params.set('mentionExtension', '1');
  if (emailId) params.set('emailId', emailId);
  const { mail, loading, error } = useMailPreview(
    `/api/admin/events/${eventId}/email-preview?${params.toString()}`,
  );

  const to =
    recipientHint ??
    (mail?.sample ? `${mail.sample} (Beispiel – jede Adresse erhält die E-Mail einzeln)` : 'jede ausgewählte E-Mail-Adresse einzeln');

  return (
    <PreviewModal title="Vorschau der E-Mail" onClose={onClose}>
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
      <MailPreviewBody
        mail={mail}
        loading={loading}
        error={error}
        to={to}
        note={
          type === 'consent' || type === 'consent_reminder'
            ? 'Der persönliche Link ist in der Vorschau durch einen Platzhalter ersetzt.'
            : 'Links sind in der Vorschau deaktiviert.'
        }
      />
    </PreviewModal>
  );
}

export type OrderMailType = 'confirmation' | 'shipping';

/**
 * Vorschau der E-Mails einer Bestellung: die Bestellbestätigung, wie sie nach
 * der Zahlung an die Eltern ging (aus den gespeicherten Bestelldaten neu
 * aufgebaut), oder die Versandbestätigung vor dem Versand.
 */
export function OrderEmailPreviewModal({
  orderId,
  type,
  onClose,
}: {
  orderId: string;
  type: OrderMailType;
  onClose: () => void;
}) {
  const { mail, loading, error } = useMailPreview(
    `/api/admin/orders/${orderId}/email-preview?type=${type}`,
  );
  return (
    <PreviewModal
      title={type === 'confirmation' ? 'Bestellbestätigung' : 'Vorschau der Versandbestätigung'}
      onClose={onClose}
    >
      <MailPreviewBody
        mail={mail}
        loading={loading}
        error={error}
        to={mail?.sample || '—'}
        note={
          type === 'confirmation'
            ? 'Automatisch nach der Zahlung verschickt – hier aus den gespeicherten Bestelldaten neu aufgebaut. Links sind deaktiviert.'
            : 'Links sind in der Vorschau deaktiviert.'
        }
      />
    </PreviewModal>
  );
}

function PreviewModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal
      title={title}
      width={920}
      onClose={onClose}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          Schliessen
        </button>
      }
    >
      {children}
    </Modal>
  );
}

/** Kopfzeilen (Von, An, Betreff), Umschalter und die E-Mail selbst. */
function MailPreviewBody({
  mail,
  loading,
  error,
  to,
  note,
}: {
  mail: PreviewMail | null;
  loading: boolean;
  error: string;
  to: string;
  note: string;
}) {
  const [view, setView] = useState<'html' | 'text'>('html');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');

  // Links in der Vorschau sollen nichts öffnen: Ziel „neues Fenster“ ist im
  // abgeschotteten iframe (ohne allow-popups) gesperrt.
  const srcDoc = mail
    ? /<head[^>]*>/i.test(mail.html)
      ? mail.html.replace(/<head[^>]*>/i, (head) => `${head}<base target="_blank">`)
      : mail.html.replace(/<body/i, '<head><base target="_blank"></head><body')
    : '';

  if (error) return <Alert kind="error">{error}</Alert>;
  if (loading && !mail) return <p className="muted">Vorschau wird erstellt …</p>;
  if (!mail) return null;

  return (
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
        <span className="muted" style={{ fontSize: '0.8rem', flex: '1 1 240px' }}>
          {note}
        </span>
        <div className="row" style={{ gap: 8 }}>
          {view === 'html' && (
            <div className="seg-tabs small" role="tablist" aria-label="Bildschirmbreite">
              <button
                type="button"
                role="tab"
                aria-selected={device === 'desktop'}
                className={device === 'desktop' ? 'active' : ''}
                onClick={() => setDevice('desktop')}
              >
                Computer
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={device === 'mobile'}
                className={device === 'mobile' ? 'active' : ''}
                onClick={() => setDevice('mobile')}
              >
                Handy
              </button>
            </div>
          )}
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
      </div>
      {view === 'html' ? (
        <iframe
          title={`Vorschau: ${mail.subject}`}
          className={`preview-frame${device === 'mobile' ? ' mobile' : ''}`}
          sandbox=""
          srcDoc={srcDoc}
          style={{ opacity: loading ? 0.5 : 1 }}
        />
      ) : (
        <pre className="preview-text">{mail.text}</pre>
      )}
    </>
  );
}
