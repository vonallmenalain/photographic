import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { Alert, Spinner } from '../../components/common';
import { formatPrice } from '../../lib/format';
import { NotificationSettingsCard, type AppSettings, type SettingsResponse } from './NotificationSettings';
import EmailDeliveries from './EmailDeliveries';

/** "3.50" -> 350 (Rappen); toleriert Komma und Leerzeichen. */
function parseFrancs(value: string): number | null {
  const cleaned = value.replace(/\s/g, '').replace(',', '.');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/**
 * Alle Einstellungen der App an einem Ort: Kontaktadresse, Absenderadresse der
 * ausgehenden E-Mails, Versandpauschale, die beiden Benachrichtigungen (neue
 * Meldung, Zustellprobleme) sowie die Einrichtung des Resend-Webhooks samt
 * Liste der nicht zustellbaren E-Mails. Unter „Meldungen“ stehen dadurch nur
 * noch die Anliegen der Eltern.
 */
export default function AdminSettings() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [contactEmail, setContactEmail] = useState('');
  const [senderName, setSenderName] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [shippingFee, setShippingFee] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = (settings: AppSettings) => {
    setContactEmail(settings.contact_email);
    setSenderName(settings.sender_name);
    setSenderEmail(settings.sender_email);
    setShippingFee((settings.shipping_fee_cents / 100).toFixed(2));
  };

  useEffect(() => {
    api<SettingsResponse>('/api/admin/settings', { admin: true })
      .then((r) => {
        setData(r);
        apply(r.settings);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Einstellungen konnten nicht geladen werden.'),
      )
      .finally(() => setLoading(false));
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    const fee = parseFrancs(shippingFee);
    if (fee === null) {
      setError('Bitte gib die Versandpauschale als Betrag ein, z. B. 3.50. 0 bedeutet: keine Pauschale.');
      return;
    }
    if (!senderEmail.trim()) {
      setError('Ohne Absenderadresse kann die App keine E-Mails verschicken. Bitte eine Adresse eintragen.');
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ settings: AppSettings }>('/api/admin/settings', {
        method: 'PUT',
        admin: true,
        body: {
          contact_email: contactEmail.trim(),
          sender_name: senderName.trim(),
          sender_email: senderEmail.trim(),
          shipping_fee_cents: fee,
        },
      });
      setData((d) => (d ? { ...d, settings: res.settings } : d));
      apply(res.settings);
      setSuccess('Einstellungen gespeichert. Sie gelten sofort – auch im Impressum und für die nächste E-Mail.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner label="Einstellungen werden geladen …" />;

  const currency = data?.currency ?? 'chf';
  const domain = contactEmail.includes('@') ? contactEmail.split('@')[1] : 'alae.app';
  const localPart = contactEmail.includes('@') ? contactEmail.split('@')[0] : 'photographic';
  const senderDomain = senderEmail.includes('@') ? senderEmail.split('@')[1] : '';
  const sameAsContact =
    !!senderEmail && senderEmail.trim().toLowerCase() === contactEmail.trim().toLowerCase();

  return (
    <div>
      <h1>Einstellungen</h1>
      <p className="soft">
        Kontakt- und Absenderadresse, Versandpauschale, Benachrichtigungen und die Einrichtung des
        Resend-Webhooks. Die Anliegen der Eltern stehen unter{' '}
        <Link to="/admin/reports">Meldungen</Link>.
      </p>

      {error && <Alert kind="error">{error}</Alert>}
      {success && <Alert kind="success">{success}</Alert>}

      <form onSubmit={save}>
        <div className="card mb" style={{ maxWidth: 720 }}>
          <h2>Kontakt-E-Mail-Adresse</h2>
          <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
            Diese Adresse steht im{' '}
            <Link to="/impressum" target="_blank" rel="noreferrer">
              Impressum
            </Link>{' '}
            und auf der Hilfe-Seite, anstelle einer Telefonnummer. Sie ist zugleich die Adresse, an die
            Antworten der Eltern gehen.
          </p>
          <div className="field">
            <label htmlFor="contact-email">E-Mail-Adresse</label>
            <input
              id="contact-email"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="z. B. photographic@alae.app"
            />
            <p className="muted" style={{ fontSize: '0.8rem', marginTop: 6, marginBottom: 0 }}>
              Leer lassen, um im Impressum keine E-Mail-Adresse anzuzeigen.
            </p>
          </div>

          <div className="alert info" style={{ marginBottom: 0 }}>
            <strong>Wohin gehen E-Mails, die an diese Adresse geschickt werden?</strong>
            <p style={{ margin: '6px 0 0', fontSize: '0.88rem', lineHeight: 1.55 }}>
              Die App verschickt E-Mails, empfängt aber keine. Damit E-Mails an{' '}
              <code>
                {localPart}@{domain}
              </code>{' '}
              in deinem Postfach ankommen, richtest du bei Cloudflare, wo die Domain{' '}
              <code>{domain}</code> liegt, einmalig eine kostenlose Weiterleitung ein. Email Routing
              steht dabei nicht im Domain-Menü „E-Mail“, wo es nur DMARC Management und Email Security
              gibt, sondern kontoweit unter <strong>Compute</strong>:
            </p>
            <ol style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: '0.88rem', lineHeight: 1.55 }}>
              <li>
                Cloudflare-Dashboard, über „Back to Domains“ zur Kontoübersicht, dann in der linken
                Leiste <strong>Compute → Email Service → Email Routing</strong>. Direktlink:{' '}
                <a
                  href="https://dash.cloudflare.com/?to=/:account/email-service/routing"
                  target="_blank"
                  rel="noreferrer"
                >
                  dash.cloudflare.com/?to=/:account/email-service/routing
                </a>
              </li>
              <li>
                <strong>Onboard Domain</strong>, dann <code>{domain}</code> auswählen. Cloudflare legt
                die nötigen DNS-Einträge für MX, SPF und DKIM selbst an.
              </li>
              <li>
                Reiter <strong>Destination Addresses</strong>: das Postfach eintragen, das die E-Mails
                erhalten soll. Cloudflare schickt dorthin eine Bestätigungs-E-Mail, dort „Verify email
                address“ anklicken.
              </li>
              <li>
                Reiter <strong>Routing Rules</strong>, dann <strong>Create routing rule</strong>: Email
                pattern <code>{localPart}</code> mit Domain <code>{domain}</code>, Action „Send to an
                email“, Destination = die bestätigte Adresse, dann Save.
              </li>
              <li>
                Testen: Eine E-Mail an{' '}
                <code>
                  {localPart}@{domain}
                </code>{' '}
                schicken. Sie muss im Zielpostfach ankommen. Das Ziel lässt sich in Cloudflare jederzeit
                ändern.
              </li>
            </ol>
            <p style={{ margin: '8px 0 0', fontSize: '0.82rem', lineHeight: 1.5 }} className="muted">
              Ausführlich, mit Hinweisen zum Antworten aus dem eigenen Postfach:{' '}
              <code>docs/04-email-smtp.md</code>, Abschnitt 4.7.
            </p>
          </div>
        </div>

        <div className="card mb" style={{ maxWidth: 720 }}>
          <h2>Absender der E-Mails</h2>
          <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
            Was die Eltern im „Von“-Feld sehen, wenn die App eine Einladung, eine Bestellbestätigung
            oder einen Zugangscode verschickt. Trägst du hier dieselbe Adresse ein wie oben als
            Kontaktadresse, landet eine Antwort direkt dort. Es gibt dann keinen
            „no-reply“-Absender mehr.
          </p>
          <div className="row" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div className="field" style={{ minWidth: 200, flex: '1 1 200px' }}>
              <label htmlFor="sender-name">Anzeigename (optional)</label>
              <input
                id="sender-name"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                placeholder="z. B. Photographic"
              />
            </div>
            <div className="field" style={{ minWidth: 240, flex: '1 1 240px' }}>
              <label htmlFor="sender-email">Absenderadresse</label>
              <input
                id="sender-email"
                type="email"
                value={senderEmail}
                onChange={(e) => setSenderEmail(e.target.value)}
                placeholder="z. B. photographic@alae.app"
              />
            </div>
          </div>
          {contactEmail.trim() && !sameAsContact && (
            <button
              type="button"
              className="btn secondary small"
              onClick={() => setSenderEmail(contactEmail.trim())}
            >
              Kontaktadresse als Absender übernehmen
            </button>
          )}
          <p className="muted" style={{ fontSize: '0.8rem', marginTop: 10, marginBottom: 0 }}>
            Die Eltern sehen:{' '}
            <strong>{senderName.trim() ? `${senderName.trim()} <${senderEmail}>` : senderEmail || '—'}</strong>
            {sameAsContact ? ' – Antworten gehen direkt an diese Adresse.' : ''}
          </p>
          <p className="muted" style={{ fontSize: '0.8rem', marginTop: 6, marginBottom: 0 }}>
            Wichtig: Die Domain{senderDomain ? ` ${senderDomain}` : ''} muss bei deinem Mail-Anbieter
            (Resend) als Absender-Domain verifiziert sein, sonst weist er den Versand ab. Solange du
            innerhalb derselben, bereits verifizierten Domain bleibst, ist nichts weiter zu tun.
          </p>
        </div>

        <div className="card mb" style={{ maxWidth: 720 }}>
          <h2>Versandpauschale für gedruckte Produkte</h2>
          <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
            Wird einmal pro Bestellung verrechnet, sobald mindestens ein Produkt per Post verschickt
            wird, also Drucke, Sticker oder Magnete, unabhängig von der Anzahl. Rein digitale
            Bestellungen sind versandfrei. Die Pauschale erscheint schon bei der Produktauswahl, im
            Warenkorb und als eigene Position auf der Bezahlseite.
          </p>
          <div className="field" style={{ maxWidth: 260, marginBottom: 0 }}>
            <label htmlFor="shipping-fee">Betrag in {currency.toUpperCase()}</label>
            <input
              id="shipping-fee"
              inputMode="decimal"
              value={shippingFee}
              onChange={(e) => setShippingFee(e.target.value)}
              placeholder="3.50"
            />
            <p className="muted" style={{ fontSize: '0.8rem', marginTop: 6, marginBottom: 0 }}>
              Aktuell gespeichert: {data ? formatPrice(data.settings.shipping_fee_cents, currency) : '—'}{' '}
              {currency.toUpperCase()}. 0 bedeutet: keine Pauschale.
            </p>
          </div>
        </div>

        <button className="btn" disabled={busy}>
          {busy ? 'Speichern …' : 'Einstellungen speichern'}
        </button>
      </form>

      <h2 style={{ marginTop: 36 }}>Benachrichtigungen</h2>
      <NotificationSettingsCard kind="report" />

      <EmailDeliveries />
    </div>
  );
}
