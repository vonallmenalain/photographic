import { ArrowRight, KeyRound, LockKeyhole, ShieldCheck, Upload } from "lucide-react";
import { Link } from "react-router-dom";

export function LandingPage() {
  return (
    <section className="hero-band">
      <div className="hero-grid">
        <div className="hero-copy">
          <p className="eyebrow">Sichere Foto-Bestellungen</p>
          <h1>PhotoGuard</h1>
          <p className="lead">
            Private Galerien für Kindergarten- und Schulfotos, geschützt durch Zugangscodes,
            Firebase Auth und kurzlebige Bildfreigaben.
          </p>
          <div className="hero-actions">
            <Link to="/access" className="button primary">
              <KeyRound size={18} aria-hidden="true" />
              Zugangscode eingeben
            </Link>
            <Link to="/admin" className="button secondary">
              <LockKeyhole size={18} aria-hidden="true" />
              Admin Login
            </Link>
          </div>
        </div>
        <div className="security-panel" aria-label="Sicherheitsstatus">
          <div className="security-visual">
            <ShieldCheck size={54} aria-hidden="true" />
          </div>
          <div className="security-list">
            <span>Privater R2 Bucket</span>
            <span>Gehashte Zugangscodes</span>
            <span>Keine öffentlichen Foto-URLs</span>
            <span>Audit Logs für sensible Aktionen</span>
          </div>
        </div>
      </div>
      <div className="feature-strip" aria-label="MVP Bereiche">
        <div>
          <Upload size={18} aria-hidden="true" />
          <span>Presigned Uploads</span>
        </div>
        <div>
          <ShieldCheck size={18} aria-hidden="true" />
          <span>Regelkonforme Reads</span>
        </div>
        <div>
          <ArrowRight size={18} aria-hidden="true" />
          <span>Mock Warenkorb</span>
        </div>
      </div>
    </section>
  );
}
