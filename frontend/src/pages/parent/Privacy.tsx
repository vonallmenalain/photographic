export default function Privacy() {
  return (
    <div className="narrow" style={{ margin: '0 auto' }}>
      <h1>Datenschutz &amp; Vertrauen</h1>
      <div className="card">
        <p>
          Diese Plattform wurde gebaut, um Kinderfotos bestmöglich zu schützen. Wir gehen sparsam mit
          deinen Daten um – für den Zugang reicht im Kern deine E-Mail-Adresse, ohne Passwort.
        </p>
        <h2>Wie deine Fotos geschützt sind</h2>
        <ul>
          <li>Fotos sind erst nach Bestätigung deiner E-Mail-Adresse sichtbar.</li>
          <li>Du siehst ausschließlich Fotos, die deiner E-Mail-Adresse zugeordnet wurden.</li>
          <li>Es gibt keine offenen Galerien und keine erratbaren Links.</li>
          <li>Vorschaubilder sind mit Wasserzeichen versehen und bewusst nicht druckfähig.</li>
          <li>Originaldateien werden ausschließlich nach dem Kauf bereitgestellt.</li>
        </ul>
        <h2>Welche Daten wir speichern</h2>
        <ul>
          <li>Deine E-Mail-Adresse (als Zugang &amp; zur Zuordnung der Fotos).</li>
          <li>Die dir zugeordneten Fotos und deine Bestellungen.</li>
        </ul>
        <h2>Aufbewahrung</h2>
        <p>
          Foto-Galerien sind standardmäßig für einen begrenzten Zeitraum (in der Regel 30 Tage)
          verfügbar. Danach werden sie archiviert oder gelöscht. Eine spätere Nachbestellung ist auf
          Anfrage möglich.
        </p>
        <h2>Falsche Zuordnung melden</h2>
        <p>
          Wenn dir etwas auffällt – etwa ein falsches oder fehlendes Foto – melde es uns bitte über
          die <a href="/hilfe">Hilfe-Seite</a>. Wir korrigieren das umgehend.
        </p>
      </div>
    </div>
  );
}
