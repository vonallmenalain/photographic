import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, API_BASE, ApiError } from '../../api/client';
import { Alert, StatusBadge } from '../../components/common';
import { formatDate } from '../../lib/format';
import { NotificationSettingsCard, type SettingsResponse } from './NotificationSettings';

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
 * „Nicht zustellbare E-Mails“ unter „Einstellungen“: Zustellprotokoll der
 * ausgehenden E-Mails (gemeldet vom Resend-Webhook bzw. bei einem SMTP-Fehler
 * direkt beim Versand). Standardmässig nur die offenen Probleme; auf Wunsch
 * alle protokollierten E-Mails. Jedes Problem lässt sich als erledigt
 * markieren, sobald die Adresse geprüft bzw. korrigiert ist.
 */
/**
 * Einrichtung des Resend-Webhooks direkt im Adminbereich: Zieladresse zum
 * Kopieren und das Signing Secret. Das Secret liegt bewusst hier und nicht nur
 * in der `.env` – so lässt sich der Webhook ohne Zugriff auf die Konsole des
 * Servers einrichten (eine `.env` wird nur beim Anlegen des Containers gelesen).
 * Ein gespeichertes Secret wird nie wieder angezeigt, nur ersetzt oder entfernt.
 */
function WebhookSecretCard({ webhookUrl, onSaved }: { webhookUrl: string; onSaved: () => void }) {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [secret, setSecret] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [copied, setCopied] = useState(false);

  const loadSettings = () =>
    api<SettingsResponse>('/api/admin/settings', { admin: true })
      .then(setData)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Einstellungen konnten nicht geladen werden.'),
      )
      .finally(() => setLoading(false));

  useEffect(() => {
    void loadSettings();
  }, []);

  const save = async (value: string) => {
    setError('');
    setSuccess('');
    setBusy(true);
    try {
      const res = await api<{ settings: SettingsResponse['settings'] }>('/api/admin/settings', {
        method: 'PUT',
        admin: true,
        body: { resend_webhook_secret: value },
      });
      setData((d) => (d ? { ...d, settings: res.settings } : d));
      setSecret('');
      setSuccess(
        value
          ? 'Signing Secret gespeichert. Es gilt sofort – ein Neustart des Servers ist nicht nötig. Schicke jetzt eine Test-E-Mail; danach muss unten ein Eintrag erscheinen.'
          : 'Signing Secret entfernt. Der Webhook wird nicht mehr angenommen.',
      );
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Zwischenablage nicht verfügbar – die Adresse steht ja daneben */
    }
  };

  const isSet = !!data?.settings.resend_webhook_secret_set;
  const source = data?.settings.resend_webhook_secret_source ?? 'none';

  return (
    <div className="card mb">
      <h3 style={{ marginTop: 0, marginBottom: 6 }}>Resend-Webhook einrichten</h3>
      <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
        Damit Resend Zustellprobleme hierher melden kann, braucht es einen Webhook. Lege ihn im
        Resend-Dashboard unter <strong>Webhooks → Add Webhook</strong> mit der Adresse unten und den
        Ereignissen „email.sent“, „email.delivered“, „email.delivery_delayed“, „email.bounced“,
        „email.complained“ und „email.failed“ an. Das dort angezeigte <strong>Signing Secret</strong>{' '}
        trägst du hier ein.
      </p>

      {error && <Alert kind="error">{error}</Alert>}
      {success && <Alert kind="success">{success}</Alert>}

      <div className="field">
        <label>Adresse für den Webhook (in Resend eintragen)</label>
        <div className="row" style={{ gap: 8 }}>
          <input value={webhookUrl} readOnly onFocus={(e) => e.currentTarget.select()} style={{ flex: 1 }} />
          <button type="button" className="btn secondary small" onClick={() => void copyUrl()}>
            {copied ? 'Kopiert' : 'Kopieren'}
          </button>
        </div>
      </div>

      {loading ? (
        <p className="muted">Wird geladen …</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (secret.trim()) void save(secret.trim());
          }}
        >
          <div className="field" style={{ marginBottom: 10 }}>
            <label htmlFor="resend-secret">
              Signing Secret {isSet ? '(neues Secret ersetzt das bestehende)' : ''}
            </label>
            <input
              id="resend-secret"
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={isSet ? '•••••••• (hinterlegt)' : 'whsec_…'}
              autoComplete="off"
              disabled={busy}
            />
            <p className="muted" style={{ fontSize: '0.8rem', marginTop: 6, marginBottom: 0 }}>
              {isSet
                ? source === 'env'
                  ? 'Aktuell wird das Secret aus der .env des Servers verwendet. Trägst du hier eines ein, gilt ab sofort dieses – die .env wird dann nicht mehr gebraucht.'
                  : 'Ein Secret ist hinterlegt. Aus Sicherheitsgründen wird es nicht angezeigt; du kannst es nur ersetzen oder entfernen.'
                : 'Noch kein Secret hinterlegt. Es gilt sofort nach dem Speichern – der Server muss dafür nicht neu gestartet werden.'}
            </p>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn small" disabled={busy || !secret.trim()}>
              {busy ? 'Speichern …' : 'Secret speichern'}
            </button>
            {isSet && source === 'settings' && (
              <button
                type="button"
                className="btn ghost small"
                disabled={busy}
                onClick={() => {
                  if (confirm('Signing Secret entfernen? Resend kann danach keine Zustellprobleme mehr melden.')) {
                    void save('');
                  }
                }}
              >
                Secret entfernen
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

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
              erfasst, wenn der Mailserver eine E-Mail schon beim Versand ablehnt. Lege ihn in Resend
              unter „Webhooks“ an und trage das Signing Secret unten ein.
            </>
          )}
        </div>
      )}

      {overview && <WebhookSecretCard webhookUrl={`${API_BASE}${overview.webhookPath}`} onSaved={() => void load()} />}

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
