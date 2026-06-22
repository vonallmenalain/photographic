import { Link } from "react-router-dom";
import { Card } from "../components/Card";

export function NotFoundPage() {
  return (
    <Card>
      <h1>Seite nicht gefunden</h1>
      <p>Die angeforderte Seite existiert nicht.</p>
      <Link className="button" to="/">
        Zur Startseite
      </Link>
    </Card>
  );
}
