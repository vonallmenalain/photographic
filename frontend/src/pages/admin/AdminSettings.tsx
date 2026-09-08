import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { Alert, Spinner } from '../../components/common';
import { formatPrice } from '../../lib/format';
import type { AppSettings, SettingsResponse } from './NotificationSettings';

/** "3.50" -> 350 (Rappen); toleriert Komma und Leerzeichen. */
function parseFrancs(value: string): number | null {
  const cleaned = value.replace(/\s/g, '').replace(',', '.');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/**
 * Einstellungen des Adminbereichs, die früher nur in der .env lagen: die
 * öffentliche Kontaktadresse (Impressum, Hilfe-Seite, Antwortadresse aller
 * E-Mails) und die Versandpauschale für gedruckte Produkte. Die
 * Benachrichtigungen (neue Meldung, Zustellprobleme) werden unter „Meldungen“
 * eingestellt.
 */
export default function AdminSettings() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [contactEmail, setContactEmail] = useState('');
  const [shippingFee, setShippingFee] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<SettingsResponse>('/api/admin/settings', { admin: true })
      .then((r) => {
        setData(r);
        setContactEmail(r.settings.contact_email);
        setShippingFee((r.settings.shipping_fee_cents / 100).toFixed(2));
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
      setError('Bitte gib die Versandpauschale als Betrag ein, z. B. 3.50 (0 = kein Versand verrechnen).');
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ settings: AppSettings }>('/api/admin/settings', {
        method: 'PUT',
        admin: true,
        body: { contact_email: contactEmail.trim(), shipping_fee_cents: fee },
      });
      setData((d) => (d ? { ...d, settings: res.settings } : d));
      setContactEmail(res.settings.contact_email);
      setShippingFee((res.settings.shipping_fee_cents / 100).toFixed(2));
      setSuccess('Einstellungen gespeichert. Sie gelten sofort – auch im Impressum und für neue Warenkörbe.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner label="Einstellungen werden geladen …" />;

  const currency = data?.currency ?? 'chf';
  const mailFrom = data?.mailFrom ?? '';
  const domain = contactEmail.includes('@') ? contactEmail.split('@')[1] : 'alae.app';
  const localPart = contactEmail.includes('@') ? contactEmail.split('@')[0] : 'photographic';

  return (
    <div>
      <h1>Einstellungen</h1>
      <p className="soft">
        Kontaktadresse und Versandpauschale der App. Die Benachrichtigungen per E-Mail (neue Meldung,
        nicht zustellbare E-Mails) stellst du unter <Link to="/admin/reports">Meldungen</Link> ein.
      </p>

      {error && <Alert kind="error">{error}</Alert>}
      {success && <Alert kind="success">{success}</Alert>}

      <form onSubmit={save}>
        <div className="card mb" style={{ maxWidth: 720 }}>
          <h2>Kontakt-E-Mail-Adresse</h2>
          <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
            Diese Adresse steht im <Link to="/impressum" target="_blank" rel="noreferrer">Impressum</Link>{' '}
            und auf der Hilfe-Seite (anstelle einer Telefonnummer). Ausserdem ist sie die
            Antwortadresse aller E-Mails, welche die App verschickt: Antwortet eine Familie auf eine
            Einladung oder Bestellbestätigung, landet die Antwort hier – und nicht beim Absender{' '}
            <code>{mailFrom || 'no-reply@…'}</code>.
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
              Leer lassen, um im Impressum keine E-Mail-Adresse anzuzeigen
              {data?.defaults.contact_email ? ` (Startwert aus der .env: ${data.defaults.contact_email})` : ''}.
            </p>
          </div>

          <div className="alert info" style={{ marginBottom: 0 }}>
            <strong>Wohin gehen E-Mails, die an diese Adresse geschickt werden?</strong>
            <p style={{ margin: '6px 0 0', fontSize: '0.88rem', lineHeight: 1.55 }}>
              Die App verschickt E-Mails, empfängt aber keine. Damit E-Mails an{' '}
              <code>
                {localPart}@{domain}
              </code>{' '}
              in deinem Postfach ankommen, richtest du bei Cloudflare (dort liegt die Domain{' '}
              <code>{domain}</code>) einmalig eine kostenlose Weiterleitung ein. Email Routing steht in
              der Cloudflare-Oberfläche nicht beim Domain-Menü „E-Mail“ (dort gibt es nur DMARC
              Management und Email Security), sondern kontoweit unter <strong>Compute</strong>:
            </p>
            <ol style={{ margin: '8px 0 0', paddingLeft: 20, fontSize: '0.88rem', lineHeight: 1.55 }}>
              <li>
                Cloudflare-Dashboard → über „Back to Domains“ zur Kontoübersicht → in der linken Leiste{' '}
                <strong>Compute → Email Service → Email Routing</strong>. Direktlink:{' '}
                <a href="https://dash.cloudflare.com/?to=/:account/email-service/routing" target="_blank" rel="noreferrer">
                  dash.cloudflare.com/?to=/:account/email-service/routing
                </a>
                .
              </li>
              <li>
                <strong>Onboard Domain</strong> → <code>{domain}</code> auswählen. Cloudflare legt die
                nötigen DNS-Einträge (MX, SPF, DKIM) selbst an.
              </li>
              <li>
                Reiter <strong>Destination Addresses</strong>: das Postfach eintragen, das die E-Mails
                erhalten soll (z. B. die E-Mail-Adresse eines Admin-Kontos). Cloudflare schickt dorthin
                eine Bestätigungs-E-Mail – „Verify email address“ anklicken.
              </li>
              <li>
                Reiter <strong>Routing Rules</strong> → <strong>Create routing rule</strong>: Email pattern{' '}
                <code>{localPart}</code> mit Domain <code>{domain}</code>, Action „Send to an email“,
                Destination = die bestätigte Adresse → Save.
              </li>
              <li>
                Testen: Eine E-Mail an{' '}
                <code>
                  {localPart}@{domain}
                </code>{' '}
                schicken – sie muss im Zielpostfach ankommen. Das Ziel lässt sich in Cloudflare jederzeit
                ändern.
              </li>
            </ol>
            <p style={{ margin: '8px 0 0', fontSize: '0.82rem', lineHeight: 1.5 }} className="muted">
              Ausführlich mit Hinweisen zum Antworten aus dem eigenen Postfach: <code>docs/04-email-smtp.md</code>,
              Abschnitt 4.7.
            </p>
          </div>
        </div>

        <div className="card mb" style={{ maxWidth: 720 }}>
          <h2>Versandpauschale für gedruckte Produkte</h2>
          <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
            Wird einmal pro Bestellung verrechnet, sobald mindestens ein Produkt per Post verschickt wird
            (Drucke, Sticker, Magnete) – unabhängig von der Anzahl. Rein digitale Bestellungen sind
            versandfrei. Die Pauschale wird schon bei der Produktauswahl angezeigt, im Warenkorb separat
            ausgewiesen und auf der Bezahlseite als eigene Position aufgeführt.
          </p>
          <div className="field" style={{ maxWidth: 260 }}>
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
              {currency.toUpperCase()}. 0 = keine Pauschale.
            </p>
          </div>
        </div>

        <button className="btn" disabled={busy}>
          {busy ? 'Speichern …' : 'Einstellungen speichern'}
        </button>
      </form>
    </div>
  );
}
