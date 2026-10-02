import { Link } from 'react-router-dom';
import { formatPrice } from '../../lib/format';
import { BUSINESS, BUSINESS_FULL_NAME } from '../../lib/business';
import { paymentMethodLabels, useSiteInfo } from '../../lib/siteInfo';

/**
 * Impressum mit den Pflichtangaben zum Betreiber sowie den Eckpunkten von
 * Verkauf, Zahlung und Lieferung. Diese Angaben verlangen Zahlungsanbieter
 * (u. a. TWINT) ausdrücklich, bevor sie eine Zahlungsart freischalten:
 * Firmenname und Rechtsform, vollständige Geschäftsadresse, mindestens eine
 * Kontaktmöglichkeit, Preise in CHF und – bei physischen Produkten – die
 * Schweiz als Lieferziel.
 *
 * Anbieterangaben inkl. E-Mail-Adresse stehen fest im Code (lib/business.ts),
 * damit sie auch ohne erreichbare API sichtbar sind. Die zusätzliche
 * Kontaktadresse für Fotofragen, die Versandpauschale und die Zahlungsarten
 * kommen aus dem öffentlichen Endpunkt /api/parent/site.
 */
export default function Imprint() {
  const site = useSiteInfo();
  const contactEmail = site?.contactEmail ?? '';
  const shippingFee = site?.shippingFeeCents ?? 0;
  const currency = (site?.currency ?? 'chf').toUpperCase();
  const methods = paymentMethodLabels(site?.paymentMethods ?? []);
  return (
    <div className="narrow" style={{ margin: '0 auto' }}>
      <h1>Impressum</h1>
      <div className="card">
        <h2>Betreiberin dieser Website</h2>
        <p>
          <strong>{BUSINESS_FULL_NAME}</strong>
          <br />
          {BUSINESS.legalForm}
          <br />
          {BUSINESS.street}
          <br />
          {BUSINESS.zipCity}
          <br />
          {BUSINESS.country}
        </p>
        <p>
          E-Mail: <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a>
          <br />
          {contactEmail && contactEmail !== BUSINESS.email ? (
            <>
              Fragen zu Fotos und Bestellungen:{' '}
              <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
              <br />
            </>
          ) : null}
          Kontaktformular: <Link to="/hilfe">Hilfe &amp; Kontakt</Link>
          <br />
          Website:{' '}
          <a href={BUSINESS.website} target="_blank" rel="noopener noreferrer">
            {BUSINESS.websiteLabel}
          </a>
        </p>
        <p>
          {BUSINESS.platform} ist die Bestellplattform von {BUSINESS_FULL_NAME}. Verantwortlich für
          den Inhalt dieser Website ist {BUSINESS.owner} unter der oben genannten Adresse. Für
          Bestellungen gelten die <Link to="/agb">Allgemeinen Geschäftsbedingungen</Link>.
        </p>

        <h2>Was hier verkauft wird</h2>
        <p>
          Über diese Website beziehen Familien die Fotos, die bei Foto-Terminen in Schulen und
          Kindergärten entstanden sind. Angeboten werden digitale Downloads sowie gedruckte
          Produkte: Abzüge in 13×18 cm und 20×30 cm, Sticker-Bogen und Magnete-Sets. Bei den
          Abzügen ist die digitale Datei desselben Fotos jeweils inbegriffen.
        </p>
        <p>
          Sichtbar und bestellbar sind ausschliesslich Fotos, die der bestätigten E-Mail-Adresse
          zugeordnet sind. Wie der Zugang geschützt ist, steht unter{' '}
          <Link to="/datenschutz">Datenschutz &amp; Vertrauen</Link>.
        </p>

        <h2>Preise</h2>
        <p>
          Alle Preise verstehen sich in <strong>Schweizer Franken (CHF)</strong>. Die Preisliste steht
          auf der <Link to="/#preise">Startseite</Link>; die Preise werden zudem im Warenkorb sowie während des gesamten Bezahlvorgangs in CHF angezeigt. Massgebend ist der
          Preis, der zum Zeitpunkt der Bestellung im Warenkorb steht. Bei mehreren Stück desselben
          Produkts und Fotos gilt der ausgewiesene Preis für jedes weitere Stück.
        </p>

        <h2>Zahlung</h2>
        <p>
          Die Zahlung erfolgt vor der Lieferung über unseren Zahlungsdienstleister Stripe
          {methods.length ? <> – mit {methods.join(', ')}</> : null}. Dabei werden die
          Zahlungsdaten direkt von Stripe verarbeitet; wir sehen und speichern keine Kartendaten.
          Welche Zahlungsarten im Einzelfall zur Verfügung stehen, wird auf der Bezahlseite
          angezeigt.
        </p>

        <h2>Lieferung</h2>
        <p>
          <strong>Digitale Downloads</strong> werden unmittelbar nach erfolgreicher Zahlung
          freigeschaltet und stehen unter „Bestellungen“ in voller Auflösung bereit.
        </p>
        <p>
          <strong>Gedruckte Produkte</strong> werden nach der Bestellung produziert und per Post an
          die angegebene Lieferadresse versandt. Wir liefern in die <strong>Schweiz</strong>.
          {shippingFee > 0 ? (
            <>
              {' '}
              Für den Versand wird pro Bestellung eine Pauschale von{' '}
              <strong>
                {formatPrice(shippingFee, currency)} {currency}
              </strong>{' '}
              verrechnet – einmalig, unabhängig von der Anzahl der gedruckten Produkte. Sie wird bereits
              bei der Produktauswahl, im Warenkorb und auf der Bezahlseite ausgewiesen. Digitale
              Downloads sind versandfrei.
            </>
          ) : null}
        </p>
        <p>
          Die Fotos stehen während 30 Tagen zur Verfügung und werden danach archiviert. Eine
          spätere Nachbestellung ist auf Anfrage möglich.
        </p>

        <h2>Rückgabe, Mängel und Reklamationen</h2>
        <p>
          Gedruckte Produkte sind personalisierte Einzelanfertigungen und digitale Downloads sind
          sofort nach der Zahlung verfügbar; ein Widerruf, eine Rückgabe oder ein Umtausch ist nach
          abgeschlossener Zahlung daher ausgeschlossen (siehe <Link to="/agb">AGB</Link>, Ziffer 6).
        </p>
        <p>
          Sollte etwas nicht stimmen – ein beschädigter oder fehlerhafter Druck, eine falsche
          Zuordnung, ein Problem beim Download –, melden Sie sich bitte über{' '}
          <Link to="/hilfe">Hilfe &amp; Kontakt</Link>
          {contactEmail ? (
            <>
              {' '}
              oder per E-Mail an <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
            </>
          ) : null}
          . Wir suchen in jedem Fall eine faire Lösung und ersetzen fehlerhafte Drucke.
        </p>

        <h2>Urheberrecht</h2>
        <p>
          Die Fotos bleiben urheberrechtlich geschützt. Mit dem Kauf erhalten Sie das Recht, die
          Bilder für private Zwecke zu nutzen, zu drucken und im Familien- und Bekanntenkreis zu
          teilen. Eine gewerbliche Nutzung sowie die Weitergabe an Dritte ausserhalb des privaten
          Umfelds sind nicht gestattet.
        </p>
      </div>
    </div>
  );
}
