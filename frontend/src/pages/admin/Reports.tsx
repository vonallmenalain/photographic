import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { Alert, Modal, Spinner, StatusBadge } from '../../components/common';
import { formatDate } from '../../lib/format';

interface Report {
  id: string;
  email_id?: string | null;
  email_text: string;
  type: string;
  message: string;
  status: string;
  created_at: string;
}

const TYPE_LABELS: Record<string, string> = {
  wrong_photo: 'Falsches Foto',
  missing_photo: 'Fehlendes Foto',
  wrong_email: 'Falsche E-Mail',
  link_problem: 'Link-/Code-Problem',
  purchase_problem: 'Kauf-Problem',
  allow_additional_email: 'Weitere E-Mail-Adresse freigeben',
  other: 'Sonstiges',
};

const STATUS_OPTIONS = [
  { value: 'open', label: 'offen' },
  { value: 'in_progress', label: 'in Bearbeitung' },
  { value: 'resolved', label: 'gelöst' },
] as const;

export default function Reports() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [activeId, setActiveId] = useState<string | null>(null);

  const load = () =>
    api<{ reports: Report[] }>('/api/admin/reports', { admin: true })
      .then((r) => setReports(r.reports))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const setStatus = async (id: string, status: string) => {
    setReports((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    await api(`/api/admin/reports/${id}`, { method: 'PATCH', admin: true, body: { status } });
    load();
  };

  const remove = async (id: string) => {
    if (!confirm('Meldung wirklich löschen? Dies kann nicht rückgängig gemacht werden.')) return;
    setError('');
    try {
      await api(`/api/admin/reports/${id}`, { method: 'DELETE', admin: true });
      setActiveId(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Meldung konnte nicht gelöscht werden.');
    }
  };

  const filtered = useMemo(
    () =>
      reports.filter(
        (r) =>
          (typeFilter === 'all' || r.type === typeFilter) &&
          (statusFilter === 'all' || r.status === statusFilter),
      ),
    [reports, typeFilter, statusFilter],
  );

  const active = reports.find((r) => r.id === activeId) ?? null;
  const openCount = reports.filter((r) => r.status === 'open').length;

  if (loading) return <Spinner />;

  return (
    <div>
      <h1>Meldungen</h1>
      <p className="soft">
        Anliegen von Eltern – etwa falsche Zuordnungen oder fehlende Fotos.
        {openCount > 0 ? ` ${openCount} offen.` : ''}
      </p>
      {error && <Alert kind="error">{error}</Alert>}

      <div className="card mb">
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field" style={{ marginBottom: 0, minWidth: 200 }}>
            <label style={{ fontSize: '0.8rem' }}>Typ</label>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">Alle Typen</option>
              {Object.entries(TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0, minWidth: 180 }}>
            <label style={{ fontSize: '0.8rem' }}>Status</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">Alle Status</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <span className="muted" style={{ fontSize: '0.82rem' }}>
            {filtered.length} von {reports.length} Meldung(en)
          </span>
        </div>
      </div>

      <div className="card">
        {filtered.length === 0 ? (
          <p className="muted">{reports.length === 0 ? 'Keine Meldungen.' : 'Keine Meldungen für diese Filter.'}</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Datum</th>
                <th>Typ</th>
                <th>E-Mail</th>
                <th>Nachricht</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setActiveId(r.id)}
                  style={{ cursor: 'pointer' }}
                  title="Details anzeigen"
                >
                  <td>{formatDate(r.created_at)}</td>
                  <td>{TYPE_LABELS[r.type] ?? r.type}</td>
                  <td>{r.email_text || '—'}</td>
                  <td style={{ maxWidth: 320 }}>
                    <span className="report-message-clamp">{r.message}</span>
                  </td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td>
                    <span className="link-look">Details</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {active && (
        <Modal title="Meldung" width={620} onClose={() => setActiveId(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="row between" style={{ alignItems: 'center' }}>
              <span className="badge">{TYPE_LABELS[active.type] ?? active.type}</span>
              <span className="muted" style={{ fontSize: '0.82rem' }}>
                {formatDate(active.created_at)}
              </span>
            </div>

            <div>
              <label style={{ fontSize: '0.8rem' }}>Von</label>
              <div>
                {active.email_text ? (
                  active.email_id ? (
                    <Link to={`/admin/emails/${active.email_id}`}>{active.email_text} →</Link>
                  ) : (
                    active.email_text
                  )
                ) : (
                  <span className="muted">Keine E-Mail-Adresse angegeben</span>
                )}
              </div>
            </div>

            <div>
              <label style={{ fontSize: '0.8rem' }}>Nachricht</label>
              <div
                style={{
                  whiteSpace: 'pre-wrap',
                  background: 'var(--surface-2)',
                  borderRadius: 10,
                  padding: '12px 14px',
                  fontSize: '0.92rem',
                  lineHeight: 1.55,
                }}
              >
                {active.message}
              </div>
            </div>

            <div className="row between" style={{ alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
              <div className="field" style={{ marginBottom: 0, minWidth: 200 }}>
                <label style={{ fontSize: '0.8rem' }}>Status</label>
                <select value={active.status} onChange={(e) => setStatus(active.id, e.target.value)}>
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                className="btn ghost small"
                style={{ color: 'var(--danger)' }}
                onClick={() => remove(active.id)}
              >
                Meldung löschen
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
