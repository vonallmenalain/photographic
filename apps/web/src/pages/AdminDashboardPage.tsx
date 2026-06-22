import { Database, Images, ScanSearch, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "../api/photosApi";
import { useAuth } from "../auth/useAuth";
import { Card } from "../components/Card";
import { Loading } from "../components/Loading";
import { MeResponse } from "../types/domain";

export function AdminDashboardPage() {
  const { getIdToken } = useAuth();
  const [me, setMe] = useState<MeResponse | null>(null);

  useEffect(() => {
    void apiGet<MeResponse>("/api/me", getIdToken).then(setMe);
  }, [getIdToken]);

  if (!me) {
    return <Loading label="Adminbereich wird geladen..." />;
  }

  const cards = [
    {
      to: "/admin/setup",
      icon: <Database size={24} />,
      title: "Stammdaten erfassen",
      text: "Schulen, Auftraege, Klassen, Kinder und Elternlinks anlegen."
    },
    {
      to: "/admin/upload",
      icon: <Images size={24} />,
      title: "Fotos hochladen",
      text: "Originale an das lokale Foto-Backend senden und Vorschauen erzeugen."
    },
    {
      to: "/admin/photos",
      icon: <Settings size={24} />,
      title: "Fotos verwalten",
      text: "Status, Sichtbarkeit, Typ und Zuordnungen korrigieren."
    },
    {
      to: "/gallery",
      icon: <ScanSearch size={24} />,
      title: "Galerie pruefen",
      text: "Die sichtbare Galerie aus Nutzersicht kontrollieren."
    }
  ];

  return (
    <div className="grid">
      <div className="page-heading">
        <div>
          <h1>Adminbereich</h1>
          <p>Angemeldet als {me.email}</p>
        </div>
        <span className="pill">Rolle: Admin</span>
      </div>
      <div className="grid two">
        {cards.map((item) => (
          <Link to={item.to} key={item.to}>
            <Card>
              <div className="card-header">
                <div>
                  <h2>{item.title}</h2>
                  <p>{item.text}</p>
                </div>
                {item.icon}
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
