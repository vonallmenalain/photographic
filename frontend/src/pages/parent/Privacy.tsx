export default function Privacy() {
  return (
    <div className="narrow" style={{ margin: '0 auto' }}>
      <h1>Datenschutz &amp; Vertrauen</h1>
      <div className="card">
        <p>
          Diese Plattform wurde gebaut, um Kinderfotos bestmöglich zu schützen. Wir gehen sparsam mit
          Ihren Daten um – für den Zugang reicht im Kern Ihre E-Mail-Adresse, ohne Passwort.
        </p>
        <h2>Wie die Fotos geschützt sind</h2>
        <ul>
          <li>Fotos sind erst nach Bestätigung Ihrer E-Mail-Adresse sichtbar.</li>
          <li>Es sind ausschliesslich Fotos ersichtlich, die Ihrer E-Mail Adresse zugeordnet wurden.</li>
          <li>Es gibt keine offenen Galerien und keine erratbaren Links.</li>
          <li>Vorschaubilder sind mit Wasserzeichen versehen und bewusst nicht druckfähig.</li>
          <li>Originaldateien werden ausschliesslich nach dem Kauf bereitgestellt.</li>
        </ul>
        <h2>Welche Daten wir speichern</h2>
        <ul>
          <li>Ihre E-Mail-Adresse (als Zugang &amp; zur Zuordnung der Fotos).</li>
          <li>Die Ihnen zugeordneten Fotos und Ihre Bestellungen.</li>
        </ul>
        <h2>Aufbewahrung</h2>
        <p>
          Foto-Galerien sind standardmässig für einen begrenzten Zeitraum (in der Regel 30 Tage)
          verfügbar. Danach werden sie archiviert oder gelöscht. Eine spätere Nachbestellung ist auf
          Anfrage möglich.
        </p>
        <h2>Falsche Zuordnung melden</h2>
        <p>
          Wenn Ihnen etwas auffällt – etwa ein falsches oder fehlendes Foto – melden Sie es uns bitte
          über die <a href="/hilfe">Hilfe-Seite</a>. Wir korrigieren das umgehend.
        </p>
      </div>
    </div>
  );
}
