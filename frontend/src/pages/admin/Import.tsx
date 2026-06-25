import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../api/client';
import { Alert, Spinner } from '../../components/common';
import { parseFile, parseDelimited } from '../../lib/tabular';

type Role = 'email' | 'name' | 'first_name' | 'last_name' | 'child' | 'event' | 'note' | 'ignore';

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'ignore', label: '— ignorieren —' },
  { value: 'email', label: 'E-Mail' },
  { value: 'name', label: 'Eltern-/Familienname' },
  { value: 'first_name', label: 'Vorname' },
  { value: 'last_name', label: 'Nachname' },
  { value: 'child', label: 'Kind' },
  { value: 'event', label: 'Auftrag / Klasse' },
  { value: 'note', label: 'Notiz' },
];

interface Column {
  index: number;
  header: string;
  role: Role;
  sample: string;
}
interface PlanRow {
  rowIndex: number;
  email: string;
  emailValid: boolean;
  parentName: string;
  childNames: string[];
  eventName: string;
  note: string;
  warnings: string[];
}
interface Plan {
  rows: PlanRow[];
  totals: { rows: number; withEmail: number; distinctEmails: number; children: number; skipped: number };
}
interface PreviewResp {
  hasHeader: boolean;
  mapping: Partial<Record<Exclude<Role, 'ignore'>, number>>;
  columns: Column[];
  rowCount: number;
  plan: Plan;
}
interface CommitResult {
  emailsCreated: number;
  emailsExisting: number;
  childrenCreated: number;
  childrenExisting: number;
  linksCreated: number;
  linksExisting: number;
  eventsCreated: number;
  rowsSkipped: number;
  warnings: string[];
}
interface EventRow {
  id: string;
  name: string;
}

const EXAMPLE = `E-Mail\tVorname\tNachname\tKind\tAuftrag
anna@beispiel.de\tAnna\tMüller\tLena Müller\tKlasse 3b
paul@beispiel.de\tPaul\tWeber\tTim Weber, Lisa Weber\tKlasse 3b`;

