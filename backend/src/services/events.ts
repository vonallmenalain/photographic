import { COL, col, runQuery, updateById, nowIso } from '../db';
import { config } from '../config';

/**
 * The simplified event lifecycle. Only three states are exposed to the admin:
 *  - draft      ("Entwurf")       : default, not visible to parents
 *  - published  ("Veröffentlicht"): visible to assigned parents while not expired
 *  - archived   ("Archiviert")    : set automatically once the retention window
 *                                   (expires_at) has passed; no longer visible
 */
export const EVENT_STATUSES = ['draft', 'published', 'archived'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/** Map statuses from earlier versions onto the simplified set. */
const LEGACY_STATUS_MAP: Record<string, EventStatus> = {
  in_progress: 'draft',
  ready: 'draft',
  disabled: 'archived',
};

interface EventStatusDoc {
  status: string;
  expires_at: string | null;
}

/** A fresh retention deadline from now, based on the configured default. */
export function retentionExpiry(): string {
  return new Date(Date.now() + config.retentionDaysDefault * 86_400_000).toISOString();
}

/**
 * Normalises any legacy statuses and automatically archives events whose
 * retention window (expires_at) has passed. Idempotent and cheap to call on
 * every events listing as well as on a periodic timer.
 */
export async function archiveExpiredEvents(): Promise<number> {
  const events = await runQuery<EventStatusDoc>(col(COL.events));
  const now = Date.now();
  let changed = 0;
  await Promise.all(
    events.map(async (ev) => {
      let next: string = LEGACY_STATUS_MAP[ev.status] ?? ev.status;
      const expired = ev.expires_at ? new Date(ev.expires_at).getTime() <= now : false;
      if (next !== 'archived' && expired) next = 'archived';
      if (next !== ev.status) {
        await updateById(COL.events, ev.id, { status: next, updated_at: nowIso() });
        changed += 1;
      }
    }),
  );
  return changed;
}
