import { ReactNode } from 'react';

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="center" style={{ padding: 40 }}>
      <span className="spinner" />
      {label && <p className="muted" style={{ marginTop: 12 }}>{label}</p>}
    </div>
  );
}

export function TrustNote({ children }: { children: ReactNode }) {
  return (
    <div className="trust">
      <span className="icon">🔒</span>
      <div>{children}</div>
    </div>
  );
}

export function Alert({ kind, children }: { kind: 'error' | 'success' | 'info'; children: ReactNode }) {
  return <div className={`alert ${kind}`}>{children}</div>;
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    // events
    draft: { label: 'Entwurf', cls: 'gray' },
    in_progress: { label: 'In Bearbeitung', cls: 'amber' },
    ready: { label: 'Bereit', cls: 'amber' },
    published: { label: 'Veröffentlicht', cls: 'green' },
    archived: { label: 'Archiviert', cls: 'gray' },
    disabled: { label: 'Deaktiviert', cls: 'red' },
    // emails
    created: { label: 'Angelegt', cls: 'gray' },
    not_verified: { label: 'Nicht verifiziert', cls: 'amber' },
    verification_sent: { label: 'Verifizierung gesendet', cls: 'amber' },
    verified: { label: 'Verifiziert', cls: 'green' },
    support: { label: 'Support nötig', cls: 'red' },
    // photos
    uploaded: { label: 'Hochgeladen', cls: 'gray' },
    processed: { label: 'Verarbeitet', cls: 'amber' },
    assigned: { label: 'Zugeordnet', cls: 'green' },
    // orders (simplified life cycle)
    cart: { label: 'Warenkorb', cls: 'gray' },
    checkout_started: { label: 'Kauf gestartet', cls: 'amber' },
    pending: { label: 'Pendent', cls: 'amber' },
    completed: { label: 'Abgeschlossen', cls: 'green' },
    cancelled: { label: 'Storniert', cls: 'red' },
    // reports
    open: { label: 'Offen', cls: 'amber' },
    resolved: { label: 'Gelöst', cls: 'green' },
  };
  const info = map[status] ?? { label: status, cls: 'gray' };
  return <span className={`badge ${info.cls}`}>{info.label}</span>;
}
