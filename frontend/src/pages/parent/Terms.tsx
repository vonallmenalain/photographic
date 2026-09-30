import { Link } from 'react-router-dom';
import { formatPrice } from '../../lib/format';
import { BUSINESS, BUSINESS_FULL_NAME } from '../../lib/business';
import { paymentMethodLabels, useSiteInfo } from '../../lib/siteInfo';

/**
 * Allgemeine Geschäftsbedingungen für Bestellungen über diese Plattform.
 *
 * Grundlage sind die AGB von CreArt (creart.ch), angepasst an den Ablauf hier:
 * Vorauszahlung online über Stripe statt Rechnung, digitale Downloads und
 * personalisierte Drucke, Lieferung in die Schweiz. Die Anbieterangaben
 * (Name, Rechtsform, Adresse, E-Mail) stehen bewusst auch hier – Stripe/TWINT
 * verlangen sie im Impressum oder in den AGB.
 */
export default function Terms() {
  const site = useSiteInfo();
  const currency = (site?.currency ?? 'chf').toUpperCase();
  const shippingFee = site?.shippingFeeCents ?? 0;
  const retentionDays = site?.retentionDays ?? 30;
  const methods = paymentMethodLabels(site?.paymentMethods ?? []);

  return (
    <div className="narrow-wide" style={{ margin: '0 auto', maxWidth: 760 }}>
      <h1>Allgemeine Geschäftsbedingungen (AGB)</h1>
      <div className="card">
        <h2>1. Anbieter und Geltungsbereich</h2>
        <p>
          Diese AGB gelten für alle Bestellungen über die Bestellplattform {BUSINESS.platform}. Anbieter
          und Vertragspartner ist:
        </p>
        <p>
          <strong>{BUSINESS_FULL_NAME}</strong>
          <br />
          {BUSINESS.legalForm} von {BUSINESS.owner}
          <br />
          {BUSINESS.street}
          <br />
          {BUSINESS.zipCity}
          <br />
          {BUSINESS.country}
          <br />
          E-Mail: <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a>
        </p>
        <p>
          Ergänzend gelten die Allgemeinen Geschäftsbedingungen von CreArt (
          <a href={BUSINESS.website} target="_blank" rel="noopener noreferrer">
            {BUSINESS.websiteLabel}
          </a>
          ). Wo sich die beiden widersprechen, gehen diese AGB für Bestellungen über{' '}
          {BUSINESS.platform} vor. Gegenbestätigungen unter Hinweis auf eigene Geschäfts- oder
          Einkaufsbedingungen wird widersprochen. Abweichungen von diesen AGB gelten nur, wenn CreArt
          sie schriftlich bestätigt hat.
        </p>

        <h2>2. Angebot und Vertragsschluss</h2>
        <p>
          Über {BUSINESS.platform} beziehen Familien die Fotos, die bei Foto-Terminen in Schulen und
          Kindergärten entstanden sind: digitale Downloads sowie gedruckte Produkte (Fotoabzüge,
          Sticker-Bogen, Magnete-Sets). Bei Fotoabzügen ist die digitale Datei desselben Fotos
          inbegriffen. Das aktuelle Sortiment mit Preisen steht auf der{' '}
          <Link to="/">Startseite</Link>.
        </p>
        <p>
          Sichtbar und bestellbar sind ausschliesslich Fotos, die der bestätigten E-Mail-Adresse der
          bestellenden Person zugeordnet sind. Die Vorschaubilder tragen ein Wasserzeichen und haben
          eine reduzierte Auflösung; geringe Farbabweichungen zwischen Bildschirm und Druck sind
          möglich und kein Mangel.
        </p>
        <p>
          Der Vertrag kommt zustande, sobald die Zahlung auf der Bezahlseite erfolgreich
          abgeschlossen ist. Die Bestellung wird per E-Mail bestätigt und ist unter „Bestellungen“
          einsehbar.
        </p>

        <h2>3. Preise und Versandkosten</h2>
        <p>
          Alle Preise verstehen sich in <strong>Schweizer Franken (CHF)</strong>. Massgebend ist der
          Preis, der zum Zeitpunkt der Bestellung im Warenkorb und auf der Bezahlseite angezeigt
          wird. Abweichende Preise, die aus Zwischenspeichern (Browser-Cache, Proxies) geladen
          werden, sind nicht aktuell und ungültig. Die Korrektur offensichtlicher Tipp- oder
          Rechenfehler bleibt vorbehalten.
        </p>
        <p>
          Bei mehreren Stück desselben Fotos im selben Produkt gilt für jedes weitere Stück der
          ausgewiesene Folgepreis.
          {shippingFee > 0 ? (
            <>
              {' '}
              Für Bestellungen mit gedruckten Produkten wird pro Bestellung einmalig eine
              Versandpauschale von{' '}
              <strong>
                {formatPrice(shippingFee, currency)} {currency}
              </strong>{' '}
              verrechnet und bereits im Warenkorb ausgewiesen. Digitale Downloads sind versandfrei.
            </>
          ) : null}{' '}
          Veranlasst CreArt eine Teillieferung, erfolgen Nachlieferungen versandkostenfrei.
        </p>

        <h2>4. Zahlung</h2>
        <p>
          Die Zahlung erfolgt im Voraus online über den Zahlungsdienstleister Stripe
          {methods.length ? <> – mit {methods.join(', ')}</> : null}. Welche Zahlungsarten im
          Einzelfall zur Verfügung stehen, zeigt die Bezahlseite. Die Zahlungsdaten werden direkt von
          Stripe verarbeitet; CreArt sieht und speichert keine Kartendaten. Eine Bestellung auf
          Rechnung ist über diese Plattform nicht möglich.
        </p>

        <h2>5. Lieferung</h2>
        <p>
          <strong>Digitale Downloads</strong> werden unmittelbar nach erfolgreicher Zahlung
          freigeschaltet und stehen unter „Bestellungen“ in voller Auflösung zum Herunterladen bereit.
          Die Fotos stehen während {retentionDays} Tagen ab Veröffentlichung zur Verfügung und werden
          danach archiviert; eine spätere Nachbestellung ist auf Anfrage möglich.
        </p>
        <p>
          <strong>Gedruckte Produkte</strong> werden nach der Bestellung produziert und per Post an
          die angegebene Lieferadresse versandt. Geliefert wird in die <strong>Schweiz</strong>.
        </p>
        <p>
          Ist eine Lieferung aus Gründen, die CreArt nicht zu vertreten hat, unmöglich, kann CreArt
          vom Vertrag zurücktreten; bereits bezahlte Beträge werden in diesem Fall vollständig
          zurückerstattet. Weitergehende Schadenersatzansprüche sind ausgeschlossen.
        </p>

        <h2>6. Rücktritt, Widerruf und Umtausch</h2>
        <p>
          Bis zum Abschluss der Zahlung kann eine Bestellung jederzeit ohne Angabe von Gründen
          abgebrochen werden; es entstehen keine Kosten.
        </p>
        <p>
          Gedruckte Produkte werden eigens für die Kundin bzw. den Kunden aus den persönlichen Fotos
          hergestellt, und digitale Downloads werden sofort nach der Zahlung bereitgestellt. Nach
          abgeschlossener Zahlung besteht deshalb kein Widerrufs-, Rückgabe- oder Umtauschrecht; das
          in den allgemeinen AGB von CreArt vorgesehene Widerrufsrecht gilt für diese
          personalisierten Produkte nicht. Die Rechte bei Mängeln (Ziffer 7) bleiben vorbehalten.
        </p>

        <h2>7. Mängel und Reklamationen</h2>
        <p>
          Sollte etwas nicht stimmen – ein beschädigter oder fehlerhafter Druck, eine falsche
          Zuordnung, ein Problem beim Download –, melden Sie sich bitte möglichst rasch nach Erhalt
          über <Link to="/hilfe">Hilfe &amp; Kontakt</Link> oder per E-Mail an{' '}
          <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a>. Fehlerhafte Drucke werden
          kostenlos ersetzt; ist ein Ersatz nicht möglich, wird der bezahlte Betrag zurückerstattet.
          Keine Gewähr besteht für gewöhnliche Abnutzung sowie für Schäden durch unsachgemässe
          Behandlung.
        </p>

        <h2>8. Urheber- und Nutzungsrechte</h2>
        <p>
          Die Fotos bleiben urheberrechtlich geschützt. Mit dem Kauf erhalten Sie das Recht, die
          Bilder für private Zwecke zu nutzen, zu drucken und im Familien- und Bekanntenkreis zu
          teilen. Eine gewerbliche Nutzung sowie die Weitergabe an Dritte ausserhalb des privaten
          Umfelds sind nicht gestattet.
        </p>

        <h2>9. Datenschutz</h2>
        <p>
          CreArt bearbeitet die im Zusammenhang mit der Bestellung erhaltenen Daten nach dem
          Schweizer Datenschutzgesetz und verwendet sie zur Abwicklung der Bestellung und allfälliger
          Reklamationen. Die E-Mail-Adresse dient dem Zugang zu den Fotos und Mitteilungen zu den
          Bestellungen; für Werbung wird sie nicht verwendet. Personendaten werden nicht an Dritte
          weitergegeben, ausser soweit es für die Abwicklung nötig ist (Zahlung über Stripe, Versand
          per Post). Sie haben das Recht auf Auskunft, Berichtigung und Löschung Ihrer Daten.
          Einzelheiten stehen unter <Link to="/datenschutz">Datenschutz &amp; Vertrauen</Link>.
        </p>

        <h2>10. Anwendbares Recht und Gerichtsstand</h2>
        <p style={{ marginBottom: 0 }}>
          Es gilt Schweizer Recht. Gerichtsstand ist Burgdorf; zwingende Gerichtsstände für
          Konsumentinnen und Konsumenten bleiben vorbehalten.
        </p>
      </div>
      <p className="muted" style={{ marginTop: 14, fontSize: '0.85rem' }}>
        Stand: September 2026 · <Link to="/impressum">Impressum</Link>
      </p>
    </div>
  );
}
