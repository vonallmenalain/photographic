import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <section className="page narrow">
      <div className="panel">
        <p className="eyebrow">404</p>
        <h1>Seite nicht gefunden</h1>
        <Link className="button primary" to="/">
          Zur Startseite
        </Link>
      </div>
    </section>
  );
}
