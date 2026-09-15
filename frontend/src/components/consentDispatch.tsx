import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import { Alert, DeliveryProblemBadge, Modal, type DeliveryProblemInfo } from './common';
import { formatDateShort } from '../lib/format';

/**
 * Versand-Popup „Einverständniserklärung versenden“.
 *
 * Gedacht für Aufträge, die NICHT über die Klassenerfassung entstanden sind
 * (z. B. Excel-Import): Der Auftrag ist bereits erfasst und steht auf „In
 * Bearbeitung“, die Eltern sollen aber trotzdem noch die Einverständniserklärung
 * ausfüllen. Das Popup zeigt vor dem Versand genau, an welche E-Mail-Adressen die
 * Aufforderung geht und was jede Adresse bereits beantwortet hat.
 *
 * Vorausgewählt sind alle Adressen, von denen noch nicht für jedes ihrer Kinder
 * eine Antwort vorliegt. Adressen ohne Kind in diesem Auftrag (nur ein Foto
 * direkt zugeordnet) können nichts beantworten und lassen sich nicht auswählen.
 * Jede Adresse erhält einen persönlichen, einmalig einlösbaren Link – deshalb
 * gibt es hier bewusst keine Kopie an das eigene Konto.
 */

interface ConsentRecipient {
  id: string;
  email: string;
  name: string;
  verified: boolean;
  deliveryProblem?: DeliveryProblemInfo | null;
  /** Anzahl Kinder dieses Auftrags an dieser E-Mail-Adresse. */
  consentChildren: number;
  consentDecision: string | null;
  consentDecisionLabel: string | null;
  consentPending: boolean;
  consentSentAt: string | null;
}

interface ConsentRecipientsResponse {
  children: { id: string; name: string; emails: ConsentRecipient[] }[];
  otherEmails: ConsentRecipient[];
  devLogOnly: boolean;
}

