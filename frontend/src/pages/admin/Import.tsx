import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { Alert, Modal, Spinner, StatusBadge } from '../../components/common';
import { parseFile, parseDelimited } from '../../lib/tabular';
import { PhotoManager, type ManagedChild, type ManagedPhoto } from './PhotoManager';
import EventEmails from './EventEmails';

// ---------------------------------------------------------------------------
// "Aufträge erfassen" – guided wizard that takes a new order from raw data to a
// published gallery:
//   1. Kinder & E-Mails erfassen – import e-mails/children (paste or CSV/Excel)
//   2. Fotos hochladen           – upload photos (auto-assign by file name)
//   3. Zuordnung prüfen          – review the photo↔child assignment & confirm
//   4. Veröffentlichen           – make the gallery visible to parents
// Each step turns green once completed. Steps 2–4 unlock once step 1 produced
// (or selected) a target order. Inviting the parents is intentionally NOT part
// of the capture wizard – it happens later from the Auftrag (E-Mail-Adressen
// → „Einladung per E-Mail senden“).
// ---------------------------------------------------------------------------

interface WizardEvent {
  id: string;
  name: string;
  status: string;
  expires_at: string | null;
  photos_confirmed_at?: string | null;
}

const STEP_LABELS = [
  'Kinder & E-Mails erfassen',
  'Fotos hochladen',
  'Zuordnung prüfen',
  'Veröffentlichen',
];

