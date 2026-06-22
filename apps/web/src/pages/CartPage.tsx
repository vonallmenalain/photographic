import { ShoppingCart } from "lucide-react";
import { useEffect, useState } from "react";
import { apiPost } from "../api/photosApi";
import { useAuth } from "../auth/useAuth";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { CartItem } from "../types/domain";
import { labelForPhotoType } from "../utils/format";

export function CartPage({ adminView = false }: { adminView?: boolean }) {
  const { getIdToken } = useAuth();
  const [items, setItems] = useState<CartItem[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setItems(JSON.parse(window.localStorage.getItem("photographicCart") || "[]"));
  }, []);

  function clearCart() {
    window.localStorage.removeItem("photographicCart");
    setItems([]);
  }

  async function createOrder() {
    setError("");
    setMessage("");
    if (items.length === 0) return;
    try {
      const result = await apiPost<{ orderId: string; message: string }>(
        "/api/orders/mock",
        {
          jobId: items[0].jobId,
          items: items.map((item) => ({
            photoId: item.photoId,
            quantity: item.quantity,
            productType: "digital-later"
          }))
        },
        getIdToken
      );
      setMessage(`${result.message} Bestellnummer: ${result.orderId}`);
    } catch (orderError) {
      setError(orderError instanceof Error ? orderError.message : "Die Bestellung konnte nicht erstellt werden.");
    }
  }

  return (
    <div className="grid">
      <div className="page-heading">
        <div>
          <h1>Warenkorb</h1>
          <p>
            {adminView
              ? "Testbereich fuer Mock-Bestellungen aus der Admin-Galerie."
              : "Zahlung wird in einer spaeteren Version mit Stripe ergaenzt."}
          </p>
        </div>
      </div>
      {error ? <ErrorState message={error} /> : null}
      {message ? <div className="success-box">{message}</div> : null}
      {items.length === 0 ? (
        <EmptyState title="Der Warenkorb ist leer">
          {adminView ? "Fuege Fotos aus der Admin-Galerie hinzu." : "Fuege Fotos aus der Galerie hinzu."}
        </EmptyState>
      ) : (
        <Card>
          <div className="table-list">
            {items.map((item) => (
              <div className="card compact" key={item.photoId}>
                <strong>{labelForPhotoType(item.type)}</strong>
                <p>Foto {item.photoId} · Menge {item.quantity}</p>
              </div>
            ))}
          </div>
          <div className="actions">
            <Button type="button" onClick={createOrder} icon={<ShoppingCart size={18} />}>
              Mock-Bestellung erstellen
            </Button>
            <Button type="button" variant="secondary" onClick={clearCart}>
              Warenkorb leeren
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
