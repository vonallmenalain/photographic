import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { Alert, Spinner } from '../../components/common';

interface ClassRow {
  id: string;
  name: string;
  status: string;
  open: boolean;
  registration: {
    school: string;
    shooting_date_text: string;
    deadline_text: string;
    consent_required: boolean;
  } | null;
  stats: {
    children: number;
    answered: number;
    invited_pending: number;
    no_email: number;
    none: number;
  };
}

/** Übersicht der Klassen, für die die angemeldete E-Mail-Adresse Lehrperson ist. */
export default function TeacherClasses() {
  const navigate = useNavigate();
  const [classes, setClasses] = useState<ClassRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ classes: ClassRow[] }>('/api/teacher/classes')
      .then((r) => {
        // Eine einzige Klasse: direkt dorthin.
        if (r.classes.length === 1) {
          navigate(`/klasse/${r.classes[0].id}`, { replace: true });
          return;
        }
        setClasses(r.classes);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Konnte nicht geladen werden.');
        setClasses([]);
      });
  }, [navigate]);

  if (classes === null && !error) return <Spinner label="Einen Moment …" />;

  return (
    <div className="narrow-wide" style={{ margin: '0 auto' }}>
      <h1>Meine Klassen</h1>
      {error && <Alert kind="error">{error}</Alert>}
      {classes && classes.length === 0 ? (
        <div className="card center">
          <p className="soft">Für Ihre E-Mail-Adresse ist keine Klasse hinterlegt.</p>
        </div>
      ) : (
        classes?.map((c) => (
          <div className="card mb" key={c.id}>
            <div className="row between">
              <div>
                <h2 style={{ marginBottom: 2 }}>Klasse {c.name}</h2>
                <p className="muted" style={{ margin: 0 }}>
                  {[c.registration?.school, c.registration?.shooting_date_text ? `Fototermin ${c.registration.shooting_date_text}` : '']
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <span className={`badge ${c.open ? 'green' : 'gray'}`}>
                {c.open ? 'Erfassung läuft' : 'Abgeschlossen'}
              </span>
            </div>
            <p className="soft" style={{ margin: '10px 0' }}>
              {c.stats.children} Kinder
              {c.registration?.consent_required
                ? ` · ${c.stats.answered} Antworten · ${c.stats.invited_pending + c.stats.no_email} ausstehend`
                : ''}
            </p>
            <Link to={`/klasse/${c.id}`} className="btn secondary">
              Klassenseite öffnen
            </Link>
          </div>
        ))
      )}
    </div>
  );
}
