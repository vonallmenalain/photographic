import { useEffect, useMemo, useState } from 'react';
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

/**
 * Stellt den im Adminbereich gepflegten Text dar: Leerzeilen trennen Absätze,
 * Zeilen mit „- “ werden zu Aufzählungen. Beides darf im selben Absatz stehen
 * („So gehen wir mit den Fotos um:“ gefolgt von den Punkten).
 */
function ConsentText({ text }: { text: string }) {
  // Der Text wird in Blöcke zerlegt: zusammenhängende Aufzählungszeilen bilden
  // eine Liste, alles andere einen Absatz.
  const parts: { kind: 'p' | 'ul'; lines: string[] }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      parts.push({ kind: 'p', lines: [] }); // Absatzende
      continue;
    }
    const isBullet = line.startsWith('- ');
    const last = parts[parts.length - 1];
    if (last && last.lines.length > 0 && last.kind === (isBullet ? 'ul' : 'p')) {
      last.lines.push(isBullet ? line.slice(2) : line);
    } else {
      parts.push({ kind: isBullet ? 'ul' : 'p', lines: [isBullet ? line.slice(2) : line] });
    }
  }
  return (
    <div className="consent-text">
      {parts
        .filter((part) => part.lines.length > 0)
        .map((part, i) =>
          part.kind === 'ul' ? (
            <ul key={i} style={{ margin: '0 0 12px', paddingLeft: 20 }}>
              {part.lines.map((l, j) => (
                <li key={j}>{l}</li>
              ))}
            </ul>
          ) : (
            <p key={i} style={{ marginBottom: 12 }}>
              {part.lines.join(' ')}
            </p>
          ),
        )}
    </div>
  );
}

