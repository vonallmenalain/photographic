import { ReactNode, useEffect } from 'react';

/**
 * Lightweight, accessible modal dialog used for short admin forms
 * (z. B. „Kind anlegen“ und „E-Mail anlegen“). Click outside or Escape closes.
 */
export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 460,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card"
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Schließen">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

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

/**
 * „E-Mail an mich senden“-Häkchen für die Versand-Popups. Standardmässig
 * deaktiviert; wenn aktiviert, erhält das angemeldete Admin-Konto eine Kopie.
 * Ist im Konto keine E-Mail hinterlegt, wird die Option deaktiviert dargestellt.
 */
export function SendToSelfCheckbox({
  checked,
  onChange,
  adminEmail,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  adminEmail: string;
}) {
  const hasEmail = !!adminEmail;
  return (
    <label
      className="row"
      style={{
        alignItems: 'center',
        gap: 10,
        marginTop: 12,
        fontSize: '0.88rem',
        cursor: hasEmail ? 'pointer' : 'not-allowed',
        opacity: hasEmail ? 1 : 0.6,
      }}
    >
      <input
        type="checkbox"
        checked={checked && hasEmail}
        disabled={!hasEmail}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        E-Mail an mich senden
        {hasEmail ? (
          <span className="muted"> ({adminEmail})</span>
        ) : (
          <span className="muted"> – im Admin-Konto ist keine E-Mail-Adresse hinterlegt.</span>
        )}
      </span>
    </label>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    // events
    draft: { label: 'In Bearbeitung', cls: 'amber' },
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
