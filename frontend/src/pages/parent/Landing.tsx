import { useEffect, useRef, useState, type RefObject } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { useParentAuth } from '../../context/ParentAuth';
import { Alert, TrustNote } from '../../components/common';
import { firebaseEnabled, sendParentSignInLink } from '../../lib/firebase';
import { BUSINESS, BUSINESS_FULL_NAME } from '../../lib/business';
import { formatPrice } from '../../lib/format';
import { paymentMethodLabels, useSiteInfo } from '../../lib/siteInfo';

/** Öffentliche Preisliste (GET /api/parent/products, ohne Login). */
interface PublicProduct {
  id: string;
  name: string;
  description: string;
  type: 'digital' | 'print';
  price_cents: number;
  additional_price_cents: number | null;
  scope: 'all' | 'portrait' | 'group';
  currency: string;
}

/**
 * Sprungmarke zur Preisliste. AGB und Impressum verlinken `/#preise`; dann sind
 * die weiteren Informationen gleich aufgeklappt und die Preisliste im Blick.
 */
const PRICES_HASH = '#preise';

/**
 * Startseite: Anmeldung mit der E-Mail-Adresse. Ablauf, Preisliste, Zahlung &
 * Lieferung und Anbieter stehen zugeklappt unter „Weitere Informationen“ –
 * öffentlich erreichbar, wie es Zahlungsanbieter (u. a. TWINT über Stripe)
 * verlangen, aber nicht im Vordergrund. Die Fotos selbst erscheinen erst nach
 * der Bestätigung der E-Mail-Adresse.
 */
