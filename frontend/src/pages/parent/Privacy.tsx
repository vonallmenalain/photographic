import { Link } from 'react-router-dom';

export default function Privacy() {
  return (
    <div className="narrow" style={{ margin: '0 auto' }}>
      <h1>Datenschutz &amp; Vertrauen</h1>
      <div className="card">
        <p>
          Diese Plattform wurde entwickelt, um Kinderfotos bestmöglich zu schützen und den Zugang
          klar, sicher und kontrolliert zu gestalten. Für den Zugang benötigen Sie im Kern nur Ihre
          E-Mail-Adresse – ein Passwort ist nicht erforderlich.
        </p>
        <h2>So funktioniert der sichere Zugang</h2>
        <p>
          Die Fotos werden erst sichtbar, nachdem Sie die von Ihnen angegebene E-Mail-Adresse
          bestätigt haben. Diese E-Mail-Adresse dient als persönliche Zuordnung: Es werden
          ausschliesslich Fotos angezeigt, die dieser Adresse zugeordnet wurden.
        </p>
        <p>
          Auch der Kauf und der spätere Download der Fotos sind nur über diese bestätigte
          E-Mail-Adresse möglich. So stellen wir sicher, dass Fotos nicht über offene Galerien oder
          frei zugängliche Links aufgerufen werden können. Bei Bedarf können die Fotos mit weiteren
          E-Mail Adressen verknüpft werden. Melden Sie sich dazu unter{' '}
          <Link to="/hilfe">Hilfe &amp; Kontakt</Link>.
        </p>
        <h2>Wie die Fotos geschützt sind</h2>
        <p>
          Es gibt keine offenen Galerien und keine erratbaren Links. Vorschaubilder sind bewusst mit
          einem Wasserzeichen versehen und nicht als druckfähige Dateien gedacht. Die
          Originaldateien erhalten Sie erst nach dem Kauf.
        </p>
        <p>Alle Fotos werden auf einem lokalen Server in der Schweiz gespeichert.</p>
        <h2>Welche Daten wir speichern</h2>
        <p>
          Wir speichern nur die Daten, die für den sicheren Zugang und die Bestellabwicklung
          notwendig sind:
        </p>
        <ul>
          <li>Ihre E-Mail-Adresse als Zugang und zur Zuordnung der Fotos</li>
          <li>die Ihnen zugeordneten Fotos</li>
          <li>Ihre Bestellungen</li>
        </ul>
        <h2>Aufbewahrung der Fotos</h2>
        <p>
          Ihre Fotos stehen Ihnen während 30 Tagen zur Verfügung. Danach werden sie automatisch
          archiviert. Eine spätere Nachbestellung ist auf Anfrage möglich.
        </p>
        <h2>Falsche Zuordnung melden</h2>
        <p>
          Wenn Ihnen etwas auffällt – zum Beispiel ein falsches oder fehlendes Foto – melden Sie
          sich bitte über die <Link to="/hilfe">Hilfe-Seite</Link>. Wir prüfen die Zuordnung und
          korrigieren sie so rasch wie möglich.
        </p>
      </div>
    </div>
  );
}
