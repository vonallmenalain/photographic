import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api/client';
import { Alert } from '../../components/common';

export interface AppSettings {
  contact_email: string;
  shipping_fee_cents: number;
  report_notify_enabled: boolean;
  report_notify_emails: string[];
  bounce_notify_enabled: boolean;
  bounce_notify_emails: string[];
  /** Ob ein Resend-Signing-Secret hinterlegt ist (der Wert selbst wird nie ausgeliefert). */
  resend_webhook_secret_set: boolean;
  /** Woher es stammt: aus dem Adminbereich, aus der .env oder gar nicht gesetzt. */
  resend_webhook_secret_source: 'settings' | 'env' | 'none';
  updated_at: string | null;
}

export interface SettingsResponse {
  settings: AppSettings;
  adminEmails: string[];
  defaults: { contact_email: string; shipping_fee_cents: number };
  currency: string;
  mailFrom: string;
  devLogOnly: boolean;
}

const COPY = {
  report: {
    title: 'Benachrichtigung bei neuer Meldung',
    intro:
      'Wenn Eltern unter „Hilfe & Kontakt“ etwas erfassen, erscheint es hier unter „Meldungen“. Zusätzlich kann bei jeder neuen Meldung sofort eine E-Mail an dich gehen – mit Anliegen, Nachricht und Absenderadresse. Antwortest du auf diese E-Mail, geht die Antwort direkt an die Eltern.',
    checkbox: 'Bei jeder neuen Meldung eine E-Mail senden',
    enabledKey: 'report_notify_enabled' as const,
    emailsKey: 'report_notify_emails' as const,
  },
  bounce: {
    title: 'Benachrichtigung bei Zustellproblemen',
    intro:
      'Kann eine E-Mail nicht zugestellt werden (z. B. weil eine Adresse im Auftrag falsch geschrieben ist), erscheint sie hier in der Liste. Zusätzlich kann sofort eine E-Mail an dich gehen – mit Empfänger, Betreff und der Begründung des Mail-Anbieters.',
    checkbox: 'Bei jeder nicht zustellbaren E-Mail eine E-Mail senden',
    enabledKey: 'bounce_notify_enabled' as const,
    emailsKey: 'bounce_notify_emails' as const,
  },
};

/**
 * Einstellungs-Kachel für eine der beiden Admin-Benachrichtigungen (neue
 * Meldung bzw. Zustellproblem): Ein-/Ausschalter plus Empfängerliste. Bleibt
 * die Liste leer, gehen die E-Mails an alle Admin-Konten mit E-Mail-Adresse.
 */
export function NotificationSettingsCard({ kind }: { kind: 'report' | 'bounce' }) {
  const copy = COPY[kind];
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [emails, setEmails] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<SettingsResponse>('/api/admin/settings', { admin: true })
      .then((r) => {
        setData(r);
        setEnabled(r.settings[copy.enabledKey]);
        setEmails(r.settings[copy.emailsKey].join(', '));
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Einstellungen konnten nicht geladen werden.'),
      )
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setBusy(true);
    try {
      const res = await api<{ settings: AppSettings; adminEmails: string[] }>('/api/admin/settings', {
        method: 'PUT',
        admin: true,
        body: { [copy.enabledKey]: enabled, [copy.emailsKey]: emails },
      });
      setEmails(res.settings[copy.emailsKey].join(', '));
      setData((d) => (d ? { ...d, settings: res.settings, adminEmails: res.adminEmails } : d));
      const list = res.settings[copy.emailsKey];
      setSuccess(
        enabled
          ? list.length > 0
            ? `Gespeichert. Benachrichtigungen gehen an ${list.join(', ')}.`
            : `Gespeichert. Benachrichtigungen gehen an alle Admin-Konten mit E-Mail-Adresse${
                res.adminEmails.length ? ` (${res.adminEmails.join(', ')})` : ''
              }.`
          : 'Gespeichert. Es werden keine Benachrichtigungen verschickt.',
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const adminList = data?.adminEmails ?? [];
  const fallbackText =
    adminList.length > 0
      ? `Leer lassen = an alle Admin-Konten mit E-Mail-Adresse (${adminList.join(', ')}).`
      : 'Leer lassen = an alle Admin-Konten mit E-Mail-Adresse. Aktuell hat kein Admin-Konto eine E-Mail-Adresse – trage sie unter „Konto“ ein oder gib hier Empfänger an.';

  return (
    <div className="card mb">
      <h2 style={{ marginBottom: 6 }}>{copy.title}</h2>
      <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
        {copy.intro}
      </p>
      {error && <Alert kind="error">{error}</Alert>}
      {success && <Alert kind="success">{success}</Alert>}
      {loading ? (
        <p className="muted">Wird geladen …</p>
      ) : (
        <form onSubmit={save}>
          <label
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto minmax(0, 1fr)',
              alignItems: 'center',
              gap: 10,
              fontSize: '0.92rem',
              cursor: 'pointer',
              marginBottom: 12,
            }}
          >
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              style={{ width: 'auto', margin: 0 }}
            />
            <span>{copy.checkbox}</span>
          </label>
          <div className="field" style={{ marginBottom: 12 }}>
            <label htmlFor={`notify-${kind}-emails`} style={{ fontSize: '0.8rem' }}>
              Empfänger (mehrere mit Komma trennen)
            </label>
            <input
              id={`notify-${kind}-emails`}
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              placeholder={adminList[0] ? `z. B. ${adminList[0]}` : 'z. B. name@beispiel.ch'}
              disabled={!enabled}
            />
            <p className="muted" style={{ fontSize: '0.8rem', marginTop: 6, marginBottom: 0 }}>
              {fallbackText}
            </p>
          </div>
          {data?.devLogOnly && (
            <p className="muted" style={{ fontSize: '0.8rem', marginTop: 0 }}>
              Achtung: Kein SMTP konfiguriert – Benachrichtigungen landen nur im Server-Log.
            </p>
          )}
          <button className="btn small" disabled={busy}>
            {busy ? 'Speichern …' : 'Speichern'}
          </button>
        </form>
      )}
    </div>
  );
}
