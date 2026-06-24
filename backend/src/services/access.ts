import { getDb } from '../db';

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
}

/**
 * Core access rule. A photo is visible to a verified e-mail only when ALL of:
 *  - the event is published and not expired
 *  - the photo is published and not disabled
 *  - the photo is linked to the e-mail (via the child OR directly)
 *
 * No open galleries: a family only ever sees photos explicitly linked to it.
 */
const VISIBLE_PHOTOS_SQL = `
  SELECT DISTINCT p.id, p.event_id, e.name AS event_name, p.is_class_photo,
         p.storage_key, p.ext, p.width, p.height, p.created_at, p.sort_order
  FROM photos p
  JOIN events e ON e.id = p.event_id
  WHERE e.status = 'published'
    AND (e.expires_at IS NULL OR e.expires_at > datetime('now'))
    AND p.published = 1
    AND p.status != 'disabled'
    AND (
      (p.child_id IS NOT NULL AND p.child_id IN (
        SELECT child_id FROM email_children WHERE email_id = @emailId
      ))
      OR p.id IN (
        SELECT photo_id FROM photo_emails WHERE email_id = @emailId
      )
    )
  ORDER BY e.created_at DESC, p.sort_order ASC, p.created_at ASC
`;

export function getVisiblePhotos(emailId: string): VisiblePhoto[] {
  const db = getDb();
  return db.prepare(VISIBLE_PHOTOS_SQL).all({ emailId }) as VisiblePhoto[];
}

export function canEmailSeePhoto(emailId: string, photoId: string): boolean {
  const db = getDb();
  const row = db
    .prepare(`${VISIBLE_PHOTOS_SQL.replace('ORDER BY', 'AND p.id = @photoId ORDER BY')}`)
    .get({ emailId, photoId });
  return !!row;
}

/** Whether the e-mail has at least one visible (published, linked) photo. */
export function emailHasVisiblePhotos(emailId: string): boolean {
  const db = getDb();
  const row = db
    .prepare(`SELECT 1 FROM (${VISIBLE_PHOTOS_SQL}) LIMIT 1`)
    .get({ emailId });
  return !!row;
}

/** Whether the e-mail has any assignment at all (even if not yet published). */
export function emailHasAnyAssignment(emailId: string): boolean {
  const db = getDb();
  const child = db
    .prepare('SELECT 1 FROM email_children WHERE email_id = ? LIMIT 1')
    .get(emailId);
  if (child) return true;
  const direct = db
    .prepare('SELECT 1 FROM photo_emails WHERE email_id = ? LIMIT 1')
    .get(emailId);
  return !!direct;
}
