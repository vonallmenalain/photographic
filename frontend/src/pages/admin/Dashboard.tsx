import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { Spinner } from '../../components/common';

interface Stats {
  events: number;
  publishedEvents: number;
  photos: number;
  publishedPhotos: number;
  emails: number;
  verifiedEmails: number;
  orders: number;
  openReports: number;
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    api<Stats>('/api/admin/stats', { admin: true }).then(setStats);
  }, []);

  if (!stats) return <Spinner />;

  const cards = [
    { num: stats.events, lbl: 'Events / Foto-Sets', to: 'events' },
    { num: stats.publishedEvents, lbl: 'davon veröffentlicht' },
    { num: stats.photos, lbl: 'Fotos gesamt' },
    { num: stats.publishedPhotos, lbl: 'veröffentlichte Fotos' },
    { num: stats.emails, lbl: 'E-Mail-Adressen', to: 'emails' },
    { num: stats.verifiedEmails, lbl: 'verifizierte Adressen' },
    { num: stats.orders, lbl: 'Bestellungen', to: 'orders' },
    { num: stats.openReports, lbl: 'offene Meldungen', to: 'reports' },
  ];

  return (
    <div>
      <h1>Übersicht</h1>
      <p className="soft">Dein Kontrollzentrum. Hier entscheidest du, welche Eltern welche Fotos sehen.</p>
      <div className="stat-grid mt">
        {cards.map((c, i) => {
          const inner = (
            <div className="stat" key={i}>
              <div className="num">{c.num}</div>
              <div className="lbl">{c.lbl}</div>
            </div>
          );
          return c.to ? (
            <Link key={i} to={c.to} style={{ textDecoration: 'none', color: 'inherit' }}>
              {inner}
            </Link>
          ) : (
            inner
          );
        })}
      </div>

      <div className="card mt">
        <h2>Sicherer Ablauf</h2>
        <ol className="soft">
          <li>Event/Foto-Set anlegen und Originale hochladen.</li>
          <li>Fotos prüfen – Varianten (Thumbnail, Wasserzeichen-Preview) werden automatisch erzeugt.</li>
          <li>Kinder anlegen und Fotos zuordnen; Klassenfotos direkt E-Mail-Adressen zuweisen.</li>
          <li>E-Mail-Adressen erfassen und mit Kindern verknüpfen.</li>
          <li>Fotos veröffentlichen und das Event auf „Veröffentlicht“ setzen.</li>
          <li>Eltern bestätigen ihre E-Mail und sehen nur ihre Fotos.</li>
        </ol>
      </div>
    </div>
  );
}
