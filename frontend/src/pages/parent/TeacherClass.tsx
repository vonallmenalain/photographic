import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { Alert, Spinner, TrustNote } from '../../components/common';
import { formatDate } from '../../lib/format';
import {
  ClassLinkBox,
  InviteForm,
  RosterTable,
  StatRow,
  type ParentLink,
  type Roster,
} from '../../components/registration';

interface Registration {
  school: string;
  shooting_date_text: string;
  deadline_text: string;
  teacher_name: string;
  teacher_enters_emails: boolean;
  parent_link_enabled: boolean;
  consent_required: boolean;
  teacher_completed_at: string | null;
  last_reminder_at: string | null;
  open: boolean;
}
interface ClassResponse {
  event: { id: string; name: string; status: string };
  registration: Registration;
  roster: Roster;
  parentLink: ParentLink | null;
  devLogOnly: boolean;
}

/**
 * Klassenseite der Lehrperson: Kinder eintragen, Stand der Einverständnisse
 * sehen, Eltern einladen (wenn vom Fotografen so vorgesehen), Klassenlink und
 * QR-Code weitergeben, erinnern und die Erfassung als vollständig melden.
 * E-Mail-Adressen erscheinen nur, wenn die Lehrperson sie selbst erfasst.
 */
export default function TeacherClass() {
  const { id = '' } = useParams();
  const [data, setData] = useState<ClassResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [names, setNames] = useState('');
  const [busy, setBusy] = useState(false);

  const base = `/api/teacher/classes/${id}`;

  const load = async () => {
    try {
      setData(await api<ClassResponse>(base));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Klasse konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const run = async (fn: () => Promise<void>, fallback: string) => {
    setError('');
    setMsg('');
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  const addNames = () =>
    run(async () => {
      const list = names
        .split(/\r?\n/)
        .map((n) => n.trim())
        .filter(Boolean);
      if (list.length === 0) return;
      const res = await api<{ created: string[]; existing: string[] }>(`${base}/children`, {
        method: 'POST',
        body: { names: list },
      });
      setNames('');
      setMsg(
        `${res.created.length} Kind(er) eingetragen${res.existing.length ? `, ${res.existing.length} bereits vorhanden` : ''}.`,
      );
    }, 'Kinder konnten nicht eingetragen werden.');

  const remind = () =>
    run(async () => {
      if (!confirm('Erinnerung an alle Eltern schicken, deren Kind noch keine Antwort hat?')) return;
      const res = await api<{ sent: number; failed: string[]; withoutEmail: number }>(`${base}/remind`, {
        method: 'POST',
      });
      setMsg(
        `Erinnerung an ${res.sent} Adresse(n) verschickt.${res.withoutEmail ? ` ${res.withoutEmail} Kind(er) ohne bekannte Adresse konnten nicht erinnert werden.` : ''}${res.failed.length ? ` Fehlgeschlagen: ${res.failed.join(', ')}` : ''}`,
      );
    }, 'Erinnerung konnte nicht verschickt werden.');

  const complete = () =>
    run(async () => {
      if (
        !confirm(
          'Die Erfassung als vollständig melden? Der Fotograf wird informiert. Sie können danach weiterhin Einträge ergänzen.',
        )
      )
        return;
      await api(`${base}/complete`, { method: 'POST' });
      setMsg('Vielen Dank, der Fotograf wurde informiert.');
    }, 'Meldung fehlgeschlagen.');

  const rosterActions = useMemo(
    () => ({
      rename: (childId: string, name: string) =>
        run(() => api(`${base}/children/${childId}`, { method: 'PATCH', body: { name } }).then(() => undefined), 'Umbenennen fehlgeschlagen.'),
      confirm: (childId: string) =>
        run(() => api(`${base}/children/${childId}`, { method: 'PATCH', body: { confirm: true } }).then(() => undefined), 'Bestätigen fehlgeschlagen.'),
      merge: (childId: string, targetId: string) =>
        run(() => api(`${base}/children/${childId}`, { method: 'PATCH', body: { mergeInto: targetId } }).then(() => undefined), 'Zusammenführen fehlgeschlagen.'),
      remove: (childId: string) =>
        run(async () => {
          if (!confirm('Diesen Eintrag entfernen?')) return;
          await api(`${base}/children/${childId}`, { method: 'DELETE' });
        }, 'Entfernen fehlgeschlagen.'),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base],
  );

  if (loading) return <Spinner label="Klasse wird geladen …" />;
  if (!data) {
    return (
      <div className="narrow" style={{ margin: '0 auto' }}>
        <Alert kind="error">{error || 'Klasse nicht gefunden.'}</Alert>
        <Link to="/klasse">Zu meinen Klassen</Link>
      </div>
    );
  }

  const reg = data.registration;
  const open = reg.open;
  const facts = [
    reg.school,
    reg.shooting_date_text ? `Fototermin ${reg.shooting_date_text}` : '',
    reg.deadline_text ? `Rückmeldung bis ${reg.deadline_text}` : '',
  ].filter(Boolean);

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto' }}>
      <p style={{ marginBottom: 6 }}>
        <Link to="/klasse">← Meine Klassen</Link>
      </p>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>Klasse {data.event.name}</h1>
          {facts.length > 0 && (
            <p className="muted" style={{ marginTop: 0 }}>
              {facts.join(' · ')}
            </p>
          )}
        </div>
        <span className={`badge ${open ? 'green' : 'gray'}`}>
          {open ? 'Erfassung läuft' : 'Erfassung abgeschlossen'}
        </span>
      </div>

      {!open && (
        <Alert kind="info">
          Der Fotograf hat die Klasse übernommen. Die Liste ist hier weiterhin sichtbar, Änderungen
          sind nicht mehr möglich.
        </Alert>
      )}
      {data.devLogOnly && (
        <Alert kind="info">Testbetrieb: E-Mails werden nicht verschickt, sondern nur protokolliert.</Alert>
      )}
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}

      <StatRow stats={data.roster.stats} consentRequired={reg.consent_required} />

      <div className="card mb">
        <div className="row between">
          <h2 style={{ marginBottom: 0 }}>Klassenliste</h2>
          {open && reg.consent_required && data.roster.stats.invited_pending > 0 && (
            <button className="btn secondary small" type="button" onClick={remind} disabled={busy}>
              Erinnerung an Ausstehende senden
            </button>
          )}
        </div>
        {reg.last_reminder_at && (
          <p className="muted" style={{ fontSize: '0.82rem', margin: '4px 0 0' }}>
            Letzte Erinnerung: {formatDate(reg.last_reminder_at)}
          </p>
        )}
        <RosterTable
          roster={data.roster}
          consentRequired={reg.consent_required}
          editable={open}
          showEmails={reg.teacher_enters_emails}
          actions={rosterActions}
          busy={busy}
        />
      </div>

      {open && (
        <div className="card mb">
          <h2>Kinder eintragen</h2>
          <p className="muted" style={{ fontSize: '0.88rem', marginTop: 0 }}>
            Ein Kind pro Zeile, mit Vor- und Nachname. Der Fotograf benennt die Fotos nach diesen
            Namen; bitte so schreiben, wie das Kind heisst.
          </p>
          <textarea
            rows={6}
            value={names}
            onChange={(e) => setNames(e.target.value)}
            placeholder={'Lena Müller\nTim Weber\nSara Rossi'}
            style={{ width: '100%' }}
          />
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" type="button" onClick={addNames} disabled={busy || !names.trim()}>
              Kinder eintragen
            </button>
          </div>
        </div>
      )}

      {open && reg.teacher_enters_emails && (
        <InviteForm
          endpoint={`${base}/invite`}
          consentRequired={reg.consent_required}
          onDone={async (text) => {
            setMsg(text);
            await load();
          }}
        />
      )}

      {data.parentLink && (
        <ClassLinkBox
          link={data.parentLink}
          className={data.event.name}
          school={reg.school}
          shootingDate={reg.shooting_date_text}
          deadline={reg.deadline_text}
          consentRequired={reg.consent_required}
          canRotate={open}
          onRotate={async () => {
            if (
              !confirm(
                'Einen neuen Klassenlink erzeugen? Der bisherige Link und QR-Code funktionieren danach nicht mehr.',
              )
            )
              return;
            await run(() => api(`${base}/link/rotate`, { method: 'POST' }).then(() => undefined), 'Link konnte nicht erneuert werden.');
          }}
        />
      )}

      {open && (
        <div className="card mb">
          <h2>Erfassung abschliessen</h2>
          <p className="muted" style={{ fontSize: '0.88rem', marginTop: 0 }}>
            Sind alle Kinder eingetragen, melden Sie die Klasse dem Fotografen als vollständig. Sie
            können danach trotzdem noch Einträge ergänzen.
          </p>
          {reg.teacher_completed_at ? (
            <p className="soft" style={{ margin: 0 }}>
              Als vollständig gemeldet am {formatDate(reg.teacher_completed_at)}.
            </p>
          ) : (
            <button className="btn" type="button" onClick={complete} disabled={busy}>
              Als vollständig melden
            </button>
          )}
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <TrustNote>
          Diese Seite ist nur mit Ihrer bestätigten E-Mail-Adresse erreichbar.{' '}
          {reg.teacher_enters_emails
            ? 'Bitte behandeln Sie die E-Mail-Adressen der Eltern vertraulich.'
            : 'E-Mail-Adressen der Eltern sind hier bewusst nicht sichtbar; Erinnerungen verschickt die App.'}
        </TrustNote>
      </div>
    </div>
  );
}
