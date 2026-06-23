import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Card } from "../components/Card";

export function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="hero-content">
          <p className="eyebrow">Photographic</p>
          <h1>Geschuetzte Schul- und Kindergartenfotos</h1>
          <p className="lead">
            Eltern greifen sicher auf freigegebene Fotos ihres Kindes zu und
            koennen diese spaeter bestellen. Die Dateien bleiben privat auf dem
            lokalen Foto-Backend, jeder Zugriff wird serverseitig geprueft.
          </p>
          <div className="actions">
            <Link className="button" to="/login">
              Einloggen <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      </section>
      <div className="grid three">
        <Card>
          <h3>Magic Link</h3>
          <p>Kein Passwort fuer Eltern. Der Zugriff basiert auf verifizierter E-Mail.</p>
        </Card>
        <Card>
          <h3>Private Fotos</h3>
          <p>Thumbnails und Previews werden nur ueber authentifizierte API-Requests geladen.</p>
        </Card>
        <Card>
          <h3>Lokales Archiv</h3>
          <p>Originaldateien bleiben auf dem QNAP und werden erst nach Berechtigungs- und Kaufpruefung gestreamt.</p>
        </Card>
      </div>
    </>
  );
}