/**
 * Einverständnis-Formular der Eltern. Zeigt ausschliesslich die eigenen Kinder
 * (über die bestätigte E-Mail-Adresse verknüpft) und die eigene Antwort.
 *
 * Pro Klasse gibt es EIN Formular: für jedes eigene Kind eine Auswahl, darunter
 * ein einziger Knopf „Antwort speichern“. Wer für Geschwister antwortet,
 * speichert also einmal und erhält eine einzige Bestätigungs-E-Mail. Der Name
 * der Eltern wird hier nicht mehr abgefragt – er stammt aus der Anmeldung.
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
  // Eine Auswahl je Kind, gemeinsam gespeichert.
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [newChild, setNewChild] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // Beim Laden (und nach jeder Änderung) den gespeicherten Stand übernehmen.
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const c of req.children) next[c.id] = c.decision ?? '';
    setDecisions(next);
  }, [req.children]);

  const editable = req.open && req.consentRequired;

  // Gespeichert wird nur, was sich gegenüber dem Server unterscheidet.
  const changed = useMemo(
    () =>
      req.children
        .filter((c) => decisions[c.id] && decisions[c.id] !== (c.decision ?? ''))
        .map((c) => ({ childId: c.id, decision: decisions[c.id] })),
    [req.children, decisions],
  );
  const missing = req.children.filter((c) => !decisions[c.id]).length;

  const facts = [
    req.school,
    req.shootingDate ? `Fototermin ${req.shootingDate}` : '',
    req.deadline ? `Rückmeldung bis ${req.deadline}` : '',
  ].filter(Boolean);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMsg('');
    if (changed.length === 0) return;
    setBusy(true);
    try {
      const res = await api<{ message: string }>('/api/parent/consents', {
        method: 'POST',
        body: { eventId: req.eventId, decisions: changed },
      });
      setMsg(res.message);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

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
          ? 'Das Kind wurde Ihrer E-Mail-Adresse zugeordnet. Bitte wählen Sie unten die Antwort dazu.'
          : 'Das Kind wurde eingetragen. Die Lehrperson prüft den Eintrag.',
      );
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Konnte nicht eingetragen werden.');
    } finally {
      setAddBusy(false);
    }
  };

  const answeredAll = req.children.length > 0 && req.children.every((c) => c.decision);
  const many = req.children.length > 1;

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

      <form onSubmit={save}>
        {req.children.map((child) => (
          <ChildBlock
            key={child.id}
            req={req}
            child={child}
            options={options}
            value={decisions[child.id] ?? ''}
            onChange={(v) => setDecisions((prev) => ({ ...prev, [child.id]: v }))}
            editable={editable}
          />
        ))}

        {editable && req.children.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <button className="btn" disabled={busy || changed.length === 0}>
              {busy
                ? 'Wird gespeichert …'
                : answeredAll
                  ? many
                    ? 'Antworten ändern'
                    : 'Antwort ändern'
                  : many
                    ? 'Antworten speichern'
                    : 'Antwort speichern'}
            </button>
            {changed.length === 0 && answeredAll && (
              <p className="muted" style={{ fontSize: '0.85rem', margin: '8px 0 0' }}>
                Ihre {many ? 'Antworten sind' : 'Antwort ist'} gespeichert und bis zum Fototermin
                jederzeit änderbar.
              </p>
            )}
            {missing > 0 && changed.length === 0 && (
              <p className="muted" style={{ fontSize: '0.85rem', margin: '8px 0 0' }}>
                Bitte wählen Sie {many ? 'für jedes Kind' : ''} eine Antwort.
              </p>
            )}
            {many && changed.length > 0 && (
              <p className="muted" style={{ fontSize: '0.85rem', margin: '8px 0 0' }}>
                Sie erhalten eine einzige Bestätigungs-E-Mail für alle Kinder.
              </p>
            )}
          </div>
        )}
      </form>

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

function ChildBlock({
  req,
  child,
  options,
  value,
  onChange,
  editable,
}: {
  req: ConsentRequest;
  child: ConsentChild;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  editable: boolean;
}) {
  const [secondEmail, setSecondEmail] = useState('');
  const [secondMsg, setSecondMsg] = useState('');
  const [secondError, setSecondError] = useState('');

  const addSecond = async () => {
    setSecondError('');
    setSecondMsg('');
    try {
      const res = await api<{ message: string }>('/api/parent/consents/second-parent', {
        method: 'POST',
        body: { eventId: req.eventId, childId: child.id, email: secondEmail },
      });
      setSecondEmail('');
      setSecondMsg(res.message);
    } catch (err) {
      setSecondError(err instanceof ApiError ? err.message : 'Konnte nicht eingetragen werden.');
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
        <div className="consent-options" role="radiogroup" aria-label={`Antwort für ${child.name}`}>
          {options.map((o) => (
            <label key={o.value} className={`consent-option${value === o.value ? ' selected' : ''}`}>
              <input
                type="radio"
                name={`decision-${child.id}`}
                value={o.value}
                checked={value === o.value}
                disabled={!editable}
                onChange={() => onChange(o.value)}
              />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      )}

      {req.open && (
        <details style={{ marginTop: 4 }}>
          <summary style={{ cursor: 'pointer', fontSize: '0.9rem' }}>
            Zweiten Elternteil einladen (optional)
          </summary>
          <p className="muted" style={{ fontSize: '0.85rem', margin: '8px 0' }}>
            Die zweite E-Mail-Adresse erhält eine eigene Einladung und sieht später ebenfalls die
            Fotos.
          </p>
          {secondMsg && <Alert kind="success">{secondMsg}</Alert>}
          {secondError && <Alert kind="error">{secondError}</Alert>}
          {/* Bewusst kein <form>: Dieses Feld liegt innerhalb des Einverständnis-
              Formulars, ein verschachteltes Formular ist in HTML nicht erlaubt. */}
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: '1 1 200px', marginBottom: 0 }}>
              <label htmlFor={`se-${child.id}`}>E-Mail-Adresse</label>
              <input
                id={`se-${child.id}`}
                type="email"
                value={secondEmail}
                onChange={(e) => setSecondEmail(e.target.value)}
              />
            </div>
            <button type="button" className="btn secondary" disabled={!secondEmail} onClick={addSecond}>
              Einladen
            </button>
          </div>
        </details>
      )}
    </div>
  );
}