export default function Landing() {
  const { verified, loading, next } = useParentAuth();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [showInfo, setShowInfo] = useState(() => hash === PRICES_HASH);
  const [products, setProducts] = useState<PublicProduct[] | null>(null);
  const [shippingFee, setShippingFee] = useState<number | null>(null);
  const pricesRef = useRef<HTMLDivElement>(null);

  // Angemeldete Personen landen auf ihrer Zielseite: offenes Einverständnis,
  // Klassenseite der Lehrperson oder die Fotos.
  useEffect(() => {
    if (!loading && verified) navigate(next || '/galerie', { replace: true });
  }, [verified, loading, next, navigate]);

  // Direktlink /#preise: einmal beim Aufruf zur Preisliste springen. Danach
  // steuert allein der Knopf, damit erneutes Aufklappen nicht wieder springt.
  useEffect(() => {
    if (hash === PRICES_HASH) pricesRef.current?.scrollIntoView({ block: 'start' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Die Preisliste wird erst geladen, wenn jemand die weiteren Informationen öffnet.
  useEffect(() => {
    if (!showInfo || products !== null) return;
    let cancelled = false;
    api<{ products: PublicProduct[]; shipping_fee_cents: number }>('/api/parent/products')
      .then((res) => {
        if (cancelled) return;
        setProducts(res.products);
        setShippingFee(Math.max(0, Number(res.shipping_fee_cents) || 0));
      })
      .catch(() => {
        if (!cancelled) setProducts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [showInfo, products]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setSending(true);
    try {
      if (firebaseEnabled) {
        // Firebase Authentication: send a passwordless e-mail sign-in link.
        await sendParentSignInLink(email);
        sessionStorage.setItem('pending_email', email.trim().toLowerCase());
        setMessage(
          'Wir haben Ihnen einen Anmeldelink an Ihre E-Mail-Adresse gesendet. Bitte öffnen Sie die E-Mail und klicken Sie auf den Link, um Ihre Fotos zu sehen.',
        );
      } else {
        const res = await api<{ message: string }>('/api/parent/request-code', {
          method: 'POST',
          body: { email },
        });
        // Pass the e-mail to the verify page so the code can be checked, and
        // carry the confirmation text along so it is shown there next to the
        // code field. We navigate straight away instead of briefly flashing the
        // message here first – this avoids rendering the same text twice (once
        // green here, once brown on the verify page) and shows the code field
        // right from the start.
        sessionStorage.setItem('pending_email', email.trim().toLowerCase());
        sessionStorage.setItem('pending_message', res.message);
        navigate('/verifizieren');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Es ist ein Fehler aufgetreten.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="narrow-wide" style={{ margin: '0 auto' }}>
      <div className="narrow" style={{ margin: '0 auto' }}>
        <div className="hero">
          <div className="lock-big">🔒</div>
          <h1>Ihre Kinderfotos – sicher &amp; geschützt</h1>
          <p className="soft">
            Geben Sie Ihre E-Mail-Adresse ein. Wir senden Ihnen{' '}
            {firebaseEnabled ? 'einen sicheren Anmeldelink' : 'einen Zugangscode'}, damit nur Sie Ihre
            zugeordneten Fotos sehen können. Die Fotos sind sicher auf einem lokalen Schweizer Server
            gespeichert.
          </p>
        </div>

        <div className="card">
          {message && <Alert kind="success">{message}</Alert>}
          {error && <Alert kind="error">{error}</Alert>}
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="email">E-Mail-Adresse</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="name@beispiel.ch"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <button className="btn block" disabled={sending}>
              {sending
                ? 'Wird gesendet …'
                : firebaseEnabled
                  ? 'Anmeldelink anfordern'
                  : 'Zugangscode anfordern'}
            </button>
          </form>
          <p className="muted center" style={{ marginTop: 14, marginBottom: 0, fontSize: '0.85rem' }}>
            {firebaseEnabled ? 'Schon einen Link erhalten?' : 'Schon einen Code?'}{' '}
            <Link to="/verifizieren">Hier bestätigen</Link>
          </p>
        </div>

        <div style={{ marginTop: 18 }}>
          <TrustNote>
            <strong>Warum eine Bestätigung?</strong> Zum Schutz Ihrer Fotos zeigen wir die Bilder erst
            an, nachdem Ihre E-Mail-Adresse bestätigt wurde. Die Fotos sind genau dieser E-Mail-Adresse
            zugeordnet und können nur nach erfolgreicher Bestätigung angezeigt werden.
          </TrustNote>
        </div>

        <div className="center" style={{ marginTop: 18 }}>
          <button
            type="button"
            className="btn secondary small"
            aria-expanded={showInfo}
            aria-controls="weitere-informationen"
            onClick={() => setShowInfo((open) => !open)}
          >
            {showInfo ? 'Weitere Informationen ausblenden' : 'Weitere Informationen'}
            <span aria-hidden="true">{showInfo ? '▴' : '▾'}</span>
          </button>
        </div>
      </div>

      <div id="weitere-informationen">
        {showInfo && (
          <MoreInfo products={products} shippingFee={shippingFee} pricesRef={pricesRef} />
        )}
      </div>
    </div>
  );
}

/**
 * Die aufgeklappten Kacheln unter „Weitere Informationen“: Ablauf der
 * Bestellung, Preisliste in CHF (live aus dem Sortiment), Zahlung & Lieferung
 * sowie Anbieter & Kontakt.
 */
function MoreInfo({
  products,
  shippingFee,
  pricesRef,
}: {
  products: PublicProduct[] | null;
  shippingFee: number | null;
  pricesRef: RefObject<HTMLDivElement>;
}) {
  const site = useSiteInfo();
  const currency = (site?.currency ?? 'chf').toUpperCase();
  const fee = shippingFee ?? site?.shippingFeeCents ?? 0;
  const methods = paymentMethodLabels(site?.paymentMethods ?? []);

  return (
    <div style={{ marginTop: 18 }}>
      <div className="card">
        <h2>So funktioniert die Bestellung</h2>
        <ol>
          <li>
            Nach dem Foto-Termin in der Schule oder im Kindergarten ordnen wir die Fotos Ihres Kindes
            Ihrer E-Mail-Adresse zu und benachrichtigen Sie per E-Mail.
          </li>
          <li>
            Sie bestätigen hier Ihre E-Mail-Adresse und sehen die Fotos als Vorschau mit
            Wasserzeichen.
          </li>
          <li>Sie wählen Fotos und Produkte aus und legen sie in den Warenkorb.</li>
          <li>
            Sie bezahlen im Voraus online über unseren Zahlungsdienstleister Stripe. Alle Preise
            werden in Schweizer Franken (CHF) angezeigt.
          </li>
          <li>
            Digitale Fotos stehen sofort nach der Zahlung zum Download bereit. Gedruckte Produkte
            werden produziert und per Post an Ihre Adresse in der Schweiz geschickt.
          </li>
        </ol>
      </div>

      {/* Unter der fixierten Kopfzeile (64px) bleibt die Überschrift sichtbar. */}
      <div className="card" id="preise" ref={pricesRef} style={{ scrollMarginTop: 84 }}>
        <h2>Angebot &amp; Preise</h2>
        {products === null ? (
          <p className="muted">Preisliste wird geladen …</p>
        ) : products.length === 0 ? (
          <p className="muted">
            Die Preisliste ist im Moment nicht verfügbar. Die aktuellen Preise in CHF sehen Sie bei
            der Auswahl der Fotos und im Warenkorb.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Produkt</th>
                  <th style={{ textAlign: 'right' }}>Preis ({currency})</th>
                </tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.name}</strong>
                      {p.scope === 'portrait' ? (
                        <span className="muted"> · nur für Einzelfotos</span>
                      ) : p.scope === 'group' ? (
                        <span className="muted"> · nur für Gruppenfotos</span>
                      ) : null}
                      {p.description ? (
                        <div className="muted" style={{ fontSize: '0.85rem' }}>
                          {p.description}
                        </div>
                      ) : null}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {formatPrice(p.price_cents, p.currency || 'chf')} {(p.currency || 'chf').toUpperCase()}
                      {p.additional_price_cents !== null &&
                      p.additional_price_cents !== p.price_cents ? (
                        <div className="muted" style={{ fontSize: '0.85rem' }}>
                          jedes weitere Stück +{formatPrice(p.additional_price_cents, p.currency || 'chf')}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="soft" style={{ marginTop: 14, marginBottom: 0, fontSize: '0.9rem' }}>
          Alle Preise in Schweizer Franken (CHF). „Jedes weitere Stück“ gilt für weitere Exemplare
          desselben Fotos im selben Produkt.
          {fee > 0 ? (
            <>
              {' '}
              Für gedruckte Produkte wird pro Bestellung einmalig eine Versandpauschale von{' '}
              {formatPrice(fee, currency)} {currency} verrechnet; digitale Downloads sind versandfrei.
            </>
          ) : null}
        </p>
      </div>

      <div className="card">
        <h2>Zahlung &amp; Lieferung</h2>
        <p>
          <strong>Zahlung:</strong> im Voraus online über Stripe
          {methods.length ? <> – mit {methods.join(', ')}</> : null}. Die Bestellung wird erst nach
          erfolgreicher Zahlung ausgeführt.
        </p>
        <p>
          <strong>Lieferung:</strong> Digitale Downloads sind sofort nach der Zahlung unter
          „Bestellungen“ verfügbar. Gedruckte Produkte senden wir per Post; wir liefern in die{' '}
          <strong>Schweiz</strong>.
        </p>
        <p style={{ marginBottom: 0 }}>
          Einzelheiten stehen in den <Link to="/agb">Allgemeinen Geschäftsbedingungen</Link>.
        </p>
      </div>

      <div className="card">
        <h2>Anbieter &amp; Kontakt</h2>
        <p style={{ marginBottom: 8 }}>
          <strong>{BUSINESS_FULL_NAME}</strong>, {BUSINESS.legalForm}
          <br />
          {BUSINESS.street}, {BUSINESS.zipCity}, {BUSINESS.country}
          <br />
          E-Mail: <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a>
          <br />
          Website:{' '}
          <a href={BUSINESS.website} target="_blank" rel="noopener noreferrer">
            {BUSINESS.websiteLabel}
          </a>
        </p>
        <p className="muted" style={{ marginBottom: 0, fontSize: '0.9rem' }}>
          <Link to="/impressum">Impressum</Link> · <Link to="/agb">AGB</Link> ·{' '}
          <Link to="/datenschutz">Datenschutz</Link> · <Link to="/hilfe">Hilfe &amp; Kontakt</Link>
        </p>
      </div>
    </div>
  );
}
