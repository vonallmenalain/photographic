import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { Spinner, StatusBadge } from '../../components/common';
import { formatDate } from '../../lib/format';

interface Report {
  id: string;
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
  other: 'Sonstiges',
};

export default function Reports() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () =>
    api<{ reports: Report[] }>('/api/admin/reports', { admin: true })
      .then((r) => setReports(r.reports))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  const setStatus = async (id: string, status: string) => {
    await api(`/api/admin/reports/${id}`, { method: 'PATCH', admin: true, body: { status } });
    load();
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <h1>Meldungen</h1>
      <p className="soft">Anliegen von Eltern – etwa falsche Zuordnungen oder fehlende Fotos.</p>
      <div className="card">
        {reports.length === 0 ? (
          <p className="muted">Keine Meldungen.</p>
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
              {reports.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.created_at)}</td>
                  <td>{TYPE_LABELS[r.type] ?? r.type}</td>
                  <td>{r.email_text || '—'}</td>
                  <td style={{ maxWidth: 320 }}>{r.message}</td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td>
                    <select value={r.status} onChange={(e) => setStatus(r.id, e.target.value)}>
                      <option value="open">offen</option>
                      <option value="in_progress">in Bearbeitung</option>
                      <option value="resolved">gelöst</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
