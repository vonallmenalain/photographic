import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { Alert, StatusBadge } from '../../components/common';
import { formatDate } from '../../lib/format';
import { NotificationSettingsCard } from './NotificationSettings';

interface Delivery {
  id: string;
  provider: 'resend' | 'smtp';
  to: string;
  subject: string;
  status: string;
  status_at: string;
  reason: string | null;
  reason_type: string | null;
  parent_email_id: string | null;
  problem: number;
  open_problem: number;
  acknowledged_at: string | null;
}

interface Overview {
  webhookConfigured: boolean;
  webhookPath: string;
  lastEventAt: string | null;
  lastEventType: string | null;
  eventsTotal: number;
  openProblems: number;
  devLogOnly: boolean;
}

/**
 * „Nicht zustellbare E-Mails“ unter „Meldungen“: Zustellprotokoll der
 * ausgehenden E-Mails (gemeldet vom Resend-Webhook bzw. bei einem SMTP-Fehler
 * direkt beim Versand). Standardmässig nur die offenen Probleme; auf Wunsch
 * alle protokollierten E-Mails. Jedes Problem lässt sich als erledigt
 * markieren, sobald die Adresse geprüft bzw. korrigiert ist.
 */
export default function EmailDeliveries() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [problemsOnly, setProblemsOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = (onlyProblems = problemsOnly) =>
    api<{ deliveries: Delivery[]; overview: Overview }>(
      `/api/admin/email-deliveries?problems=${onlyProblems ? '1' : '0'}`,
      { admin: true },
    )
      .then((r) => {
        setDeliveries(r.deliveries);
        setOverview(r.overview);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Zustellprotokoll konnte nicht geladen werden.'),
      )
      .finally(() => setLoading(false));

  useEffect(() => {
    setLoading(true);
    void load(problemsOnly);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problemsOnly]);

  const acknowledge = async (d: Delivery) => {
    setError('');
    setNotice('');
    setBusyId(d.id);
    try {
      await api(`/api/admin/email-deliveries/${d.id}`, {
        method: 'PATCH',
        admin: true,
        body: { acknowledged: true },
      });
      setNotice(`Eintrag für ${d.to} als erledigt markiert.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aktion fehlgeschlagen.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <h2 style={{ marginTop: 28 }}>Nicht zustellbare E-Mails</h2>
      <p className="soft">
        Ob eine E-Mail wirklich ankommt, weiss nur der Mail-Anbieter (Resend). Ist der Resend-Webhook
        eingerichtet, meldet er jede E-Mail, die nicht zugestellt werden konnte, hierher – du musst
        dich dafür nicht bei Resend anmelden. Die betroffene Adresse wird im Auftrag rot markiert
        („Nicht zustellbar“), bis du das Problem hier als erledigt markierst oder die Adresse
        korrigierst.
      </p>

      {overview && (
        <div className={`alert ${overview.webhookConfigured ? 'info' : 'error'}`}>
          {overview.webhookConfigured ? (
            <>
              Resend-Webhook ist eingerichtet ({overview.eventsTotal} Ereignis
              {overview.eventsTotal === 1 ? '' : 'se'} empfangen
              {overview.lastEventAt
                ? `, zuletzt ${formatDate(overview.lastEventAt)}${
                    overview.lastEventType ? ` – ${overview.lastEventType}` : ''
                  }`
                : ', noch keines empfangen'}
              ).
            </>
          ) : (
            <>
              Der Resend-Webhook ist noch nicht eingerichtet – Zustellprobleme werden zurzeit nur
              erfasst, wenn der Mailserver eine E-Mail schon beim Versand ablehnt. Einrichtung: in
              Resend unter „Webhooks“ die Adresse{' '}
              <code>https://api.alae.app{overview.webhookPath}</code> mit den Ereignissen
              „email.bounced“, „email.complained“, „email.failed“, „email.delivery_delayed“,
              „email.sent“ und „email.delivered“ anlegen und das Signing Secret als{' '}
              <code>RESEND_WEBHOOK_SECRET</code> in die <code>.env</code> eintragen (Anleitung:{' '}
              <code>docs/04-email-smtp.md</code>, Abschnitt 4.6).
            </>
          )}
        </div>
      )}

      <NotificationSettingsCard kind="bounce" />

      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <div className="card">
        <div className="row between" style={{ marginBottom: 10, gap: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className={`btn small ${problemsOnly ? '' : 'ghost'}`}
              onClick={() => setProblemsOnly(true)}
            >
              Offene Probleme{overview ? ` (${overview.openProblems})` : ''}
            </button>
            <button
              type="button"
              className={`btn small ${problemsOnly ? 'ghost' : ''}`}
              onClick={() => setProblemsOnly(false)}
            >
              Alle protokollierten E-Mails
            </button>
          </div>
          <button type="button" className="btn ghost small" onClick={() => void load()}>
            Aktualisieren
          </button>
        </div>

        {loading ? (
          <p className="muted">Wird geladen …</p>
        ) : deliveries.length === 0 ? (
          <p className="muted">
            {problemsOnly
              ? 'Keine offenen Zustellprobleme.'
              : 'Noch keine E-Mails protokolliert.'}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Zeitpunkt</th>
                  <th>Empfänger</th>
                  <th>Betreff</th>
                  <th>Status</th>
                  <th>Begründung</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(d.status_at)}</td>
                    <td style={{ wordBreak: 'break-all' }}>
                      {d.parent_email_id ? (
                        <Link to={`/admin/emails/${d.parent_email_id}`} title="Adresse im Adminbereich öffnen">
                          {d.to}
                        </Link>
                      ) : (
                        d.to
                      )}
                    </td>
                    <td>{d.subject || <span className="muted">—</span>}</td>
                    <td>
                      <StatusBadge status={d.status} />
                      {d.problem === 1 && d.open_problem === 0 && (
                        <span className="muted" style={{ fontSize: '0.75rem', marginLeft: 6 }}>
                          erledigt
                        </span>
                      )}
                    </td>
                    <td className="muted" style={{ fontSize: '0.82rem', maxWidth: 360 }}>
                      {d.reason || '—'}
                      {d.reason_type ? ` (${d.reason_type})` : ''}
                      {d.provider === 'smtp' ? ' · vom Mailserver beim Versand gemeldet' : ''}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {d.open_problem === 1 && (
                        <button
                          type="button"
                          className="btn secondary small"
                          disabled={busyId === d.id}
                          onClick={() => void acknowledge(d)}
                          title="Problem als erledigt markieren (entfernt auch die rote Markierung an der Adresse)"
                        >
                          Erledigt
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