export function ConsentDispatchModal({
  eventId,
  onClose,
  onSent,
}: {
  eventId: string;
  onClose: () => void;
  onSent: (msg: string) => void;
}) {
  const [data, setData] = useState<ConsentRecipientsResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Eine Zeile pro E-Mail-Adresse (eine Adresse kann mehreren Kindern gehören).
  const allEmails = useMemo(() => {
    if (!data) return [] as ConsentRecipient[];
    const byId = new Map<string, ConsentRecipient>();
    for (const c of data.children) for (const e of c.emails) byId.set(e.id, e);
    for (const e of data.otherEmails) byId.set(e.id, e);
    return Array.from(byId.values()).sort((a, b) => a.email.localeCompare(b.email));
  }, [data]);

  const selectable = useMemo(() => allEmails.filter((e) => e.consentChildren > 0), [allEmails]);

  useEffect(() => {
    api<ConsentRecipientsResponse>(`/api/admin/events/${eventId}/reminder-recipients`, {
      admin: true,
    })
      .then((r) => {
        setData(r);
        const ids = new Set<string>();
        const add = (e: ConsentRecipient) => {
          if (e.consentChildren > 0 && e.consentPending) ids.add(e.id);
        };
        for (const c of r.children) for (const e of c.emails) add(e);
        for (const e of r.otherEmails) add(e);
        setSelected(ids);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Empfänger konnten nicht ermittelt werden.'),
      )
      .finally(() => setLoading(false));
  }, [eventId]);

  const toggle = (row: ConsentRecipient) => {
    if (row.consentChildren === 0) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
  };

  const allChecked = selectable.length > 0 && selected.size === selectable.length;
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(selectable.map((e) => e.id)));

  const send = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api<{
        sent: number;
        failed: number;
        failedEmails?: string[];
        skippedEmails?: string[];
        total: number;
        devLogOnly: boolean;
      }>(`/api/admin/events/${eventId}/send-consent`, {
        method: 'POST',
        admin: true,
        body: { emailIds: Array.from(selected) },
      });
      const extra =
        res.failed > 0
          ? ` ${res.failed} konnten nicht gesendet werden${
              res.failedEmails?.length ? ` (${res.failedEmails.join(', ')})` : ''
            } – Details unter „Meldungen“.`
          : '';
      const note = res.devLogOnly
        ? ' Hinweis: Kein SMTP konfiguriert – die E-Mails wurden nur ins Server-Log geschrieben.'
        : '';
      onSent(
        `Einverständniserklärung an ${res.sent} von ${res.total} E-Mail-Adresse(n) gesendet.${extra}${note}`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Versand fehlgeschlagen.');
      setBusy(false);
    }
  };

  const canSend = !loading && !busy && selected.size > 0;

  return (
    <Modal
      title="Einverständniserklärung versenden"
      width={780}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button type="button" className="btn" onClick={send} disabled={!canSend}>
            {busy ? 'Wird gesendet …' : 'Jetzt senden'}
          </button>
        </>
      }
    >
      {error && <Alert kind="error">{error}</Alert>}
      <p style={{ fontSize: '0.92rem', lineHeight: 1.6, marginTop: 0 }}>
        Die Eltern erhalten eine E-Mail mit einem persönlichen Link auf das Formular. Dort wählen sie
        pro Kind, ob und wie es fotografiert werden darf. Vorausgewählt sind alle E-Mail-Adressen, von
        denen noch <strong>keine vollständige Antwort</strong> vorliegt – bereits beantwortete Adressen
        kannst du zusätzlich anhaken, sie können ihre Antwort dann ändern.
      </p>
      {loading ? (
        <p className="muted">Empfänger werden ermittelt …</p>
      ) : allEmails.length === 0 ? (
        <Alert kind="error">Diesem Auftrag sind noch keine (aktiven) E-Mail-Adressen zugeordnet.</Alert>
      ) : (
        <>
          <div className="row between" style={{ marginBottom: 6 }}>
            <strong style={{ fontSize: '0.85rem' }}>
              {selected.size} von {selectable.length} ausgewählt
            </strong>
            <button type="button" className="btn ghost small" onClick={toggleAll}>
              {allChecked ? 'Alle abwählen' : 'Alle auswählen'}
            </button>
          </div>
          <div
            style={{
              maxHeight: 340,
              overflow: 'auto',
              border: '1px solid var(--border)',
              borderRadius: 10,
            }}
          >
            <table className="dispatch-table">
              <thead>
                <tr>
                  <th>E-Mail-Adresse</th>
                  <th style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={toggleAll}
                      aria-label="Alle auswählen"
                      style={{ width: 'auto', margin: 0 }}
                    />
                  </th>
                  <th>Status</th>
                  <th>Einverständnis</th>
                  <th>Versendet</th>
                </tr>
              </thead>
              <tbody>
                {allEmails.map((e) => (
                  <tr
                    key={e.id}
                    onClick={() => toggle(e)}
                    style={{
                      cursor: e.consentChildren > 0 ? 'pointer' : 'default',
                      opacity: e.consentChildren > 0 ? 1 : 0.55,
                    }}
                  >
                    <td className="dispatch-email">{e.email}</td>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={selected.has(e.id)}
                        disabled={e.consentChildren === 0}
                        onChange={() => toggle(e)}
                        onClick={(ev) => ev.stopPropagation()}
                        style={{ width: 'auto', margin: 0 }}
                      />
                    </td>
                    <td>
                      <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                        {e.verified ? (
                          <span className="badge green">Bestätigt</span>
                        ) : (
                          <span className="badge amber">Nicht bestätigt</span>
                        )}
                        <DeliveryProblemBadge problem={e.deliveryProblem} />
                      </span>
                    </td>
                    <td>
                      {e.consentChildren === 0 ? (
                        <span className="badge gray">Kein Kind zugeordnet</span>
                      ) : e.consentDecisionLabel ? (
                        <span
                          className={`badge ${e.consentDecision === 'none' ? 'red' : 'green'}`}
                          title={e.consentPending ? 'Für ein weiteres Kind fehlt noch die Antwort.' : ''}
                        >
                          {e.consentDecisionLabel}
                          {e.consentPending ? ' · teilweise' : ''}
                        </span>
                      ) : (
                        <span className="badge amber">Offen</span>
                      )}
                    </td>
                    <td>
                      {e.consentSentAt ? (
                        <span className="badge green">{formatDateShort(e.consentSentAt)}</span>
                      ) : (
                        <span className="badge gray">Noch nicht</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: '0.8rem', marginTop: 10, marginBottom: 0 }}>
            Der Link in dieser E-Mail gilt nur für die jeweilige Adresse und ist einmalig einlösbar –
            eine Kopie an dich selbst wäre deshalb nicht verwendbar.
            {data?.devLogOnly
              ? ' Achtung: Kein SMTP konfiguriert – die E-Mails landen nur im Server-Log.'
              : ''}
          </p>
        </>
      )}
    </Modal>
  );
}
