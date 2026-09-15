import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { useParentAuth } from '../../context/ParentAuth';
import { Alert, Spinner, TrustNote } from '../../components/common';
import { formatDate } from '../../lib/format';

interface ConsentChild {
  id: string;
  name: string;
  decision: string | null;
  decidedAt: string | null;
  othersAnswered: boolean;
  needsReview: boolean;
}
interface ConsentRequest {
  eventId: string;
  className: string;
  school: string;
  shootingDate: string;
  deadline: string;
  open: boolean;
  consentRequired: boolean;
  text: string;
  textHash: string;
  children: ConsentChild[];
}
interface Option {
  value: string;
  label: string;
}
interface ConsentsResponse {
  requests: ConsentRequest[];
  options: Option[];
  contactEmail: string;
}

/** Text mit Absätzen und „- “-Aufzählungen darstellen. */
function ConsentText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className="consent-text">
      {blocks.map((block, i) => {
        const lines = block.split('\n');
        if (lines.every((l) => l.trim().startsWith('- '))) {
          return (
            <ul key={i} style={{ margin: '0 0 12px', paddingLeft: 20 }}>
              {lines.map((l, j) => (
                <li key={j}>{l.trim().slice(2)}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} style={{ marginBottom: 12 }}>
            {block}
          </p>
        );
      })}
    </div>
  );
}

/**
 * Einverständnis-Formular der Eltern. Zeigt ausschliesslich die eigenen Kinder
 * (über die bestätigte E-Mail-Adresse verknüpft) und die eigene Antwort. Pro
 * Kind wird genau eine der Antworten gewählt; die Antwort lässt sich bis zur
 * Übernahme der Klasse in den Auftrag jederzeit ändern.
 */
export default function Consent() {
  const { refresh, email } = useParentAuth();
  const [data, setData] = useState<ConsentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const res = await api<ConsentsResponse>('/api/parent/consents');
      setData(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (loading) return <Spinner label="Einen Moment …" />;

  return (
    <div className="narrow-wide" style={{ margin: '0 auto' }}>
      <h1>Einverständnis zur Schulfotografie</h1>
      {error && <Alert kind="error">{error}</Alert>}

      {data && data.requests.length === 0 ? (
        <div className="card center">
          <p className="soft">
            Für {email} liegt derzeit keine Anfrage zu einem Einverständnis vor.
          </p>
          <Link to="/galerie" className="btn">
            Zu den Fotos
          </Link>
        </div>
      ) : (
        data?.requests.map((req) => (
          <RequestCard
            key={req.eventId}
            req={req}
            options={data.options}
            onChanged={async () => {
              await load();
              await refresh();
            }}
          />
        ))
      )}

      <div style={{ marginTop: 18 }}>
        <TrustNote>
          Sie sehen hier nur Ihre eigenen Kinder und Ihre eigene Antwort. Die Antwort wird mit
          Datum und Wortlaut gespeichert und Ihnen per E-Mail bestätigt.
          {data?.contactEmail ? (
            <>
              {' '}
              Fragen? <a href={`mailto:${data.contactEmail}`}>{data.contactEmail}</a>
            </>
          ) : null}
        </TrustNote>
      </div>
    </div>
  );
}

function RequestCard({
  req,
  options,
  onChanged,
}: {
  req: ConsentRequest;
  options: Option[];
  onChanged: () => Promise<void>;
}) {
  const [newChild, setNewChild] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const facts = [
    req.school,
    req.shootingDate ? `Fototermin ${req.shootingDate}` : '',
    req.deadline ? `Rückmeldung bis ${req.deadline}` : '',
  ].filter(Boolean);

  const addChild = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');
    setAddBusy(true);
    try {
      const res = await api<{ matched: boolean }>('/api/parent/consents/child', {
        method: 'POST',
        body: { eventId: req.eventId, childName: newChild },
      });
      setNewChild('');
      setMsg(
        res.matched
          ? 'Das Kind wurde Ihrer E-Mail-Adresse zugeordnet.'
          : 'Das Kind wurde eingetragen. Die Lehrperson prüft den Eintrag.',
      );
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Konnte nicht eingetragen werden.');
    } finally {
      setAddBusy(false);
    }
  };

  return (
    <div className="card mb">
      <h2 style={{ marginBottom: 2 }}>Klasse {req.className}</h2>
      {facts.length > 0 && (
        <p className="muted" style={{ marginTop: 0 }}>
          {facts.join(' · ')}
        </p>
      )}

      {!req.open && (
        <Alert kind="info">
          Die Erfassung dieser Klasse ist abgeschlossen. Änderungen melden Sie bitte über{' '}
          <Link to="/hilfe">Hilfe &amp; Kontakt</Link>.
        </Alert>
      )}

      {req.consentRequired ? (
        <ConsentText text={req.text} />
      ) : (
        <p className="soft">
          Für diese Klasse wird das Einverständnis über die Schule eingeholt. Ihr Kind ist
          eingetragen; Sie erhalten eine E-Mail, sobald die Fotos bereit sind.
        </p>
      )}

      {msg && <Alert kind="success">{msg}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}

      {req.children.map((child) => (
        <ChildForm
          key={child.id}
          req={req}
          child={child}
          options={options}
          onChanged={onChanged}
        />
      ))}

      {req.open && (
        <details style={{ marginTop: 16 }}>
          <summary style={{ cursor: 'pointer' }}>Weiteres Kind dieser Klasse eintragen</summary>
          <form onSubmit={addChild} className="row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: '1 1 200px', marginBottom: 0 }}>
              <label htmlFor={`add-${req.eventId}`}>Vor- und Nachname des Kindes</label>
              <input
                id={`add-${req.eventId}`}
                value={newChild}
                onChange={(e) => setNewChild(e.target.value)}
                required
              />
            </div>
            <button className="btn secondary" disabled={addBusy || !newChild.trim()}>
              {addBusy ? 'Wird eingetragen …' : 'Eintragen'}
            </button>
          </form>
        </details>
      )}
    </div>
  );
}

function ChildForm({
  req,
  child,
  options,
  onChanged,
}: {
  req: ConsentRequest;
  child: ConsentChild;
  options: Option[];
  onChanged: () => Promise<void>;
}) {
  const [decision, setDecision] = useState(child.decision ?? '');
  const [parentName, setParentName] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  const [secondEmail, setSecondEmail] = useState('');
  const [secondMsg, setSecondMsg] = useState('');

  useEffect(() => {
    setDecision(child.decision ?? '');
  }, [child.decision]);

  const editable = req.open && req.consentRequired;
  const changed = decision !== (child.decision ?? '');

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaved('');
    if (!decision) {
      setError('Bitte wählen Sie eine Antwort.');
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ message: string }>('/api/parent/consents', {
        method: 'POST',
        body: { eventId: req.eventId, childId: child.id, decision, parentName },
      });
      setSaved(res.message);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const addSecond = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSecondMsg('');
    try {
      const res = await api<{ message: string }>('/api/parent/consents/second-parent', {
        method: 'POST',
        body: { eventId: req.eventId, childId: child.id, email: secondEmail },
      });
      setSecondEmail('');
      setSecondMsg(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Konnte nicht eingetragen werden.');
    }
  };

  const currentLabel = child.decision ? options.find((o) => o.value === child.decision)?.label : '';

  return (
    <div className="consent-child">
      <h3 style={{ marginBottom: 4 }}>{child.name}</h3>
      {child.needsReview && (
        <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
          Dieser Eintrag wurde von Ihnen ergänzt und wird von der Lehrperson geprüft.
        </p>
      )}
      {child.decision && (
        <p className="muted" style={{ fontSize: '0.88rem' }}>
          Ihre Antwort{child.decidedAt ? ` vom ${formatDate(child.decidedAt)}` : ''}:{' '}
          <strong>{currentLabel}</strong>
        </p>
      )}
      {!child.decision && child.othersAnswered && (
        <p className="muted" style={{ fontSize: '0.88rem' }}>
          Ein anderer Elternteil hat für dieses Kind bereits geantwortet. Sie können Ihre eigene
          Antwort trotzdem abgeben; bei unterschiedlichen Antworten gilt die vorsichtigere.
        </p>
      )}

      {req.consentRequired && (
        <form onSubmit={save}>
          <div className="consent-options" role="radiogroup" aria-label={`Antwort für ${child.name}`}>
            {options.map((o) => (
              <label key={o.value} className={`consent-option${decision === o.value ? ' selected' : ''}`}>
                <input
                  type="radio"
                  name={`decision-${child.id}`}
                  value={o.value}
                  checked={decision === o.value}
                  disabled={!editable}
                  onChange={() => setDecision(o.value)}
                />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
          {editable && (
            <>
              {!child.decision && (
                <div className="field">
                  <label htmlFor={`pn-${child.id}`}>Ihr Name (optional)</label>
                  <input
                    id={`pn-${child.id}`}
                    value={parentName}
                    onChange={(e) => setParentName(e.target.value)}
                    placeholder="Vor- und Nachname des Elternteils"
                  />
                </div>
              )}
              {saved && <Alert kind="success">{saved}</Alert>}
              {error && <Alert kind="error">{error}</Alert>}
              <button className="btn" disabled={busy || !decision || (!!child.decision && !changed)}>
                {busy ? 'Wird gespeichert …' : child.decision ? 'Antwort ändern' : 'Antwort speichern'}
              </button>
            </>
          )}
        </form>
      )}

      {req.open && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: '0.9rem' }}>
            Zweiten Elternteil einladen (optional)
          </summary>
          <p className="muted" style={{ fontSize: '0.85rem', margin: '8px 0' }}>
            Die zweite E-Mail-Adresse erhält eine eigene Einladung und sieht später ebenfalls die Fotos.
          </p>
          {secondMsg && <Alert kind="success">{secondMsg}</Alert>}
          <form onSubmit={addSecond} className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: '1 1 200px', marginBottom: 0 }}>
              <label htmlFor={`se-${child.id}`}>E-Mail-Adresse</label>
              <input
                id={`se-${child.id}`}
                type="email"
                value={secondEmail}
                onChange={(e) => setSecondEmail(e.target.value)}
                required
              />
            </div>
            <button className="btn secondary" disabled={!secondEmail}>
              Einladen
            </button>
          </form>
        </details>
      )}
    </div>
  );
}