/** Mirrors the backend `normalizeName`: lowercases, strips accents/ß, collapses whitespace. */
function normalizeName(input: string): string {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export default function Import() {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<string[][]>([]);
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CommitResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const topRef = useRef<HTMLDivElement>(null);

  // target event selection
  const [targetMode, setTargetMode] = useState<'existing' | 'new'>('existing');
  const [defaultEventId, setDefaultEventId] = useState('');
  const [defaultEventName, setDefaultEventName] = useState('');
  const [createMissingEvents, setCreateMissingEvents] = useState(true);

  useEffect(() => {
    api<{ events: EventRow[] }>('/api/admin/events', { admin: true })
      .then((r) => setEvents(r.events))
      .catch(() => undefined);
  }, []);

  const scrollToTop = () => {
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Reset the whole import page back to its initial (empty) state.
  const resetImport = () => {
    setText('');
    setRows([]);
    setPreview(null);
    setResult(null);
    setError('');
    setLoading(false);
    setCommitting(false);
    setTargetMode('existing');
    setDefaultEventId('');
    setDefaultEventName('');
    setCreateMissingEvents(true);
    if (fileRef.current) fileRef.current.value = '';
    scrollToTop();
  };

  const runPreview = async (
    rowsArg: string[][],
    mapping?: PreviewResp['mapping'],
    hasHeader?: boolean,
  ) => {
    setError('');
    setResult(null);
    if (rowsArg.length === 0) {
      setError('Keine Daten gefunden. Bitte Tabelle einfügen oder Datei wählen.');
      return;
    }
    setLoading(true);
    try {
      const res = await api<PreviewResp>('/api/admin/import/preview', {
        method: 'POST',
        admin: true,
        body: { rows: rowsArg, mapping, hasHeader },
      });
      setPreview(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Vorschau fehlgeschlagen.');
    } finally {
      setLoading(false);
    }
  };

  const previewFromPaste = async () => {
    const parsed = parseDelimited(text);
    setRows(parsed);
    await runPreview(parsed);
  };

  const onFile = async (file: File) => {
    setError('');
    try {
      const parsed = await parseFile(file);
      setRows(parsed);
      setText(parsed.map((r) => r.join('\t')).join('\n'));
      await runPreview(parsed);
    } catch {
      setError('Datei konnte nicht gelesen werden. Unterstützt: CSV, TSV, TXT, XLSX.');
    }
  };

  const setColumnRole = (index: number, role: Role) => {
    if (!preview) return;
    const next: PreviewResp['mapping'] = { ...preview.mapping };
    for (const k of Object.keys(next) as (keyof typeof next)[]) {
      if (next[k] === index) delete next[k];
    }
    if (role !== 'ignore') next[role] = index;
    runPreview(rows, next, preview.hasHeader);
  };

  const toggleHeader = (checked: boolean) => {
    if (!preview) return;
    runPreview(rows, preview.mapping, checked);
  };

  const commit = async () => {
    if (!preview) return;
    // A fallback target is only required when at least one row has no order of
    // its own. Rows that carry an "Auftrag" value are assigned automatically.
    if (needsTarget) {
      if (targetMode === 'existing' && !defaultEventId) {
        setError('Bitte einen Ziel-Auftrag für die nicht zugewiesenen Zeilen wählen oder einen neuen anlegen.');
        scrollToTop();
        return;
      }
      if (targetMode === 'new' && !defaultEventName.trim()) {
        setError('Bitte einen Namen für den neuen Auftrag eingeben.');
        scrollToTop();
        return;
      }
    }
    setCommitting(true);
    setError('');
    try {
      const res = await api<{ result: CommitResult }>('/api/admin/import/commit', {
        method: 'POST',
        admin: true,
        body: {
          rows,
          mapping: preview.mapping,
          hasHeader: preview.hasHeader,
          defaultEventId: needsTarget && targetMode === 'existing' ? defaultEventId : undefined,
          defaultEventName: needsTarget && targetMode === 'new' ? defaultEventName.trim() : undefined,
          createMissingEvents,
        },
      });
      setResult(res.result);
      setPreview(null);
      setRows([]);
      setText('');
      if (fileRef.current) fileRef.current.value = '';
      api<{ events: EventRow[] }>('/api/admin/events', { admin: true })
        .then((r) => setEvents(r.events))
        .catch(() => undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import fehlgeschlagen.');
      scrollToTop();
    } finally {
      setCommitting(false);
    }
  };

  const warningRows = preview?.plan.rows.filter((r) => r.warnings.length > 0) ?? [];

  // Orders the import file already assigns per row (via the "Auftrag" column).
  // These are handled automatically – the admin does not have to choose anything.
  const planRows = preview?.plan.rows ?? [];
  const assignedNames = Array.from(
    new Map(
      planRows
        .map((r) => r.eventName.trim())
        .filter((n) => n !== '')
        .map((n) => [normalizeName(n), n] as const),
    ).values(),
  );
  // Rows without an "Auftrag" value cannot be auto-assigned and need a target.
  const unassignedCount = planRows.filter((r) => !r.eventName.trim()).length;
  const needsTarget = unassignedCount > 0;
  const existingNames = new Set(events.map((e) => normalizeName(e.name)));
  const orderIsNew = (name: string) => !existingNames.has(normalizeName(name));

  return (
    <div>
      <div ref={topRef} />
      <h1>Import</h1>
      <p className="soft">
        Lege E-Mail-Adressen, Kinder und ihre Verknüpfungen in einem Schritt an – per Kopieren &amp;
        Einfügen aus Excel oder über eine CSV-/Excel-Datei.
      </p>

      {error && <Alert kind="error">{error}</Alert>}

      {result && (
        <div className="card mb">
          <Alert kind="success">Import abgeschlossen.</Alert>
          <ul style={{ margin: 0, lineHeight: 1.7 }}>
            <li>{result.emailsCreated} E-Mail-Adressen neu angelegt ({result.emailsExisting} bereits vorhanden)</li>
            <li>{result.childrenCreated} Kinder neu angelegt ({result.childrenExisting} bereits vorhanden)</li>
            <li>{result.linksCreated} Verknüpfungen erstellt ({result.linksExisting} bereits vorhanden)</li>
            {result.eventsCreated > 0 && <li>{result.eventsCreated} Auftrag/Aufträge neu angelegt</li>}
            {result.rowsSkipped > 0 && <li>{result.rowsSkipped} Zeile(n) übersprungen</li>}
          </ul>
          {result.warnings.length > 0 && (
            <details style={{ marginTop: 10 }}>
              <summary>{result.warnings.length} Hinweise</summary>
              <ul>
                {result.warnings.slice(0, 50).map((w, i) => (
                  <li key={i} className="muted">{w}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* Step 1: input */}
      <div className="card mb">
        <h2>1. Daten einfügen oder Datei hochladen</h2>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Empfohlene Spalten: <strong>E-Mail</strong>, <strong>Vorname</strong>,
          {' '}<strong>Nachname</strong>, <strong>Kind</strong>, optional <strong>Auftrag</strong> und
          {' '}<strong>Notiz</strong>. Die Reihenfolge und Schreibweise der Spalten ist egal – sie
          werden automatisch erkannt und lassen sich unten anpassen.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder={EXAMPLE}
          style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.85rem' }}
        />
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={previewFromPaste} disabled={loading || !text.trim()}>
            Tabelle auswerten
          </button>
          <button className="btn secondary" type="button" onClick={() => setText(EXAMPLE)}>
            Beispiel einfügen
          </button>
          <span className="muted" style={{ fontSize: '0.85rem' }}>oder</span>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xls"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
        </div>
      </div>

      {loading && <Spinner label="Vorschau wird erstellt …" />}

      {/* Step 2: mapping + preview */}
      {preview && !loading && (
        <>
          <div className="card mb">
            <h2>2. Spalten zuordnen</h2>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={preview.hasHeader}
                style={{ width: 'auto' }}
                onChange={(e) => toggleHeader(e.target.checked)}
              />
              Erste Zeile ist eine Überschrift
            </label>
            <div style={{ overflowX: 'auto', marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>Spalte</th>
                    <th>Bedeutung</th>
                    <th>Beispiel</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.columns.map((c) => (
                    <tr key={c.index}>
                      <td><strong>{c.header}</strong></td>
                      <td>
                        <select
                          value={c.role}
                          onChange={(e) => setColumnRole(c.index, e.target.value as Role)}
                          style={{ width: 200 }}
                        >
                          {ROLE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="muted">{c.sample || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card mb">
            <h2>3. Ziel-Auftrag</h2>

            {assignedNames.length > 0 && (
              <div style={{ marginBottom: needsTarget ? 18 : 0 }}>
                <p style={{ margin: '0 0 6px', fontWeight: 600 }}>Auftrag gemäss Importdatei</p>
                <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
                  Diese {assignedNames.length === 1 ? 'Zuordnung wurde' : 'Zuordnungen wurden'} automatisch
                  aus der Auftrag-Spalte erkannt – hier ist keine Auswahl nötig:
                </p>
                <ul style={{ margin: '6px 0 0', lineHeight: 1.7 }}>
                  {assignedNames.map((name) => (
                    <li key={name}>
                      {name}
                      {orderIsNew(name) && (
                        <span className="muted" style={{ fontSize: '0.8rem' }}>
                          {' '}— {createMissingEvents ? 'wird neu angelegt' : 'noch nicht vorhanden'}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
                  <input
                    type="checkbox"
                    checked={createMissingEvents}
                    style={{ width: 'auto' }}
                    onChange={(e) => setCreateMissingEvents(e.target.checked)}
                  />
                  Aufträge aus der Auftrag-Spalte automatisch anlegen, falls sie noch nicht existieren
                </label>
              </div>
            )}

            {needsTarget && (
              <div>
                <p className="muted" style={{ fontSize: '0.85rem', marginTop: assignedNames.length > 0 ? 0 : undefined }}>
                  <strong>{unassignedCount}</strong> Zeile(n) ohne Auftrag-Angabe konnten keinem Auftrag
                  zugewiesen werden. Bitte lege fest, wohin diese Einträge gehören – entweder in einen
                  bestehenden oder in einen neu angelegten Auftrag.
                </p>
                <div className="row">
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="radio"
                      name="target"
                      checked={targetMode === 'existing'}
                      style={{ width: 'auto' }}
                      onChange={() => setTargetMode('existing')}
                    />
                    Bestehender Auftrag
                  </label>
                  <select
                    disabled={targetMode !== 'existing'}
                    value={defaultEventId}
                    onChange={(e) => setDefaultEventId(e.target.value)}
                    style={{ width: 260 }}
                  >
                    <option value="">— Auftrag wählen —</option>
                    {events.map((ev) => (
                      <option key={ev.id} value={ev.id}>{ev.name}</option>
                    ))}
                  </select>
                </div>
                <div className="row" style={{ marginTop: 10 }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="radio"
                      name="target"
                      checked={targetMode === 'new'}
                      style={{ width: 'auto' }}
                      onChange={() => setTargetMode('new')}
                    />
                    Neuen Auftrag anlegen
                  </label>
                  <input
                    disabled={targetMode !== 'new'}
                    value={defaultEventName}
                    onChange={(e) => setDefaultEventName(e.target.value)}
                    placeholder="z. B. Kindergarten Sonnenschein"
                    style={{ width: 260 }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="card mb">
            <h2>4. Vorschau &amp; Import</h2>
            <p className="row" style={{ gap: 18 }}>
              <span><strong>{preview.plan.totals.rows}</strong> Zeilen</span>
              <span><strong>{preview.plan.totals.distinctEmails}</strong> E-Mail-Adressen</span>
              <span><strong>{preview.plan.totals.children}</strong> Kinder-Einträge</span>
              {preview.plan.totals.skipped > 0 && (
                <span className="muted">{preview.plan.totals.skipped} leere Zeilen übersprungen</span>
              )}
            </p>
            {warningRows.length > 0 && (
              <Alert kind="info">
                {warningRows.length} Zeile(n) mit Hinweisen (z. B. ohne gültige E-Mail). Diese werden
                trotzdem so gut wie möglich verarbeitet.
              </Alert>
            )}
            <div style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>E-Mail</th>
                    <th>Name</th>
                    <th>Kind(er)</th>
                    <th>Auftrag</th>
                    <th>Hinweis</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.plan.rows.slice(0, 200).map((r) => (
                    <tr key={r.rowIndex}>
                      <td className={r.email && !r.emailValid ? 'soft' : ''} style={r.email && !r.emailValid ? { color: 'var(--danger)' } : undefined}>
                        {r.email || '—'}
                      </td>
                      <td>{r.parentName || '—'}</td>
                      <td>{r.childNames.join(', ') || '—'}</td>
                      <td>{r.eventName || '—'}</td>
                      <td className="muted" style={{ fontSize: '0.8rem' }}>{r.warnings.join(' ') || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.plan.rows.length > 200 && (
              <p className="muted" style={{ fontSize: '0.8rem' }}>
                … nur die ersten 200 von {preview.plan.rows.length} Zeilen werden in der Vorschau
                angezeigt. Es werden alle Zeilen importiert.
              </p>
            )}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={commit} disabled={committing}>
                {committing ? 'Import läuft …' : 'Jetzt importieren'}
              </button>
              <button
                className="btn secondary"
                type="button"
                onClick={resetImport}
                disabled={committing}
                title="Alle eingetragenen Daten verwerfen und die Seite zurücksetzen"
              >
                Import abbrechen
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
