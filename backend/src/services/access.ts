import { COL, col, getById, runQuery } from '../db';

export interface VisiblePhoto {
  id: string;
  event_id: string;
  event_name: string;
  is_class_photo: number;
  storage_key: string;
  ext: string;
  width: number | null;
  height: number | null;
  created_at: string;
  sort_order: number;
}

interface PhotoDoc {
  event_id: string;
  child_id: string | null;
  is_class_photo: number;
  storage_key: string;
  ext: string;
  width: number | null;
  height: number | null;
  status: string;
  published: number;
  sort_order: number;
  created_at: string;
}

interface EventDoc {
  name: string;
  status: string;
  expires_at: string | null;
  created_at: string;
}

/** Firestore "in" queries accept at most 30 values; chunk to stay safe. */
function chunk<T>(arr: T[], size = 30): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function linkedChildIds(emailId: string): Promise<string[]> {
  const rows = await runQuery<{ child_id: string }>(
    col(COL.emailChildren).where('email_id', '==', emailId),
  );
  return rows.map((r) => r.child_id);
}

async function directPhotoIds(emailId: string): Promise<string[]> {
  const rows = await runQuery<{ photo_id: string }>(
    col(COL.photoEmails).where('email_id', '==', emailId),
  );
  return rows.map((r) => r.photo_id);
}

function eventIsLive(ev: EventDoc | null): boolean {
  if (!ev) return false;
  if (ev.status !== 'published') return false;
  if (ev.expires_at && new Date(ev.expires_at).getTime() <= Date.now()) return false;
  return true;
}

function photoIsLive(p: PhotoDoc): boolean {
  return p.published === 1 && p.status !== 'disabled';
}

/**
 * Core access rule. A photo is visible to a verified e-mail only when ALL of:
 *  - the event is published and not expired
 *  - the photo is published and not disabled
 *  - the photo is linked to the e-mail (via the child OR directly)
 *
 * No open galleries: a family only ever sees photos explicitly linked to it.
 */
export async function getVisiblePhotos(emailId: string): Promise<VisiblePhoto[]> {
  const [childIds, photoIds] = await Promise.all([
    linkedChildIds(emailId),
    directPhotoIds(emailId),
  ]);

  const photos = new Map<string, PhotoDoc & { id: string }>();

  // Photos linked via a child.
  for (const part of chunk(childIds)) {
    if (part.length === 0) continue;
    const rows = await runQuery<PhotoDoc>(
      col(COL.photos).where('child_id', 'in', part),
    );
    for (const r of rows) photos.set(r.id, r);
  }

  // Photos linked directly (class photos / manual overrides).
  const directDocs = await Promise.all(
    [...new Set(photoIds)].map((id) => getById<PhotoDoc>(COL.photos, id)),
  );
  for (const d of directDocs) {
    if (d) photos.set(d.id, d);
  }

  const livePhotos = [...photos.values()].filter(photoIsLive);
  if (livePhotos.length === 0) return [];

  // Resolve the (cached) events for the surviving photos.
  const eventIds = [...new Set(livePhotos.map((p) => p.event_id))];
  const events = new Map<string, EventDoc | null>();
  await Promise.all(
    eventIds.map(async (id) => {
      events.set(id, await getById<EventDoc>(COL.events, id));
    }),
  );

  const visible: VisiblePhoto[] = [];
  for (const p of livePhotos) {
    const ev = events.get(p.event_id) ?? null;
    if (!eventIsLive(ev)) continue;
    visible.push({
      id: p.id,
      event_id: p.event_id,
      event_name: (ev as EventDoc).name,
      is_class_photo: p.is_class_photo,
      storage_key: p.storage_key,
      ext: p.ext,
      width: p.width ?? null,
      height: p.height ?? null,
      created_at: p.created_at,
      sort_order: p.sort_order ?? 0,
    });
  }

  // ORDER BY e.created_at DESC, p.sort_order ASC, p.created_at ASC
  visible.sort((a, b) => {
    const ea = events.get(a.event_id)?.created_at ?? '';
    const eb = events.get(b.event_id)?.created_at ?? '';
    if (ea !== eb) return eb.localeCompare(ea);
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.created_at.localeCompare(b.created_at);
  });

  return visible;
}

export async function canEmailSeePhoto(emailId: string, photoId: string): Promise<boolean> {
  const visible = await getVisiblePhotos(emailId);
  return visible.some((p) => p.id === photoId);
}

/** Whether the e-mail has at least one visible (published, linked) photo. */
export async function emailHasVisiblePhotos(emailId: string): Promise<boolean> {
  const visible = await getVisiblePhotos(emailId);
  return visible.length > 0;
}

/** Whether the e-mail has any assignment at all (even if not yet published). */
export async function emailHasAnyAssignment(emailId: string): Promise<boolean> {
  const childIds = await linkedChildIds(emailId);
  if (childIds.length > 0) return true;
  const photoIds = await directPhotoIds(emailId);
  return photoIds.length > 0;
}