export default function AuftraegeErfassen() {
  const [searchParams] = useSearchParams();
  const presetEventId = searchParams.get('eventId') ?? '';

  // Target order the wizard is working on (created/selected in step 1).
  const [eventId, setEventId] = useState<string | null>(null);
  const [event, setEvent] = useState<WizardEvent | null>(null);
  const [children, setChildren] = useState<ManagedChild[]>([]);
  const [photos, setPhotos] = useState<ManagedPhoto[]>([]);
  // Photo count survives across steps (PhotoManager is only mounted on the
  // photo steps); kept in sync by loadEvent and the PhotoManager callback.
  const [photoCount, setPhotoCount] = useState(0);
  const [importDone, setImportDone] = useState(false);
  const [activeStep, setActiveStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [stepError, setStepError] = useState('');
  const [showAddChild, setShowAddChild] = useState(false);

  const loadEvent = async (targetId: string) => {
    const res = await api<{ event: WizardEvent; children: ManagedChild[]; photos: ManagedPhoto[] }>(
      `/api/admin/events/${targetId}`,
      { admin: true },
    );
    setEvent(res.event);
    setChildren(res.children);
    setPhotoCount(res.photos.length);
    return res;
  };

  // When opened from an order ("Importieren" link), preselect it as the target
  // so the photographer can keep enriching an existing Auftrag.
  useEffect(() => {
    if (!presetEventId) return;
    let active = true;
    (async () => {
      try {
        const res = await loadEvent(presetEventId);
        if (!active) return;
        setEventId(presetEventId);
        // An order that already carries children clearly went through the data
        // step before, so mark step 1 as complete.
        if (res.children.length > 0) setImportDone(true);
      } catch {
        /* ignore – the order may have been deleted */
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetEventId]);

  const step1Done = importDone && !!eventId;
  const step2Done = !!eventId && photoCount > 0;
  const step3Done = !!event?.photos_confirmed_at;
  const step4Done = event?.status === 'published';
  const doneFlags = [step1Done, step2Done, step3Done, step4Done];

  // Step n (>1) is reachable once a target order exists.
  const canGoTo = (step: number) => step === 1 || !!eventId;

  const onPhotosChange = (next: ManagedPhoto[]) => {
    setPhotos(next);
    setPhotoCount(next.length);
  };

  const addChild = async (name: string) => {
    if (!eventId) return;
    await api(`/api/admin/events/${eventId}/children`, { method: 'POST', admin: true, body: { name } });
    await loadEvent(eventId);
  };

  const deleteChild = async (childId: string) => {
    if (!eventId) return;
    if (!confirm('Kind löschen? Zuordnungen gehen verloren.')) return;
    await api(`/api/admin/children/${childId}`, { method: 'DELETE', admin: true });
    await loadEvent(eventId);
  };

  const onImported = async (primaryEventId: string | null) => {
    setImportDone(true);
    setStepError('');
    if (primaryEventId) {
      setEventId(primaryEventId);
      try {
        await loadEvent(primaryEventId);
      } catch {
        /* ignore */
      }
      // Skip the intermediate confirmation: after "Jetzt importieren" we move
      // straight to step 2 (Fotos hochladen). The imported children and e-mail
      // addresses can still be reviewed/edited by switching back to step 1.
      setActiveStep(2);
    }
  };

  const confirmAssignment = async () => {
    if (!eventId) return;
    setBusy(true);
    setStepError('');
    try {
      await api(`/api/admin/events/${eventId}`, {
        method: 'PATCH',
        admin: true,
        body: { photos_confirmed_at: new Date().toISOString() },
      });
      await loadEvent(eventId);
      setActiveStep(4);
    } catch (err) {
      setStepError(err instanceof ApiError ? err.message : 'Bestätigung fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (!eventId) return;
    setStepError('');
    if (photoCount === 0) {
      setStepError('Es sind noch keine Fotos in diesem Auftrag. Bitte lade zuerst Fotos hoch.');
      return;
    }
    const unassigned = photos.filter((p) => !p.is_class_photo && !p.child_id).length;
    if (
      unassigned > 0 &&
      !confirm(
        `${unassigned} Foto(s) sind noch keinem Kind zugeordnet und keine Gruppen-/Klassenfotos – sie werden für niemanden sichtbar sein. Trotzdem jetzt veröffentlichen?`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await api(`/api/admin/events/${eventId}`, {
        method: 'PATCH',
        admin: true,
        body: { status: 'published' },
      });
      await loadEvent(eventId);
    } catch (err) {
      setStepError(err instanceof ApiError ? err.message : 'Veröffentlichen fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const unpublish = async () => {
    if (!eventId) return;
    setBusy(true);
    setStepError('');
    try {
      await api(`/api/admin/events/${eventId}`, {
        method: 'PATCH',
        admin: true,
        body: { status: 'draft' },
      });
      await loadEvent(eventId);
    } catch (err) {
      setStepError(err instanceof ApiError ? err.message : 'Aktion fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  // Reset everything to capture a fresh order from scratch.
  const startOver = () => {
    setEventId(null);
    setEvent(null);
    setChildren([]);
    setPhotos([]);
    setPhotoCount(0);
    setImportDone(false);
    setActiveStep(1);
    setStepError('');
  };

  const unassignedCount = photos.filter((p) => !p.is_class_photo && !p.child_id).length;

  return (
    <div>
      <h1>Aufträge erfassen</h1>

      <WizardStepper
        labels={STEP_LABELS}
        done={doneFlags}
        active={activeStep}
        canGoTo={canGoTo}
        onSelect={(step) => {
          if (canGoTo(step)) {
            setStepError('');
            setActiveStep(step);
          }
        }}
      />

      {event && (
        <div className="card mb" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <strong>Auftrag:</strong>
          <Link to={`/admin/events/${event.id}`}>{event.name}</Link>
          <StatusBadge status={event.status} />
          <span className="spacer" style={{ flex: 1 }} />
          <button className="btn ghost small" type="button" onClick={startOver}>
            Weiteren Auftrag erfassen
          </button>
        </div>
      )}

      {stepError && <Alert kind="error">{stepError}</Alert>}

      {activeStep === 1 && (
        <>
          <Step1Data presetEventId={presetEventId} onImported={onImported} done={step1Done} />

          {eventId && (
            <>
              {/* Children of the target order – review what was imported, add or
                  remove individual children without re-importing. */}
              <div className="card mb">
                <div className="row between">
                  <h2 style={{ marginBottom: 0 }}>Kinder</h2>
                  <button className="btn secondary small" onClick={() => setShowAddChild(true)}>
                    + Kind anlegen
                  </button>
                </div>
                {children.length === 0 ? (
                  <p className="muted">Noch keine Kinder angelegt.</p>
                ) : (
                  <div>
                    {children.map((c) => (
                      <span className="chip" key={c.id}>
                        {c.name}
                        <button onClick={() => deleteChild(c.id)} title="Löschen">
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* E-Mail-Adressen (Eltern) dieses Auftrags */}
              <div id="ev-emails">
                <EventEmails eventId={eventId} eventChildren={children} />
              </div>
            </>
          )}
        </>
      )}

      {activeStep === 2 &&
        (eventId ? (
          <div>
            <ChildrenOverview children={children} />
            <PhotoManager
              eventId={eventId}
              children={children}
              mode="upload"
              onPhotosChange={onPhotosChange}
            />
            <div className="card mb" style={{ marginTop: 16 }}>
              <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
                {photoCount === 0
                  ? 'Noch keine Fotos hochgeladen.'
                  : `${photoCount} Foto(s) hochgeladen.`}
              </p>
              <div className="row" style={{ marginTop: 8 }}>
                <button
                  className="btn"
                  type="button"
                  onClick={() => setActiveStep(3)}
                  disabled={photoCount === 0}
                >
                  Weiter zur Zuordnung
                </button>
              </div>
            </div>
          </div>
        ) : (
          <NeedsOrderHint onBack={() => setActiveStep(1)} />
        ))}

      {activeStep === 3 &&
        (eventId ? (
          <div>
            <PhotoManager
              eventId={eventId}
              children={children}
              mode="assign"
              onPhotosChange={onPhotosChange}
            />
            <div className="card mb" style={{ marginTop: 16 }}>
              <h2 style={{ marginTop: 0 }}>Zuordnung bestätigen</h2>
              <p className="muted" style={{ fontSize: '0.85rem' }}>
                {photos.length === 0
                  ? 'Noch keine Fotos hochgeladen.'
                  : unassignedCount === 0
                    ? `Alle ${photos.length} Foto(s) sind zugeordnet oder als Gruppen-/Klassenfoto markiert.`
                    : `${unassignedCount} von ${photos.length} Foto(s) sind noch keinem Kind zugeordnet und kein Gruppen-/Klassenfoto.`}
              </p>
              {step3Done && (
                <Alert kind="success">Die Zuordnung wurde bestätigt – Schritt 3 ist abgeschlossen.</Alert>
              )}
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn" onClick={confirmAssignment} disabled={busy || photos.length === 0}>
                  {step3Done ? 'Zuordnung erneut bestätigen' : 'Zuordnung bestätigen & weiter'}
                </button>
                {step3Done && (
                  <button className="btn secondary" type="button" onClick={() => setActiveStep(4)}>
                    Weiter zu Veröffentlichen
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <NeedsOrderHint onBack={() => setActiveStep(1)} />
        ))}

      {activeStep === 4 &&
        (event ? (
          <div className="card mb">
            <h2 style={{ marginTop: 0 }}>Veröffentlichen</h2>
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              Erst nach dem Veröffentlichen sind die zugeordneten Fotos für berechtigte Eltern
              sichtbar.
            </p>
            {step4Done ? (
              <>
                <Alert kind="success">
                  Der Auftrag ist veröffentlicht – Schritt 4 ist abgeschlossen.
                </Alert>
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="btn ghost" type="button" onClick={unpublish} disabled={busy}>
                    Auf „In Bearbeitung“ zurücksetzen
                  </button>
                </div>
              </>
            ) : (
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn" onClick={publish} disabled={busy}>
                  Jetzt veröffentlichen
                </button>
              </div>
            )}
          </div>
        ) : (
          <NeedsOrderHint onBack={() => setActiveStep(1)} />
        ))}

      {showAddChild && (
        <AddChildModal
          onClose={() => setShowAddChild(false)}
          onCreate={async (name) => {
            await addChild(name);
            setShowAddChild(false);
          }}
        />
      )}
    </div>
  );
}

function AddChildModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setError('');
    setBusy(true);
    try {
      await onCreate(trimmed);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Konnte nicht angelegt werden.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Kind anlegen"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            Abbrechen
          </button>
          <button type="submit" form="add-child-form" className="btn" disabled={busy}>
            {busy ? 'Wird angelegt …' : 'Kind anlegen'}
          </button>
        </>
      }
    >
      <form id="add-child-form" onSubmit={submit}>
        {error && <Alert kind="error">{error}</Alert>}
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Name des Kindes</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="z. B. Alain"
            autoFocus
            required
          />
          <p className="muted" style={{ fontSize: '0.8rem', marginTop: 6, marginBottom: 0 }}>
            Der Name ist nur intern sichtbar – Eltern sehen ihn nie.
          </p>
        </div>
      </form>
    </Modal>
  );
}

// Compact list of all children of the order, shown above the photo upload so
// the photographer can verify they are uploading photos of the right kids.
function ChildrenOverview({ children }: { children: ManagedChild[] }) {
  if (children.length === 0) return null;
  return (
    <div className="card mb">
      <h2 style={{ marginTop: 0, marginBottom: 8 }}>
        Kinder dieses Auftrags ({children.length})
      </h2>
      <div>
        {children.map((c) => (
          <span className="chip" key={c.id}>
            {c.name}
          </span>
        ))}
      </div>
    </div>
  );
}

function NeedsOrderHint({ onBack }: { onBack: () => void }) {
  return (
    <div className="card mb">
      <p className="muted" style={{ marginTop: 0 }}>
        Für diesen Schritt wird zuerst ein Auftrag benötigt. Bitte schliesse Schritt 1 (Daten) ab.
      </p>
      <button className="btn secondary" type="button" onClick={onBack}>
        Zu Schritt 1
      </button>
    </div>
  );
}

function WizardStepper({
  labels,
  done,
  active,
  canGoTo,
  onSelect,
}: {
  labels: string[];
  done: boolean[];
  active: number;
  canGoTo: (step: number) => boolean;
  onSelect: (step: number) => void;
}) {
  return (
    <div className="import-stepper">
      {labels.map((label, i) => {
        const step = i + 1;
        const isDone = done[i];
        const state = isDone ? 'done' : step === active ? 'current' : 'todo';
        const reachable = canGoTo(step);
        return (
          <button
            key={label}
            type="button"
            className={`import-step ${state}`}
            disabled={!reachable}
            onClick={() => onSelect(step)}
            style={{
              cursor: reachable ? 'pointer' : 'not-allowed',
              background: 'none',
              width: 'auto',
              font: 'inherit',
              opacity: reachable ? 1 : 0.55,
              boxShadow: step === active ? '0 0 0 2px var(--primary)' : undefined,
            }}
          >
            <span className="import-step-marker">{isDone ? '✓' : step}</span>
            <span className="import-step-label">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ===========================================================================
// Step 1: data import (paste / CSV / Excel). On "Jetzt importieren" the order
// is created/selected and the wizard advances to the photo step.
// ===========================================================================

type Role = 'email' | 'name' | 'child' | 'event' | 'note' | 'ignore';

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'ignore', label: '— ignorieren —' },
  { value: 'email', label: 'E-Mail' },
  { value: 'name', label: 'Name Eltern' },
  { value: 'child', label: 'Kind' },
  { value: 'event', label: 'Auftrag' },
  { value: 'note', label: 'Notiz' },
];

interface Column {
  index: number;
  header: string;
  role: Role;
  sample: string;
}
interface PlanEmail {
  email: string;
  valid: boolean;
}
interface PlanRow {
  rowIndex: number;
  emails: PlanEmail[];
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
interface Mapping {
  email?: number[];
  name?: number;
  child?: number;
  event?: number;
  note?: number;
}
interface PreviewResp {
  hasHeader: boolean;
  mapping: Mapping;
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
  eventIds: string[];
  primaryEventId: string | null;
}
interface EventRow {
  id: string;
  name: string;
}

interface ManualEntry {
  uid: number;
  auftrag: string;
  kind: string;
  email: string;
  parentName: string;
  note: string;
}

const EXAMPLE = `E-Mail\tE-Mail 2\tKind\tName Eltern\tAuftrag
anna@beispiel.de, oma@beispiel.de\tpapa@beispiel.de\tLena Müller\tFamilie Müller\tKlasse 3b
paul@beispiel.de\t\tTim Weber, Lisa Weber\tPaul Weber\tKlasse 3b`;

/** Mirrors the backend e-mail validation (see services/import.ts). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Splits a cell into individual e-mail addresses (comma/semicolon/whitespace separated). */
function splitEmails(cell: string): string[] {
  return String(cell ?? '')
    .split(/[\s,;/|]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

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

function Step1Data({
  presetEventId,
  onImported,
  done,
}: {
  presetEventId: string;
  onImported: (primaryEventId: string | null) => void;
  done: boolean;
}) {
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

  const [targetMode, setTargetMode] = useState<'existing' | 'new'>('existing');
  const [defaultEventId, setDefaultEventId] = useState('');
  const [defaultEventName, setDefaultEventName] = useState('');
  const [createMissingEvents, setCreateMissingEvents] = useState(true);

  // "Manuelle Eingabe": fields are typed in directly instead of pasting/uploading.
  const [manualOpen, setManualOpen] = useState(false);

  useEffect(() => {
    api<{ events: EventRow[] }>('/api/admin/events', { admin: true })
      .then((r) => {
        setEvents(r.events);
        if (presetEventId && r.events.some((e) => e.id === presetEventId)) {
          setTargetMode('existing');
          setDefaultEventId(presetEventId);
        }
      })
      .catch(() => undefined);
  }, [presetEventId]);

  const scrollToTop = () => {
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const resetImport = () => {
    setText('');
    setRows([]);
    setPreview(null);
    setResult(null);
    setError('');
    setLoading(false);
    setCommitting(false);
    setTargetMode('existing');
    setDefaultEventId(presetEventId || '');
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
    const next: Mapping = {
      email: [...(preview.mapping.email ?? [])],
      name: preview.mapping.name,
      child: preview.mapping.child,
      event: preview.mapping.event,
      note: preview.mapping.note,
    };
    next.email = (next.email ?? []).filter((i) => i !== index);
    (['name', 'child', 'event', 'note'] as const).forEach((k) => {
      if (next[k] === index) next[k] = undefined;
    });
    if (role === 'email') {
      next.email = [...(next.email ?? []), index].sort((a, b) => a - b);
    } else if (role !== 'ignore') {
      next[role] = index;
    }
    if ((next.email ?? []).length === 0) delete next.email;
    runPreview(rows, next, preview.hasHeader);
  };

  const toggleHeader = (checked: boolean) => {
    if (!preview) return;
    runPreview(rows, preview.mapping, checked);
  };

  const planRows = preview?.plan.rows ?? [];
  const assignedNames = Array.from(
    new Map(
      planRows
        .map((r) => r.eventName.trim())
        .filter((n) => n !== '')
        .map((n) => [normalizeName(n), n] as const),
    ).values(),
  );
  const unassignedCount = planRows.filter((r) => !r.eventName.trim()).length;
  const needsTarget = unassignedCount > 0;
  const existingNames = new Set(events.map((e) => normalizeName(e.name)));
  const orderIsNew = (name: string) => !existingNames.has(normalizeName(name));
  const noValidEmails = (preview?.plan.totals.distinctEmails ?? 0) === 0;
  const warningRows = preview?.plan.rows.filter((r) => r.warnings.length > 0) ?? [];

  const commit = async () => {
    if (!preview) return;
    if (preview.plan.totals.distinctEmails === 0) {
      setError(
        'Es wurde keine gültige E-Mail-Adresse erkannt. Bitte ordne mindestens eine Spalte der Rolle „E-Mail“ zu und prüfe die Schreibweise.',
      );
      scrollToTop();
      return;
    }
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
      onImported(res.result.primaryEventId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import fehlgeschlagen.');
      scrollToTop();
    } finally {
      setCommitting(false);
    }
  };

  // Commit manually typed entries by turning them into the same rows/mapping the
  // paste/upload flow produces, so the backend import logic is fully reused.
  const commitManual = async (entries: ManualEntry[]) => {
    const rows = entries.map((e) => [
      e.email.trim(),
      e.kind.trim(),
      e.parentName.trim(),
      e.auftrag.trim(),
      e.note.trim(),
    ]);
    const mapping: Mapping = { email: [0], child: 1, name: 2, event: 3, note: 4 };
    setCommitting(true);
    setError('');
    try {
      const res = await api<{ result: CommitResult }>('/api/admin/import/commit', {
        method: 'POST',
        admin: true,
        body: { rows, mapping, hasHeader: false, createMissingEvents: true },
      });
      setResult(res.result);
      setPreview(null);
      setRows([]);
      setText('');
      setManualOpen(false);
      if (fileRef.current) fileRef.current.value = '';
      onImported(res.result.primaryEventId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen.');
      scrollToTop();
      throw err;
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div>
      <div ref={topRef} />

      {done && (
        <Alert kind="success">
          Die Daten wurden importiert – Schritt 1 ist abgeschlossen. Du kannst weitere Daten
          ergänzen oder oben zum nächsten Schritt wechseln.
        </Alert>
      )}

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

      {/* Daten einfügen oder Datei hochladen */}
      <div className="card mb">
        <h2>Daten einfügen oder Datei hochladen</h2>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Empfohlene Spalten: <strong>E-Mail</strong>, <strong>Kind</strong> (vollständiger Name),
          {' '}optional <strong>Name Eltern</strong>, <strong>Auftrag</strong> und <strong>Notiz</strong>.
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
          <button className="btn secondary" type="button" onClick={() => fileRef.current?.click()}>
            Datei auswählen
          </button>
          <button
            className={`btn ${manualOpen ? '' : 'secondary'}`}
            type="button"
            onClick={() => setManualOpen((v) => !v)}
            title="Felder selbst eintragen – ohne Datei oder Tabelle"
          >
            Manuelle Eingabe
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xls"
            style={{ display: 'none' }}
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
        </div>
      </div>

      {manualOpen && (
        <ManualEntryForm
          events={events}
          committing={committing}
          onCancel={() => setManualOpen(false)}
          onSubmit={commitManual}
        />
      )}

      {loading && <Spinner label="Vorschau wird erstellt …" />}

      {preview && !loading && (
        <>
          <div className="card mb">
            <h2>Spalten zuordnen</h2>
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
            <h2>Ziel-Auftrag</h2>

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
            <h2>Vorschau &amp; Import</h2>
            <p className="row" style={{ gap: 18 }}>
              <span><strong>{preview.plan.totals.rows}</strong> Zeilen</span>
              <span><strong>{preview.plan.totals.distinctEmails}</strong> E-Mail-Adressen</span>
              <span><strong>{preview.plan.totals.children}</strong> Kinder-Einträge</span>
              {preview.plan.totals.skipped > 0 && (
                <span className="muted">{preview.plan.totals.skipped} leere Zeilen übersprungen</span>
              )}
            </p>
            {noValidEmails && (
              <Alert kind="error">
                Es wurde keine gültige E-Mail-Adresse erkannt. Bitte ordne oben unter „Spalten
                zuordnen“ mindestens eine Spalte der Rolle „E-Mail“ zu. Ohne E-Mail-Adresse kann
                nicht importiert werden.
              </Alert>
            )}
            {!noValidEmails && warningRows.length > 0 && (
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
                      <td>
                        {r.emails.length === 0
                          ? '—'
                          : r.emails.map((e, idx) => (
                              <span key={`${e.email}-${idx}`}>
                                {idx > 0 && ', '}
                                <span style={!e.valid ? { color: 'var(--danger)' } : undefined}>
                                  {e.email}
                                </span>
                              </span>
                            ))}
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
              <button className="btn" onClick={commit} disabled={committing || noValidEmails}>
                {committing ? 'Import läuft …' : 'Jetzt importieren'}
              </button>
              <button
                className="btn secondary"
                type="button"
                onClick={resetImport}
                disabled={committing}
                title="Alle eingetragenen Daten verwerfen und die Seite zurücksetzen"
              >
                Eingaben verwerfen
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ===========================================================================
// Manuelle Eingabe: type children/e-mails directly instead of pasting or
// uploading a table. One shared Auftrag (required) holds any number of child
// entries; each child needs a name ("Kind") and at least one e-mail. The rest
// (Name Eltern, Notiz) is optional. On save the entries are committed through
// the normal import endpoint and the wizard advances to "Fotos hochladen".
// ===========================================================================

let manualUid = 1;
const makeManualEntry = (auftrag = ''): ManualEntry => ({
  uid: manualUid++,
  auftrag,
  kind: '',
  email: '',
  parentName: '',
  note: '',
});

function ManualEntryForm({
  events,
  committing,
  onCancel,
  onSubmit,
}: {
  events: EventRow[];
  committing: boolean;
  onCancel: () => void;
  onSubmit: (entries: ManualEntry[]) => Promise<void>;
}) {
  const [auftrag, setAuftrag] = useState('');
  const [entries, setEntries] = useState<ManualEntry[]>([makeManualEntry()]);
  const [error, setError] = useState('');

  const updateEntry = (uid: number, patch: Partial<ManualEntry>) => {
    setEntries((prev) => prev.map((e) => (e.uid === uid ? { ...e, ...patch } : e)));
  };
  const addEntry = () => setEntries((prev) => [...prev, makeManualEntry()]);
  const removeEntry = (uid: number) =>
    setEntries((prev) => (prev.length <= 1 ? prev : prev.filter((e) => e.uid !== uid)));

  const submit = async () => {
    setError('');
    const order = auftrag.trim();
    if (!order) {
      setError('Bitte einen Auftrag angeben.');
      return;
    }
    // Keep only entries the user actually started filling in.
    const filled = entries.filter((e) => e.kind.trim() || e.email.trim());
    if (filled.length === 0) {
      setError('Bitte mindestens ein Kind mit Name und E-Mail eintragen.');
      return;
    }
    for (const e of filled) {
      if (!e.kind.trim()) {
        setError('Jedes Kind benötigt einen Namen (Pflichtfeld „Kind“).');
        return;
      }
      const mails = splitEmails(e.email);
      if (mails.length === 0) {
        setError(`Bitte eine E-Mail für „${e.kind.trim()}“ eintragen (Pflichtfeld „E-Mail“).`);
        return;
      }
      const invalid = mails.find((m) => !EMAIL_RE.test(m));
      if (invalid) {
        setError(`„${invalid}“ ist keine gültige E-Mail-Adresse.`);
        return;
      }
    }
    try {
      await onSubmit(filled.map((e) => ({ ...e, auftrag: order })));
    } catch {
      /* error is surfaced by the parent */
    }
  };

  return (
    <div className="card mb">
      <h2 style={{ marginTop: 0 }}>Manuelle Eingabe</h2>
      <p className="muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
        Trage die Daten direkt ein – ohne Datei oder Tabelle. <strong>Auftrag</strong>,{' '}
        <strong>Kind</strong> und <strong>E-Mail</strong> sind Pflichtfelder, der Rest ist optional.
      </p>

      {error && <Alert kind="error">{error}</Alert>}

      <div className="field">
        <label>
          Auftrag <span style={{ color: 'var(--danger)' }}>*</span>
        </label>
        <input
          value={auftrag}
          onChange={(e) => setAuftrag(e.target.value)}
          placeholder="z. B. Klasse 3b"
          list="manual-auftrag-list"
          autoFocus
        />
        <datalist id="manual-auftrag-list">
          {events.map((ev) => (
            <option key={ev.id} value={ev.name} />
          ))}
        </datalist>
        <p className="muted" style={{ fontSize: '0.8rem', marginTop: 6, marginBottom: 0 }}>
          Existiert der Auftrag bereits, werden die Kinder ergänzt – sonst wird er neu angelegt.
        </p>
      </div>

      <h3 style={{ marginBottom: 8 }}>Kinder</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {entries.map((entry, i) => (
          <div
            key={entry.uid}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: 12,
              position: 'relative',
            }}
          >
            <div className="row between" style={{ marginBottom: 8 }}>
              <strong>Kind {i + 1}</strong>
              {entries.length > 1 && (
                <button
                  type="button"
                  className="btn ghost small"
                  onClick={() => removeEntry(entry.uid)}
                  title="Diesen Eintrag entfernen"
                >
                  Entfernen
                </button>
              )}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 12,
              }}
            >
              <div className="field" style={{ marginBottom: 0 }}>
                <label>
                  Kind <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  value={entry.kind}
                  onChange={(e) => updateEntry(entry.uid, { kind: e.target.value })}
                  placeholder="z. B. Lena Müller"
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>
                  E-Mail <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  value={entry.email}
                  onChange={(e) => updateEntry(entry.uid, { email: e.target.value })}
                  placeholder="z. B. anna@beispiel.de"
                />
                <p className="muted" style={{ fontSize: '0.75rem', marginTop: 4, marginBottom: 0 }}>
                  Mehrere durch Komma trennen.
                </p>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Name Eltern</label>
                <input
                  value={entry.parentName}
                  onChange={(e) => updateEntry(entry.uid, { parentName: e.target.value })}
                  placeholder="optional"
                />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Notiz</label>
                <input
                  value={entry.note}
                  onChange={(e) => updateEntry(entry.uid, { note: e.target.value })}
                  placeholder="optional"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="btn secondary small" onClick={addEntry} disabled={committing}>
          + weiteres Kind
        </button>
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <button type="button" className="btn" onClick={submit} disabled={committing}>
          {committing ? 'Wird gespeichert …' : 'Speichern & weiter zu Fotos'}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel} disabled={committing}>
          Abbrechen
        </button>
      </div>
    </div>
  );
}
