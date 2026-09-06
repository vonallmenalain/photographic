import { Link } from 'react-router-dom';

/**
 * Impressum mit den Pflichtangaben zum Betreiber sowie den Eckpunkten von
 * Verkauf, Zahlung und Lieferung. Diese Angaben verlangen Zahlungsanbieter
 * (u. a. TWINT) ausdrücklich, bevor sie eine Zahlungsart freischalten:
 * Firmenname und Rechtsform, vollständige Geschäftsadresse, mindestens eine
 * Kontaktmöglichkeit, Preise in CHF und – bei physischen Produkten – die
 * Schweiz als Lieferziel.
 */
export default function Imprint() {
  return (
    <div className="narrow" style={{ margin: '0 auto' }}>
      <h1>Impressum</h1>
      <div className="card">
        <h2>Betreiberin dieser Website</h2>
        <p>
          <strong>CreArt – Beatrice von Allmen</strong>
          <br />
          Einzelunternehmen
          <br />
          Schlossmattstrasse 4
          <br />
          3400 Burgdorf
          <br />
          Schweiz
        </p>
        <p>
          Telefon: <a href="tel:+41344228634">034 422 86 34</a>
          <br />
          Kontaktformular: <Link to="/hilfe">Hilfe &amp; Kontakt</Link>
        </p>
        <p>
          Verantwortlich für den Inhalt dieser Website ist Beatrice von Allmen unter der oben
          genannten Adresse.
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
          Alle Preise verstehen sich in <strong>Schweizer Franken (CHF)</strong> und werden im
          Warenkorb sowie während des gesamten Bezahlvorgangs in CHF angezeigt. Massgebend ist der
          Preis, der zum Zeitpunkt der Bestellung im Warenkorb steht. Bei mehreren Stück desselben
          Produkts und Fotos gilt der ausgewiesene Preis für jedes weitere Stück.
        </p>

        <h2>Zahlung</h2>
        <p>
          Die Zahlung erfolgt vor der Lieferung über unseren Zahlungsdienstleister Stripe. Dabei
          werden die Zahlungsdaten direkt von Stripe verarbeitet; wir sehen und speichern keine
          Kartendaten. Welche Zahlungsarten zur Verfügung stehen, wird auf der Bezahlseite
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
        </p>
        <p>
          Die Fotos stehen während 30 Tagen zur Verfügung und werden danach archiviert. Eine
          spätere Nachbestellung ist auf Anfrage möglich.
        </p>

        <h2>Rückgabe, Mängel und Reklamationen</h2>
        <p>
          Gedruckte Produkte sind personalisierte Einzelanfertigungen und digitale Downloads sind
          nach dem Herunterladen nicht rückgabefähig; ein Umtausch ist daher grundsätzlich
          ausgeschlossen.
        </p>
        <p>
          Sollte etwas nicht stimmen – ein beschädigter oder fehlerhafter Druck, eine falsche
          Zuordnung, ein Problem beim Download –, melden Sie sich bitte über{' '}
          <Link to="/hilfe">Hilfe &amp; Kontakt</Link> oder telefonisch. Wir suchen in jedem Fall
          eine faire Lösung und ersetzen fehlerhafte Drucke.
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
