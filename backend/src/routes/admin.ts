import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import {
  COL,
  col,
  getById,
  firstOf,
  runQuery,
  setById,
  updateById,
  deleteById,
  deleteWhere,
  countQuery,
  getManyById,
  linkId,
  nowIso,
} from '../db';
import { config } from '../config';
import { asyncHandler, ApiError } from '../middleware/errorHandler';
import { requireAdmin, ADMIN_COOKIE } from '../middleware/adminAuth';
import { adminLoginLimiter, passwordResetLimiter } from '../middleware/rateLimit';
import { signAdminToken, hashToken } from '../lib/auth';
import { setAuthCookie, clearAuthCookie } from '../lib/cookies';
import { newId } from '../lib/ids';
import { emailSchema, parse, normalizeEmail } from '../lib/validation';
import crypto from 'crypto';
import {
  processOriginal,
  reprocessFromOriginal,
  deleteAllVariants,
  deleteEventStorage,
  variantPath,
} from '../lib/images';
import { sendPasswordResetEmail, sendGalleryReadyEmail } from '../lib/email';
import { requestVerification } from '../services/verification';
import { EVENT_STATUSES, archiveExpiredEvents, retentionExpiry } from '../services/events';
import { matchChildByFilename, isGroupPhotoFilename } from '../lib/names';
import {
  detectMapping,
  describeColumns,
  buildPlan,
  commitImport,
  type Mapping,
} from '../services/import';

const router = Router();

const PHOTO_STATUSES = ['uploaded', 'processed', 'assigned', 'disabled'] as const;
// Simplified order life cycle. `cart`/`checkout_started` remain internal states
// of the shopping flow and are never shown as real orders. Admins only ever set
// one of the three customer-facing statuses below.
const ADMIN_ORDER_STATUSES = ['pending', 'completed', 'cancelled'] as const;

async function audit(action: string, detail: string, actor = 'admin') {
  await setById(COL.auditLog, newId('aud'), {
    actor,
    action,
    detail,
    created_at: nowIso(),
  });
}

/**
 * Resolves the e-mail address of the currently logged-in admin account so the
 * "E-Mail an mich senden" option can deliver a copy to the admin. Falls back to
 * the configured default admin e-mail when the account has none on file.
 */
async function resolveAdminEmail(username: string): Promise<string> {
  const user = await getById<{ email?: string }>(COL.adminUsers, username);
  return (user?.email || config.admin.email || '').trim();
}

// ---------------------------------------------------------------------------
// Cascade helpers (Firestore has no foreign keys, so we mirror the previous
// ON DELETE CASCADE behaviour explicitly).
// ---------------------------------------------------------------------------
async function deletePhotoCascade(photoId: string): Promise<void> {
  const photo = await getById<{ storage_key: string; ext: string }>(COL.photos, photoId);
  await deleteWhere(col(COL.photoEmails).where('photo_id', '==', photoId));
  await deleteById(COL.photos, photoId);
  if (photo) await deleteAllVariants(photo.storage_key, photo.ext);
}

async function deleteChildCascade(childId: string): Promise<void> {
  await deleteWhere(col(COL.emailChildren).where('child_id', '==', childId));
  // Photos referencing this child lose the link (mirror ON DELETE SET NULL).
  const photos = await runQuery<{ child_id: string }>(
    col(COL.photos).where('child_id', '==', childId),
  );
  await Promise.all(photos.map((p) => updateById(COL.photos, p.id, { child_id: null })));
  await deleteById(COL.children, childId);
}

// --- Auth ----------------------------------------------------------------
type AdminUser = { username: string; password_hash: string; email?: string };

/**
 * Resolves an admin account from the value typed into the "Benutzername /
 * E-Mail" field. Admin documents are keyed by username, but the e-mail address
 * may be used interchangeably as a login identifier. We therefore look the
 * value up as a document id first and fall back to an e-mail match.
 */
async function findAdminUser(identifier: string): Promise<(AdminUser & { id: string }) | null> {
  const trimmed = identifier.trim();
  if (!trimmed) return null;
  // 1) Exakter Treffer über die Dokument-ID (Benutzername).
  const byUsername = await getById<AdminUser>(COL.adminUsers, trimmed);
  if (byUsername) return byUsername;
  // 2) Treffer über die hinterlegte E-Mail-Adresse.
  const byEmail = await firstOf<AdminUser>(
    col(COL.adminUsers).where('email', '==', normalizeEmail(trimmed)),
  );
  if (byEmail) return byEmail;
  // 3) Fallback: Benutzername unabhängig von Groß-/Kleinschreibung. Die
  // Admin-Sammlung ist sehr klein, deshalb ist ein vollständiger Scan günstig.
  const lower = trimmed.toLowerCase();
  const all = await runQuery<AdminUser>(col(COL.adminUsers));
  return (
    all.find((u) => (u.username ?? u.id).toLowerCase() === lower) ??
    all.find((u) => u.id.toLowerCase() === lower) ??
    null
  );
}

router.post(
  '/login',
  adminLoginLimiter,
  asyncHandler(async (req, res) => {
    const { username, password } = parse(
      z.object({ username: z.string().min(1), password: z.string().min(1) }),
      req.body,
    );
    const user = await findAdminUser(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      throw new ApiError(401, 'Benutzername oder Passwort ist falsch.');
    }
    const token = signAdminToken({ sub: user.username, role: 'admin' });
    setAuthCookie(res, ADMIN_COOKIE, token, { maxAgeMs: 12 * 60 * 60 * 1000 });
    res.json({ token, username: user.username });
  }),
);

router.post('/logout', (_req, res) => {
  clearAuthCookie(res, ADMIN_COOKIE);
  res.json({ ok: true });
});

router.get('/me', requireAdmin, (req, res) => {
  res.json({ username: req.admin!.username });
});

// --- Konto-Einstellungen (Benutzername / E-Mail ändern) -------------------
const adminUsernameSchema = z
  .string()
  .trim()
  .min(1, 'Bitte gib einen Benutzernamen ein.')
  .max(60, 'Der Benutzername darf höchstens 60 Zeichen lang sein.')
  .regex(
    /^[\p{L}\p{N} ._-]+$/u,
    'Erlaubt sind Buchstaben, Zahlen, Leerzeichen sowie die Zeichen . _ -',
  );

const adminPasswordSchema = z
  .string()
  .min(8, 'Das Passwort muss mindestens 8 Zeichen lang sein.')
  .max(200, 'Das Passwort darf höchstens 200 Zeichen lang sein.');

router.get(
  '/account',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const current = await getById<AdminUser>(COL.adminUsers, req.admin!.username);
    res.json({ username: req.admin!.username, email: current?.email ?? '' });
  }),
);

router.put(
  '/account',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { username: usernameInput, email: emailInput } = parse(
      z.object({
        username: adminUsernameSchema,
        email: z.union([emailSchema, z.literal('')]).optional(),
      }),
      req.body,
    );

    const oldUsername = req.admin!.username;
    const current = await getById<AdminUser & { created_at?: string }>(
      COL.adminUsers,
      oldUsername,
    );
    if (!current) throw new ApiError(404, 'Admin-Konto nicht gefunden.');

    const newUsername = usernameInput.trim();
    // Leeres E-Mail-Feld bedeutet "unverändert lassen".
    const newEmail = emailInput ? normalizeEmail(emailInput) : current.email ?? '';

    // E-Mail darf nicht bereits einem ANDEREN Admin-Konto gehören.
    if (newEmail) {
      const clash = await firstOf<AdminUser>(
        col(COL.adminUsers).where('email', '==', newEmail),
      );
      if (clash && clash.id !== oldUsername) {
        throw new ApiError(
          409,
          'Diese E-Mail-Adresse wird bereits von einem anderen Konto verwendet.',
        );
      }
    }

    const renaming = newUsername !== oldUsername;
    if (renaming) {
      const taken = await getById<AdminUser>(COL.adminUsers, newUsername);
      if (taken) throw new ApiError(409, 'Dieser Benutzername ist bereits vergeben.');

      // Firestore-Dokumente sind über ihre ID (= Benutzername) verschlüsselt,
      // daher wird das Konto unter der neuen ID neu angelegt und das alte
      // Dokument entfernt.
      await setById(COL.adminUsers, newUsername, {
        username: newUsername,
        password_hash: current.password_hash,
        ...(newEmail ? { email: newEmail } : {}),
        created_at: current.created_at ?? nowIso(),
        updated_at: nowIso(),
      });
      await deleteById(COL.adminUsers, oldUsername);

      // Offene Passwort-Reset-Token auf den neuen Benutzernamen umhängen.
      const resets = await runQuery<{ username: string }>(
        col(COL.adminPasswordResets).where('username', '==', oldUsername),
      );
      await Promise.all(
        resets.map((r) =>
          updateById(COL.adminPasswordResets, r.id, { username: newUsername }),
        ),
      );
    } else {
      await updateById(COL.adminUsers, oldUsername, {
        ...(newEmail ? { email: newEmail } : {}),
        updated_at: nowIso(),
      });
    }

    // Neues Token ausstellen (sub = neuer Benutzername) und Cookie erneuern,
    // damit die Sitzung nach der Umbenennung gültig bleibt.
    const token = signAdminToken({ sub: newUsername, role: 'admin' });
    setAuthCookie(res, ADMIN_COOKIE, token, { maxAgeMs: 12 * 60 * 60 * 1000 });
    await audit(
      'admin.account.update',
      `${oldUsername} -> ${newUsername}${newEmail ? ` (${newEmail})` : ''}`,
    );
    res.json({ token, username: newUsername, email: newEmail });
  }),
);

// --- Eigenes Passwort ändern (angemeldet) ---------------------------------
// Bequemer, SMTP-unabhängiger Weg, das eigene Passwort zu ändern, ohne den
// "Passwort vergessen"-Mailflow zu durchlaufen. Das neue Passwort wird in
// Firestore gespeichert und überlebt dank des korrigierten Seedings (siehe
// db/migrate.ts) jeden Neustart/Deploy.
router.post(
  '/change-password',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = parse(
      z.object({
        currentPassword: z.string().min(1, 'Bitte gib dein aktuelles Passwort ein.'),
        newPassword: adminPasswordSchema,
      }),
      req.body,
    );
    const username = req.admin!.username;
    const current = await getById<AdminUser>(COL.adminUsers, username);
    if (!current || !bcrypt.compareSync(currentPassword, current.password_hash)) {
      throw new ApiError(400, 'Das aktuelle Passwort ist nicht korrekt.');
    }
    await updateById(COL.adminUsers, username, {
      password_hash: bcrypt.hashSync(newPassword, 10),
      updated_at: nowIso(),
    });
    await audit('admin.password.change', username);
    res.json({ ok: true });
  }),
);

// --- Weitere Administratoren verwalten (angemeldet) -----------------------
// Jeder angemeldete Admin kann weitere Admin-Konten anlegen, auflisten und
// (außer dem eigenen / dem letzten) wieder entfernen. So lassen sich künftige
// Admins komfortabel im Adminbereich pflegen, statt das CLI/Env zu bemühen.
router.get(
  '/admins',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const admins = (await runQuery<AdminUser & { created_at?: string }>(col(COL.adminUsers)))
      .map((a) => ({
        username: a.username ?? a.id,
        email: a.email ?? '',
        created_at: a.created_at ?? '',
        is_self: (a.username ?? a.id) === req.admin!.username,
      }))
      .sort((a, b) => a.username.localeCompare(b.username));
    res.json({ admins });
  }),
);

router.post(
  '/admins',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { username, email, password } = parse(
      z.object({
        username: adminUsernameSchema,
        email: z.union([emailSchema, z.literal('')]).optional(),
        password: adminPasswordSchema,
      }),
      req.body,
    );
    const cleanUsername = username.trim();

    const existing = await getById<AdminUser>(COL.adminUsers, cleanUsername);
    if (existing) throw new ApiError(409, 'Dieser Benutzername ist bereits vergeben.');

    const normalizedEmail = email ? normalizeEmail(email) : '';
    if (normalizedEmail) {
      const clash = await firstOf<AdminUser>(
        col(COL.adminUsers).where('email', '==', normalizedEmail),
      );
      if (clash) {
        throw new ApiError(
          409,
          'Diese E-Mail-Adresse wird bereits von einem anderen Konto verwendet.',
        );
      }
    }

    await setById(COL.adminUsers, cleanUsername, {
      username: cleanUsername,
      password_hash: bcrypt.hashSync(password, 10),
      ...(normalizedEmail ? { email: normalizedEmail } : {}),
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    await audit('admin.create', `${cleanUsername}${normalizedEmail ? ` (${normalizedEmail})` : ''}`);
    res.json({ username: cleanUsername, email: normalizedEmail });
  }),
);

router.delete(
  '/admins/:username',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const target = req.params.username;
    if (target === req.admin!.username) {
      throw new ApiError(400, 'Du kannst dein eigenes Konto nicht löschen.');
    }
    const existing = await getById<AdminUser>(COL.adminUsers, target);
    if (!existing) throw new ApiError(404, 'Admin-Konto nicht gefunden.');

    // Das letzte verbleibende Admin-Konto darf nie gelöscht werden – sonst gäbe
    // es keinen Weg mehr in den Adminbereich.
    const count = await countQuery(col(COL.adminUsers));
    if (count <= 1) {
      throw new ApiError(400, 'Das letzte Admin-Konto kann nicht gelöscht werden.');
    }

    // Offene Passwort-Reset-Token des gelöschten Kontos aufräumen.
    await deleteWhere(col(COL.adminPasswordResets).where('username', '==', target));
    await deleteById(COL.adminUsers, target);
    await audit('admin.delete', target);
    res.json({ ok: true });
  }),
);

// --- Passwort vergessen / zurücksetzen (öffentlich, rate-limited) ----------
router.post(
  '/forgot-password',
  passwordResetLimiter,
  asyncHandler(async (req, res) => {
    const { username } = parse(
      z.object({ username: z.string().min(1) }),
      req.body,
    );

    const user = await findAdminUser(username);

    // Neutral response: never reveal whether a given username/e-mail exists. We
    // only create a reset token and send the e-mail when the account (and an
    // e-mail address for it) actually exists, but always return 200 either way.
    if (user && user.email) {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashToken(token);
      const ttlMs = config.admin.passwordResetTtlMinutes * 60 * 1000;
      const expiresAt = new Date(Date.now() + ttlMs).toISOString();

      await setById(COL.adminPasswordResets, tokenHash, {
        username: user.username,
        token_hash: tokenHash,
        expires_at: expiresAt,
        created_at: nowIso(),
      });

      const link = `${config.publicAppUrl}/admin/passwort-zuruecksetzen?token=${token}`;
      // Sending must not turn the neutral 200 into a 500 for existing accounts.
      try {
        await sendPasswordResetEmail(user.email, user.username, link, config.admin.passwordResetTtlMinutes);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[admin] Failed to send password reset e-mail. Check SMTP_* settings.', err);
      }
    }

    res.json({ ok: true });
  }),
);

router.post(
  '/reset-password',
  passwordResetLimiter,
  asyncHandler(async (req, res) => {
    const { token, password } = parse(
      z.object({ token: z.string().min(1), password: z.string().min(8, 'Das Passwort muss mindestens 8 Zeichen lang sein.') }),
      req.body,
    );

    const tokenHash = hashToken(token);
    const resetDoc = await getById<{ username: string; expires_at: string }>(
      COL.adminPasswordResets,
      tokenHash,
    );

    if (!resetDoc || new Date(resetDoc.expires_at) < new Date()) {
      throw new ApiError(400, 'Der Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an.');
    }

    const hash = bcrypt.hashSync(password, 10);
    await updateById(COL.adminUsers, resetDoc.username, {
      password_hash: hash,
      updated_at: nowIso(),
    });

    // Token ungültig machen
    await deleteById(COL.adminPasswordResets, tokenHash);

    res.json({ ok: true });
  }),
);

// All routes below require admin.
router.use(requireAdmin);

// --- Dashboard -----------------------------------------------------------
router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const [
      events,
      publishedEvents,
      photos,
      emails,
      verifiedEmails,
      orders,
      openReports,
    ] = await Promise.all([
      countQuery(col(COL.events)),
      countQuery(col(COL.events).where('status', '==', 'published')),
      countQuery(col(COL.photos)),
      countQuery(col(COL.parentEmails)),
      countQuery(col(COL.parentEmails).where('status', '==', 'verified')),
      countQuery(col(COL.orders).where('status', '!=', 'cart')),
      countQuery(col(COL.reports).where('status', '==', 'open')),
    ]);
    res.json({ events, publishedEvents, photos, emails, verifiedEmails, orders, openReports });
  }),
);

// Per-event revenue + order counts for the Aufträge overview. Only confirmed,
// revenue-bearing orders (pending/completed) count. We deliberately avoid
// streaming the entire photos collection (which is what makes the admin area
// slow): instead we fetch only the event ids of the photos that actually appear
// in an order, via a single batched getAll().
async function eventRevenueTotals(): Promise<{
  revenue: Map<string, number>;
  orderCount: Map<string, number>;
}> {
  const [orders, orderItems] = await Promise.all([
    runQuery<{ id: string; status: string }>(col(COL.orders)),
    runQuery<{ order_id: string; photo_id: string; qty: number; unit_price_cents: number }>(
      col(COL.orderItems),
    ),
  ]);
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const countsForRevenue = (status: string) => status === 'pending' || status === 'completed';

  const relevantItems = orderItems.filter((item) => {
    const order = orderById.get(item.order_id);
    return !!order && countsForRevenue(order.status);
  });
  const photoEvent = await getManyById<{ event_id: string }>(
    COL.photos,
    relevantItems.map((i) => i.photo_id),
  );

  const revenue = new Map<string, number>();
  const orderSets = new Map<string, Set<string>>();
  for (const item of relevantItems) {
    const eventId = photoEvent.get(item.photo_id)?.event_id;
    if (!eventId) continue;
    revenue.set(eventId, (revenue.get(eventId) ?? 0) + (item.unit_price_cents ?? 0) * (item.qty ?? 0));
    let set = orderSets.get(eventId);
    if (!set) {
      set = new Set<string>();
      orderSets.set(eventId, set);
    }
    set.add(item.order_id);
  }
  const orderCount = new Map<string, number>();
  for (const [eventId, set] of orderSets) orderCount.set(eventId, set.size);
  return { revenue, orderCount };
}

// --- Events --------------------------------------------------------------
router.get(
  '/events',
  asyncHandler(async (_req, res) => {
    // Keep statuses current (auto-archive expired galleries) before listing.
    await archiveExpiredEvents();
    const [events, children, emailLinks, totals, reminders, parentEmails] = await Promise.all([
      runQuery<Record<string, unknown>>(col(COL.events)),
      runQuery<{ id: string; event_id: string }>(col(COL.children)),
      runQuery<{ email_id: string; child_id: string }>(col(COL.emailChildren)),
      eventRevenueTotals(),
      runQuery<{ event_id: string }>(col(COL.reminders)),
      runQuery<{ id: string; status: string }>(col(COL.parentEmails)),
    ]);
    const verifiedEmailIds = new Set(
      parentEmails.filter((e) => e.status === 'verified').map((e) => e.id),
    );
    // Photo counts via server-side aggregation per event instead of streaming
    // the ENTIRE photos collection into memory. The photos collection grows
    // without bound (one doc per uploaded photo); reading all of it on every
    // events-list render is what makes the admin area crawl after a big import.
    const photoCountEntries = await Promise.all(
      events.map(
        async (e) =>
          [e.id, await countQuery(col(COL.photos).where('event_id', '==', e.id))] as const,
      ),
    );
    const photoCounts = new Map<string, number>(photoCountEntries);
    const childCounts = new Map<string, number>();
    for (const c of children) childCounts.set(c.event_id, (childCounts.get(c.event_id) ?? 0) + 1);

    // Versendete Einladungen + Erinnerungen je Auftrag (jeder Eintrag in der
    // reminders-Sammlung steht für einen Versand bzw. einen protokollierten
    // Kontakt). Für die kompakte Auftragsliste summiert dargestellt.
    const reminderCounts = new Map<string, number>();
    for (const r of reminders)
      reminderCounts.set(r.event_id, (reminderCounts.get(r.event_id) ?? 0) + 1);

    // Distinct e-mail addresses per event: resolve every child→event link and
    // collect the unique e-mail ids that point at any child of that event.
    const childEvent = new Map<string, string>();
    for (const c of children) childEvent.set(c.id, c.event_id);
    const emailsByEvent = new Map<string, Set<string>>();
    for (const link of emailLinks) {
      const eventId = childEvent.get(link.child_id);
      if (!eventId) continue;
      let set = emailsByEvent.get(eventId);
      if (!set) {
        set = new Set<string>();
        emailsByEvent.set(eventId, set);
      }
      set.add(link.email_id);
    }

    const result = events
      .map((e) => {
        const emailSet = emailsByEvent.get(e.id);
        let verifiedCount = 0;
        if (emailSet) for (const id of emailSet) if (verifiedEmailIds.has(id)) verifiedCount += 1;
        return {
          ...e,
          photo_count: photoCounts.get(e.id) ?? 0,
          child_count: childCounts.get(e.id) ?? 0,
          email_count: emailSet?.size ?? 0,
          email_verified: verifiedCount,
          order_count: totals.orderCount.get(e.id) ?? 0,
          revenue_cents: totals.revenue.get(e.id) ?? 0,
          reminder_count: reminderCounts.get(e.id) ?? 0,
        };
      })
      .sort((a, b) =>
        String((b as Record<string, unknown>).created_at ?? '').localeCompare(
          String((a as Record<string, unknown>).created_at ?? ''),
        ),
      );
    res.json({ events: result, currency: config.stripe.currency });
  }),
);

router.post(
  '/events',
  asyncHandler(async (req, res) => {
    const { name, description } = parse(
      z.object({ name: z.string().trim().min(1).max(200), description: z.string().max(2000).default('') }),
      req.body,
    );
    const id = newId('evt');
    await setById(COL.events, id, {
      name,
      description,
      status: 'draft',
      expires_at: retentionExpiry(),
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    await audit('event.create', id);
    res.json({ id });
  }),
);

router.get(
  '/events/:id',
  asyncHandler(async (req, res) => {
    await archiveExpiredEvents();
    const event = await getById<Record<string, unknown>>(COL.events, req.params.id);
    if (!event) throw new ApiError(404, 'Event nicht gefunden.');
    const children = (await runQuery<{ name: string }>(col(COL.children).where('event_id', '==', req.params.id)))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const photos = (
      await runQuery<{
        child_id: string | null;
        is_class_photo: number;
        visible_to_event?: number;
        original_filename: string;
        status: string;
        sort_order: number;
        width: number | null;
        height: number | null;
        created_at: string;
      }>(col(COL.photos).where('event_id', '==', req.params.id))
    )
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.created_at).localeCompare(String(b.created_at)))
      .map((p) => ({
        id: p.id,
        child_id: p.child_id ?? null,
        is_class_photo: p.is_class_photo,
        visible_to_event: Number(p.visible_to_event) === 1 ? 1 : 0,
        original_filename: p.original_filename,
        status: p.status,
        sort_order: p.sort_order,
        width: p.width ?? null,
        height: p.height ?? null,
      }));
    res.json({ event, children, photos });
  }),
);

router.patch(
  '/events/:id',
  asyncHandler(async (req, res) => {
    const data = parse(
      z.object({
        name: z.string().trim().min(1).max(200).optional(),
        description: z.string().max(2000).optional(),
        status: z.enum(EVENT_STATUSES).optional(),
        expires_at: z.string().optional(),
        // Milestone of the "Aufträge erfassen" wizard: set once the photographer
        // has confirmed the photo↔child assignment of this order. Pass null to
        // reset. Surfaced again via GET /events/:id so the wizard step can show
        // green when revisited.
        photos_confirmed_at: z.string().nullable().optional(),
      }),
      req.body,
    );
    const event = await getById<{ expires_at: string | null }>(COL.events, req.params.id);
    if (!event) throw new ApiError(404, 'Event nicht gefunden.');
    const updates: Record<string, unknown> = { ...data };
    // Manuell gesetztes "Bestellbar bis": Datum normalisieren (akzeptiert sowohl
    // einen reinen Tag "2026-06-30" als auch einen vollständigen ISO-Zeitstempel)
    // und gegen Unsinn absichern.
    if (data.expires_at !== undefined) {
      const when = new Date(data.expires_at);
      if (isNaN(when.getTime())) throw new ApiError(400, 'Ungültiges Datum für „Bestellbar bis“.');
      updates.expires_at = when.toISOString();
    }
    // Eine bereits laufende Bestellfrist bleibt beim erneuten Veröffentlichen
    // unverändert – wird ein Auftrag also kurz bearbeitet und wieder
    // veröffentlicht, verschiebt sich der 30-Tage-Zeitraum NICHT. Nur wenn noch
    // kein (oder ein bereits abgelaufenes) Enddatum hinterlegt ist, wird ein
    // frisches Aufbewahrungsfenster gesetzt, damit die Auto-Archivierung den
    // Auftrag nicht sofort wieder archiviert.
    if (data.status === 'published' && data.expires_at === undefined) {
      const exp = event.expires_at ? new Date(event.expires_at).getTime() : 0;
      if (!exp || exp <= Date.now()) updates.expires_at = retentionExpiry();
    }
    if (Object.keys(updates).length) {
      await updateById(COL.events, req.params.id, { ...updates, updated_at: nowIso() });
      await audit('event.update', `${req.params.id}: ${JSON.stringify(updates)}`);
    }
    res.json({ ok: true });
  }),
);

router.delete(
  '/events/:id',
  asyncHandler(async (req, res) => {
    const photos = await runQuery<{ storage_key: string; ext: string }>(
      col(COL.photos).where('event_id', '==', req.params.id),
    );
    const children = await runQuery(col(COL.children).where('event_id', '==', req.params.id));
    await Promise.all(photos.map((p) => deletePhotoCascade(p.id)));
    await Promise.all(children.map((c) => deleteChildCascade(c.id)));
    await deleteWhere(col(COL.reminders).where('event_id', '==', req.params.id));
    // Remove the event's storage sub-folders entirely so no empty (or stray)
    // `<variant>/<eventId>` directories remain behind on the volume.
    await deleteEventStorage(req.params.id);
    await deleteById(COL.events, req.params.id);
    await audit('event.delete', req.params.id);
    res.json({ ok: true });
  }),
);

// Collects the distinct parent e-mail ids connected to an Auftrag (event):
// either through a child of that event or through a direct photo assignment.
// Mirrors the filter logic of GET /emails?eventId=…
async function eventEmailIds(eventId: string): Promise<Set<string>> {
  const [children, photos, childLinks, photoLinks] = await Promise.all([
    runQuery<{ id: string }>(col(COL.children).where('event_id', '==', eventId)),
    runQuery<{ id: string }>(col(COL.photos).where('event_id', '==', eventId)),
    runQuery<{ email_id: string; child_id: string }>(col(COL.emailChildren)),
    runQuery<{ email_id: string; photo_id: string }>(col(COL.photoEmails)),
  ]);
  const childIds = new Set(children.map((c) => c.id));
  const photoIds = new Set(photos.map((p) => p.id));
  const ids = new Set<string>();
  for (const l of childLinks) if (childIds.has(l.child_id)) ids.add(l.email_id);
  for (const l of photoLinks) if (photoIds.has(l.photo_id)) ids.add(l.email_id);
  return ids;
}

// --- "Galerie ist bereit" Sammel-E-Mail an alle Adressen eines Auftrags ----
// Schickt den (nicht deaktivierten) Eltern-Adressen des Auftrags eine E-Mail mit
// Link zur App, Kurzanleitung zur Verifizierung sowie den Schutz-/Aufbewahrungs-
// hinweisen ("Einladung per E-Mail"). Per GET wird die komplette Empfängerliste
// geliefert, damit das Frontend einzelne Adressen abwählen kann; standardmässig
// sind im Popup alle Adressen ausgewählt.
router.get(
  '/events/:id/notify',
  asyncHandler(async (req, res) => {
    const event = await getById(COL.events, req.params.id);
    if (!event) throw new ApiError(404, 'Auftrag nicht gefunden.');
    const ids = await eventEmailIds(req.params.id);
    const emails = await getManyById<{ email: string; name?: string; status: string }>(
      COL.parentEmails,
      Array.from(ids),
    );
    const recipients = Array.from(emails.values())
      .filter((e) => e.status !== 'disabled' && e.email)
      .map((e) => ({ id: e.id, email: e.email, name: e.name ?? '', status: e.status }))
      .sort((a, b) => a.email.localeCompare(b.email));
    res.json({
      recipientCount: recipients.length,
      recipients,
      adminEmail: await resolveAdminEmail(req.admin!.username),
      devLogOnly: config.mail.devLogOnly,
    });
  }),
);

router.post(
  '/events/:id/notify',
  asyncHandler(async (req, res) => {
    const { emailIds, sendToSelf } = parse(
      z.object({
        emailIds: z.array(z.string()).optional(),
        sendToSelf: z.boolean().default(false),
      }),
      req.body ?? {},
    );

    const event = await getById<{ name: string; expires_at: string | null }>(
      COL.events,
      req.params.id,
    );
    if (!event) throw new ApiError(404, 'Auftrag nicht gefunden.');

    const ids = await eventEmailIds(req.params.id);
    const emails = await getManyById<{ email: string; status: string }>(
      COL.parentEmails,
      Array.from(ids),
    );
    let recipients = Array.from(emails.values()).filter(
      (e) => e.status !== 'disabled' && e.email,
    );
    // Restrict to the explicitly selected addresses (the admin may have unticked
    // some in the popup). Without a selection we fall back to "all".
    if (emailIds) {
      const allowed = new Set(emailIds);
      recipients = recipients.filter((e) => allowed.has(e.id));
    }

    const selfEmail = sendToSelf ? await resolveAdminEmail(req.admin!.username) : '';
    if (recipients.length === 0 && !selfEmail) {
      throw new ApiError(400, 'Es wurde keine (aktive) E-Mail-Adresse ausgewählt.');
    }

    const link = config.publicAppUrl;
    const results = await Promise.allSettled(
      recipients.map((r) =>
        sendGalleryReadyEmail(r.email, link, { retentionDays: config.retentionDaysDefault }),
      ),
    );
    const sent = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - sent;

    let sentToSelf = false;
    if (selfEmail) {
      try {
        await sendGalleryReadyEmail(selfEmail, link, {
          retentionDays: config.retentionDaysDefault,
        });
        sentToSelf = true;
      } catch {
        sentToSelf = false;
      }
    }

    // Record a reminder marker so the moment shows up in the Auswertung chart,
    // and stamp the order's "invited" milestone so the capture wizard can show
    // step 4 (Versand an die Eltern) as completed when revisited.
    if (sent > 0) {
      await setById(COL.reminders, newId('rem'), {
        event_id: req.params.id,
        sent_at: nowIso(),
        note: `Einladung per E-Mail an ${sent} Adresse(n)`,
        created_at: nowIso(),
      });
      await updateById(COL.events, req.params.id, { invited_at: nowIso(), updated_at: nowIso() });
    }

    await audit(
      'event.notify',
      `${req.params.id}: ${sent} sent, ${failed} failed${sentToSelf ? ', self copy' : ''}`,
    );
    res.json({
      sent,
      failed,
      total: recipients.length,
      sentToSelf,
      devLogOnly: config.mail.devLogOnly,
    });
  }),
);

// --- Children ------------------------------------------------------------
router.post(
  '/events/:id/children',
  asyncHandler(async (req, res) => {
    const { name, note } = parse(
      z.object({ name: z.string().trim().min(1).max(200), note: z.string().max(1000).default('') }),
      req.body,
    );
    const event = await getById(COL.events, req.params.id);
    if (!event) throw new ApiError(404, 'Event nicht gefunden.');
    const id = newId('chd');
    await setById(COL.children, id, {
      event_id: req.params.id,
      name,
      note,
      created_at: nowIso(),
    });
    res.json({ id });
  }),
);

router.patch(
  '/children/:id',
  asyncHandler(async (req, res) => {
    const data = parse(
      z.object({ name: z.string().trim().min(1).max(200).optional(), note: z.string().max(1000).optional() }),
      req.body,
    );
    if (Object.keys(data).length) {
      await updateById(COL.children, req.params.id, data);
    }
    res.json({ ok: true });
  }),
);

router.delete(
  '/children/:id',
  asyncHandler(async (req, res) => {
    await deleteChildCascade(req.params.id);
    res.json({ ok: true });
  }),
);

// --- Photo upload & management -------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
});

router.post(
  '/events/:id/photos',
  upload.array('photos', 50),
  asyncHandler(async (req, res) => {
    const event = await getById(COL.events, req.params.id);
    if (!event) throw new ApiError(404, 'Event nicht gefunden.');
    const files = (req.files as Express.Multer.File[]) ?? [];
    if (files.length === 0) throw new ApiError(400, 'Keine Dateien empfangen.');

    // Auto-assignment by file name is on by default; pass autoAssign=0 to skip.
    const autoAssign = String((req.query.autoAssign ?? req.body?.autoAssign) ?? '1') !== '0';
    const children = autoAssign
      ? await runQuery<{ name: string }>(col(COL.children).where('event_id', '==', req.params.id))
      : [];

    // Detect photos that re-use a file name already present in this Auftrag/
    // Klasse (case-insensitive). This usually means the same child was uploaded
    // twice, so we flag it back to the admin instead of silently overwriting.
    const existingPhotos = await runQuery<{ original_filename: string }>(
      col(COL.photos).where('event_id', '==', req.params.id),
    );
    const normalizeFilename = (name: string) => String(name ?? '').trim().toLowerCase();
    const existingFilenames = new Set(
      existingPhotos.map((p) => normalizeFilename(p.original_filename)),
    );
    const batchFilenames = new Set<string>();

    const results: {
      id: string;
      filename: string;
      ok: boolean;
      error?: string;
      matchedChildId?: string;
      matchedChildName?: string;
      duplicate?: boolean;
    }[] = [];
    for (const file of files) {
      const normalizedName = normalizeFilename(file.originalname);
      const isDuplicate =
        existingFilenames.has(normalizedName) || batchFilenames.has(normalizedName);
      batchFilenames.add(normalizedName);
      const id = newId('pho');
      const ext = (path.extname(file.originalname).replace('.', '').toLowerCase() || 'jpg').slice(0, 5);
      const storageKey = `${req.params.id}/${id}`;
      // File names like "Gruppenfoto", "Klassenfoto" or "Klassenspiegel" mark a
      // photo for the whole class: tick "Gruppen-/Klassenfoto" and make it
      // visible to everyone in the Auftrag. These never get assigned to a single
      // child, so we skip the per-child filename matching for them.
      const isGroupPhoto = isGroupPhotoFilename(file.originalname);
      // Try to recognise the child from the file name (tolerant matching).
      const match = autoAssign && !isGroupPhoto ? matchChildByFilename(file.originalname, children) : null;
      const childId = match && !match.ambiguous ? match.childId : null;
      await setById(COL.photos, id, {
        event_id: req.params.id,
        child_id: isGroupPhoto ? null : childId,
        is_class_photo: isGroupPhoto ? 1 : 0,
        visible_to_event: isGroupPhoto ? 1 : 0,
        original_filename: file.originalname.slice(0, 255),
        storage_key: storageKey,
        ext,
        width: null,
        height: null,
        bytes: null,
        status: childId ? 'assigned' : 'uploaded',
        processing_error: null,
        duplicate_filename: isDuplicate ? 1 : 0,
        published: 0,
        sort_order: 0,
        created_at: nowIso(),
        updated_at: nowIso(),
      });
      try {
        const meta = await processOriginal(file.buffer, storageKey, ext);
        await updateById(COL.photos, id, {
          status: childId ? 'assigned' : 'processed',
          width: meta.width,
          height: meta.height,
          bytes: meta.bytes,
          updated_at: nowIso(),
        });
        results.push({
          id,
          filename: file.originalname,
          ok: true,
          matchedChildId: childId ?? undefined,
          matchedChildName: childId ? match?.childName : undefined,
          duplicate: isDuplicate,
        });
      } catch (err) {
        await updateById(COL.photos, id, {
          processing_error: String(err).slice(0, 500),
          updated_at: nowIso(),
        });
        results.push({
          id,
          filename: file.originalname,
          ok: false,
          error: 'Verarbeitung fehlgeschlagen',
          duplicate: isDuplicate,
        });
      }
    }
    const matched = results.filter((r) => r.matchedChildId).length;
    const duplicates = results.filter((r) => r.duplicate).length;
    await audit(
      'photo.upload',
      `${req.params.id}: ${results.length} files, ${matched} auto-assigned, ${duplicates} duplicate filenames`,
    );
    res.json({ results });
  }),
);

// Re-run filename based auto-assignment for photos that are not yet linked to a
// child. Useful after children have been imported/created post-upload.
router.post(
  '/events/:id/photos/auto-assign',
  asyncHandler(async (req, res) => {
    const event = await getById(COL.events, req.params.id);
    if (!event) throw new ApiError(404, 'Event nicht gefunden.');
    const { overwrite } = parse(
      z.object({ overwrite: z.boolean().default(false) }),
      req.body ?? {},
    );
    const [children, photos] = await Promise.all([
      runQuery<{ name: string }>(col(COL.children).where('event_id', '==', req.params.id)),
      runQuery<{ child_id: string | null; is_class_photo: number; original_filename: string; status: string }>(
        col(COL.photos).where('event_id', '==', req.params.id),
      ),
    ]);

    let assigned = 0;
    let ambiguous = 0;
    let unmatched = 0;
    let groupPhotos = 0;
    const details: { id: string; filename: string; childName: string }[] = [];
    for (const p of photos) {
      if (p.is_class_photo) continue;
      // File names like "Gruppenfoto"/"Klassenfoto"/"Klassenspiegel" mark a photo
      // for the whole class instead of a single child.
      if (isGroupPhotoFilename(p.original_filename)) {
        await updateById(COL.photos, p.id, {
          is_class_photo: 1,
          visible_to_event: 1,
          child_id: null,
          updated_at: nowIso(),
        });
        groupPhotos += 1;
        continue;
      }
      if (p.child_id && !overwrite) continue;
      const match = matchChildByFilename(p.original_filename, children);
      if (!match) {
        unmatched += 1;
        continue;
      }
      if (match.ambiguous) {
        ambiguous += 1;
        continue;
      }
      if (p.child_id === match.childId) continue;
      await updateById(COL.photos, p.id, {
        child_id: match.childId,
        status: 'assigned',
        updated_at: nowIso(),
      });
      assigned += 1;
      details.push({ id: p.id, filename: p.original_filename, childName: match.childName });
    }
    await audit(
      'photo.autoassign',
      `${req.params.id}: ${assigned} assigned, ${groupPhotos} group photos`,
    );
    res.json({ assigned, ambiguous, unmatched, groupPhotos, details });
  }),
);

// Admin-only clean thumbnail (auth required via cookie/bearer).
router.get(
  '/photos/:id/thumb',
  asyncHandler(async (req, res) => {
    const photo = await getById<{ storage_key: string }>(COL.photos, req.params.id);
    if (!photo) throw new ApiError(404, 'Foto nicht gefunden.');
    const fs = await import('fs');
    const p = variantPath('admin', photo.storage_key);
    if (!fs.existsSync(p)) throw new ApiError(404, 'Vorschau nicht verfügbar.');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=60');
    fs.createReadStream(p).pipe(res);
  }),
);

// Admin-only clean full-resolution view (auth required via cookie/bearer).
// Serves the untouched original so admins can inspect a photo enlarged. Falls
// back to the (clean) admin variant when the original is unavailable.
const ORIGINAL_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  bmp: 'image/bmp',
};
router.get(
  '/photos/:id/original',
  asyncHandler(async (req, res) => {
    const photo = await getById<{ storage_key: string; ext: string }>(COL.photos, req.params.id);
    if (!photo) throw new ApiError(404, 'Foto nicht gefunden.');
    const fs = await import('fs');
    const originalPath = variantPath('original', photo.storage_key, photo.ext);
    if (fs.existsSync(originalPath)) {
      const ext = (photo.ext || 'jpg').toLowerCase();
      res.setHeader('Content-Type', ORIGINAL_MIME[ext] ?? 'application/octet-stream');
      res.setHeader('Cache-Control', 'private, max-age=60');
      fs.createReadStream(originalPath).pipe(res);
      return;
    }
    const adminPath = variantPath('admin', photo.storage_key);
    if (!fs.existsSync(adminPath)) throw new ApiError(404, 'Originaldatei nicht verfügbar.');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=60');
    fs.createReadStream(adminPath).pipe(res);
  }),
);

router.patch(
  '/photos/:id',
  asyncHandler(async (req, res) => {
    const data = parse(
      z.object({
        child_id: z.string().nullable().optional(),
        is_class_photo: z.boolean().optional(),
        visible_to_event: z.boolean().optional(),
        status: z.enum(PHOTO_STATUSES).optional(),
        sort_order: z.number().int().optional(),
      }),
      req.body,
    );
    const photo = await getById(COL.photos, req.params.id);
    if (!photo) throw new ApiError(404, 'Foto nicht gefunden.');
    const map: Record<string, unknown> = {};
    if (data.child_id !== undefined) map.child_id = data.child_id;
    if (data.is_class_photo !== undefined) map.is_class_photo = data.is_class_photo ? 1 : 0;
    if (data.visible_to_event !== undefined) map.visible_to_event = data.visible_to_event ? 1 : 0;
    if (data.status !== undefined) map.status = data.status;
    if (data.sort_order !== undefined) map.sort_order = data.sort_order;
    // Safety: a photo tied to a single child (or no longer a class photo) must
    // never stay class-wide visible.
    if (data.is_class_photo === false) map.visible_to_event = 0;
    if (data.child_id) map.visible_to_event = 0;
    if (Object.keys(map).length) {
      await updateById(COL.photos, req.params.id, { ...map, updated_at: nowIso() });
      await audit('photo.update', `${req.params.id}: ${JSON.stringify(data)}`);
    }
    res.json({ ok: true });
  }),
);

router.post(
  '/photos/:id/reprocess',
  asyncHandler(async (req, res) => {
    const photo = await getById<{ storage_key: string; ext: string }>(COL.photos, req.params.id);
    if (!photo) throw new ApiError(404, 'Foto nicht gefunden.');
    const meta = await reprocessFromOriginal(photo.storage_key, photo.ext);
    await updateById(COL.photos, req.params.id, {
      status: 'processed',
      processing_error: null,
      width: meta.width,
      height: meta.height,
      bytes: meta.bytes,
      updated_at: nowIso(),
    });
    res.json({ ok: true });
  }),
);

router.delete(
  '/photos/:id',
  asyncHandler(async (req, res) => {
    const photo = await getById(COL.photos, req.params.id);
    if (!photo) throw new ApiError(404, 'Foto nicht gefunden.');
    await deletePhotoCascade(req.params.id);
    await audit('photo.delete', req.params.id);
    res.json({ ok: true });
  }),
);

// Direct photo <-> e-mail assignment (class photos / overrides).
router.post(
  '/photos/:id/emails',
  asyncHandler(async (req, res) => {
    const { emailId } = parse(z.object({ emailId: z.string() }), req.body);
    await setById(COL.photoEmails, linkId(req.params.id, emailId), {
      photo_id: req.params.id,
      email_id: emailId,
      created_at: nowIso(),
    });
    res.json({ ok: true });
  }),
);

router.delete(
  '/photos/:id/emails/:emailId',
  asyncHandler(async (req, res) => {
    await deleteById(COL.photoEmails, linkId(req.params.id, req.params.emailId));
    res.json({ ok: true });
  }),
);

router.get(
  '/photos/:id/emails',
  asyncHandler(async (req, res) => {
    const links = await runQuery<{ email_id: string }>(
      col(COL.photoEmails).where('photo_id', '==', req.params.id),
    );
    const emails = await Promise.all(
      links.map(async (l) => {
        const e = await getById<{ email: string }>(COL.parentEmails, l.email_id);
        return { email_id: l.email_id, email: e?.email ?? '' };
      }),
    );
    res.json({ emails });
  }),
);

// --- E-mail / parent management ------------------------------------------
router.get(
  '/emails',
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? '').trim().toLowerCase();
    // Optional filter: only e-mails linked to this Auftrag (event), either via a
    // linked child of that event or via a direct photo assignment in that event.
    const eventId = String(req.query.eventId ?? '').trim();

    const [rows, childLinks, children, photoLinks, events] = await Promise.all([
      runQuery<{ email: string; name?: string; created_at: string }>(col(COL.parentEmails)),
      runQuery<{ email_id: string; child_id: string }>(col(COL.emailChildren)),
      runQuery<{ id: string; event_id: string; name: string }>(col(COL.children)),
      runQuery<{ email_id: string; photo_id: string }>(col(COL.photoEmails)),
      runQuery<{ id: string; name: string }>(col(COL.events)),
    ]);

    const childEvent = new Map<string, string>();
    const childName = new Map<string, string>();
    for (const c of children) {
      childEvent.set(c.id, c.event_id);
      childName.set(c.id, c.name);
    }
    // Only the photos that are directly assigned to an e-mail (photoLinks) matter
    // here, so fetch just those by id instead of scanning the whole (potentially
    // huge) photos collection.
    const photosById = await getManyById<{ event_id: string }>(
      COL.photos,
      photoLinks.map((l) => l.photo_id),
    );
    const photoEvent = new Map<string, string>();
    for (const [id, p] of photosById) photoEvent.set(id, p.event_id);
    const eventName = new Map<string, string>();
    for (const e of events) eventName.set(e.id, e.name);

    // email_id -> set of event ids the address is connected to
    const emailEvents = new Map<string, Set<string>>();
    const addEvent = (emailId: string, evId: string | undefined) => {
      if (!evId) return;
      let set = emailEvents.get(emailId);
      if (!set) {
        set = new Set<string>();
        emailEvents.set(emailId, set);
      }
      set.add(evId);
    };
    // email_id -> linked children (for the "Name Kind" column and search)
    const emailChildrenMap = new Map<string, { id: string; name: string; event_id: string }[]>();
    for (const link of childLinks) {
      addEvent(link.email_id, childEvent.get(link.child_id));
      const evId = childEvent.get(link.child_id);
      const list = emailChildrenMap.get(link.email_id) ?? [];
      list.push({
        id: link.child_id,
        name: childName.get(link.child_id) ?? '',
        event_id: evId ?? '',
      });
      emailChildrenMap.set(link.email_id, list);
    }
    for (const link of photoLinks) addEvent(link.email_id, photoEvent.get(link.photo_id));

    let result = rows.map((r) => {
      const ids = Array.from(emailEvents.get(r.id) ?? []);
      const eventList = ids
        .map((id) => ({ id, name: eventName.get(id) ?? '' }))
        .filter((e) => e.name)
        .sort((a, b) => a.name.localeCompare(b.name));
      const childList = (emailChildrenMap.get(r.id) ?? [])
        .filter((c) => c.name)
        .sort((a, b) => a.name.localeCompare(b.name));
      return { ...r, events: eventList, children: childList };
    });

    if (q) {
      // Free-text search across e-mail address, parent name AND linked child
      // names, so typing e.g. "Alain" surfaces both an "alain@…" address and an
      // address whose linked child is called "Alain".
      result = result.filter(
        (r) =>
          String(r.email).toLowerCase().includes(q) ||
          String(r.name ?? '').toLowerCase().includes(q) ||
          r.children.some((c) => c.name.toLowerCase().includes(q)),
      );
    }
    if (eventId) {
      result = result.filter((r) => r.events.some((e) => e.id === eventId));
    }
    result.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
    res.json({ emails: result.slice(0, 200) });
  }),
);

router.post(
  '/emails',
  asyncHandler(async (req, res) => {
    const { email, name, note } = parse(
      z.object({
        email: emailSchema,
        name: z.string().max(200).default(''),
        note: z.string().max(1000).default(''),
      }),
      req.body,
    );
    const normalized = normalizeEmail(email);
    const existing = await firstOf(col(COL.parentEmails).where('email', '==', normalized));
    if (existing) throw new ApiError(409, 'Diese E-Mail-Adresse existiert bereits.');
    const id = newId('eml');
    await setById(COL.parentEmails, id, {
      email: normalized,
      name,
      status: 'not_verified',
      verified_at: null,
      note,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    await audit('email.create', email);
    res.json({ id });
  }),
);

router.get(
  '/emails/:id',
  asyncHandler(async (req, res) => {
    const email = await getById<Record<string, unknown>>(COL.parentEmails, req.params.id);
    if (!email) throw new ApiError(404, 'E-Mail-Adresse nicht gefunden.');

    const childLinks = await runQuery<{ child_id: string }>(
      col(COL.emailChildren).where('email_id', '==', req.params.id),
    );
    const children = (
      await Promise.all(
        childLinks.map(async (l) => {
          const c = await getById<{ name: string; event_id: string }>(COL.children, l.child_id);
          if (!c) return null;
          const ev = await getById<{ name: string }>(COL.events, c.event_id);
          return { id: c.id, name: c.name, event_id: c.event_id, event_name: ev?.name ?? '' };
        }),
      )
    ).filter(Boolean);

    const photoLinks = await runQuery<{ photo_id: string }>(
      col(COL.photoEmails).where('email_id', '==', req.params.id),
    );
    const directPhotos = (
      await Promise.all(
        photoLinks.map(async (l) => {
          const p = await getById<{ original_filename: string; event_id: string }>(COL.photos, l.photo_id);
          if (!p) return null;
          return { id: p.id, original_filename: p.original_filename, event_id: p.event_id };
        }),
      )
    ).filter(Boolean);

    const orders = (await runQuery<{ status: string; total_cents: number; currency: string; created_at: string }>(
      col(COL.orders).where('email_id', '==', req.params.id),
    ))
      .filter((o) => o.status !== 'cart')
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .map((o) => ({ id: o.id, status: o.status, total_cents: o.total_cents, currency: o.currency, created_at: o.created_at }));

    res.json({ email, children, directPhotos, orders });
  }),
);

router.patch(
  '/emails/:id',
  asyncHandler(async (req, res) => {
    // The verification status is derived automatically from whether the parent
    // has verified their e-mail – it is intentionally NOT editable by the admin.
    const data = parse(
      z.object({
        email: emailSchema.optional(),
        name: z.string().max(200).optional(),
        note: z.string().max(1000).optional(),
      }),
      req.body,
    );
    const existing = await getById(COL.parentEmails, req.params.id);
    if (!existing) throw new ApiError(404, 'E-Mail-Adresse nicht gefunden.');
    if (data.email) {
      const clash = await firstOf(col(COL.parentEmails).where('email', '==', normalizeEmail(data.email)));
      if (clash && clash.id !== req.params.id) {
        throw new ApiError(409, 'Diese E-Mail-Adresse existiert bereits.');
      }
    }
    const map: Record<string, unknown> = {};
    if (data.email) map.email = normalizeEmail(data.email);
    if (data.name !== undefined) map.name = data.name;
    if (data.note !== undefined) map.note = data.note;
    if (Object.keys(map).length) {
      await updateById(COL.parentEmails, req.params.id, { ...map, updated_at: nowIso() });
      await audit('email.update', `${req.params.id}: ${JSON.stringify(data)}`);
    }
    res.json({ ok: true });
  }),
);

router.delete(
  '/emails/:id',
  asyncHandler(async (req, res) => {
    await Promise.all([
      deleteWhere(col(COL.emailChildren).where('email_id', '==', req.params.id)),
      deleteWhere(col(COL.photoEmails).where('email_id', '==', req.params.id)),
      deleteWhere(col(COL.parentSessions).where('email_id', '==', req.params.id)),
      deleteWhere(col(COL.verificationTokens).where('email_id', '==', req.params.id)),
    ]);
    await deleteById(COL.parentEmails, req.params.id);
    await audit('email.delete', req.params.id);
    res.json({ ok: true });
  }),
);

router.post(
  '/emails/:id/children',
  asyncHandler(async (req, res) => {
    const { childId } = parse(z.object({ childId: z.string() }), req.body);
    await setById(COL.emailChildren, linkId(req.params.id, childId), {
      email_id: req.params.id,
      child_id: childId,
      created_at: nowIso(),
    });
    res.json({ ok: true });
  }),
);

router.delete(
  '/emails/:id/children/:childId',
  asyncHandler(async (req, res) => {
    await deleteById(COL.emailChildren, linkId(req.params.id, req.params.childId));
    res.json({ ok: true });
  }),
);

// Add a further parent e-mail address (e.g. the second parent) that should see
// exactly the same children as this address. Creates the address if it does not
// exist yet (or reuses it) and mirrors all of this address' child links onto it.
router.post(
  '/emails/:id/related-emails',
  asyncHandler(async (req, res) => {
    const { email, name } = parse(
      z.object({ email: emailSchema, name: z.string().max(200).default('') }),
      req.body,
    );
    const source = await getById<{ email: string }>(COL.parentEmails, req.params.id);
    if (!source) throw new ApiError(404, 'E-Mail-Adresse nicht gefunden.');

    const normalized = normalizeEmail(email);
    if (normalized === source.email) {
      throw new ApiError(409, 'Das ist bereits diese E-Mail-Adresse.');
    }

    // Find or create the target address (never clobber an existing name).
    const existing = await firstOf<{ name?: string }>(
      col(COL.parentEmails).where('email', '==', normalized),
    );
    let targetId: string;
    let created = false;
    if (existing) {
      targetId = existing.id;
      if (name && !existing.name) {
        await updateById(COL.parentEmails, targetId, { name, updated_at: nowIso() });
      }
    } else {
      targetId = newId('eml');
      await setById(COL.parentEmails, targetId, {
        email: normalized,
        name: name || '',
        status: 'not_verified',
        verified_at: null,
        note: '',
        created_at: nowIso(),
        updated_at: nowIso(),
      });
      created = true;
    }

    // Mirror this address' child links onto the new address.
    const childLinks = await runQuery<{ child_id: string }>(
      col(COL.emailChildren).where('email_id', '==', req.params.id),
    );
    let linksCreated = 0;
    for (const link of childLinks) {
      const id = linkId(targetId, link.child_id);
      if (await getById(COL.emailChildren, id)) continue;
      await setById(COL.emailChildren, id, {
        email_id: targetId,
        child_id: link.child_id,
        created_at: nowIso(),
      });
      linksCreated += 1;
    }

    await audit('email.related.create', `${req.params.id} -> ${targetId} (${normalized})`);
    res.json({ id: targetId, created, linksCreated, childCount: childLinks.length });
  }),
);

router.post(
  '/emails/:id/resend-verification',
  asyncHandler(async (req, res) => {
    const row = await getById<{ email: string }>(COL.parentEmails, req.params.id);
    if (!row) throw new ApiError(404, 'E-Mail-Adresse nicht gefunden.');
    await requestVerification(row.email);
    await audit('email.resend', req.params.id);
    res.json({ ok: true });
  }),
);

// --- Bulk import (paste / CSV / Excel) -----------------------------------
// The frontend converts any input (pasted table, CSV or XLSX) into a 2-D array
// of strings. The backend owns the tolerant column detection, builds a review
// plan and finally commits it (creating e-mails, children and their links).
const MAX_IMPORT_ROWS = 5000;
const MAX_IMPORT_COLS = 60;

const mappingSchema = z
  .object({
    // The e-mail role may map to several columns (e.g. "E-Mail" + "E-Mail 2").
    // A single number is still accepted for backwards compatibility.
    email: z
      .union([
        z.number().int().nonnegative(),
        z.array(z.number().int().nonnegative()).max(MAX_IMPORT_COLS),
      ])
      .optional(),
    name: z.number().int().nonnegative().optional(),
    child: z.number().int().nonnegative().optional(),
    event: z.number().int().nonnegative().optional(),
    note: z.number().int().nonnegative().optional(),
  })
  .partial();

function sanitizeRows(raw: unknown[][]): string[][] {
  return raw
    .slice(0, MAX_IMPORT_ROWS)
    .map((r) => (Array.isArray(r) ? r : []).slice(0, MAX_IMPORT_COLS).map((c) => (c == null ? '' : String(c))))
    .filter((r) => r.some((c) => c.trim() !== ''));
}

router.post(
  '/import/preview',
  asyncHandler(async (req, res) => {
    const { rows, mapping, hasHeader } = parse(
      z.object({
        rows: z.array(z.array(z.any())).max(MAX_IMPORT_ROWS),
        mapping: mappingSchema.optional(),
        hasHeader: z.boolean().optional(),
      }),
      req.body,
    );
    const clean = sanitizeRows(rows);
    if (clean.length === 0) throw new ApiError(400, 'Keine verwertbaren Zeilen gefunden.');

    let effectiveMapping: Mapping;
    let effectiveHeader: boolean;
    let columns;
    if (mapping && Object.keys(mapping).length > 0) {
      effectiveMapping = mapping as Mapping;
      effectiveHeader = hasHeader ?? false;
      columns = describeColumns(clean, effectiveMapping, effectiveHeader);
    } else {
      const detection = detectMapping(clean);
      effectiveMapping = detection.mapping;
      effectiveHeader = detection.hasHeader;
      columns = detection.columns;
    }

    const plan = buildPlan(clean, effectiveMapping, effectiveHeader);
    res.json({
      hasHeader: effectiveHeader,
      mapping: effectiveMapping,
      columns,
      rowCount: clean.length,
      plan,
    });
  }),
);

router.post(
  '/import/commit',
  asyncHandler(async (req, res) => {
    const { rows, mapping, hasHeader, defaultEventId, defaultEventName, createMissingEvents } = parse(
      z.object({
        rows: z.array(z.array(z.any())).max(MAX_IMPORT_ROWS),
        mapping: mappingSchema,
        hasHeader: z.boolean().default(false),
        defaultEventId: z.string().optional(),
        defaultEventName: z.string().max(200).optional(),
        createMissingEvents: z.boolean().default(false),
      }),
      req.body,
    );
    const clean = sanitizeRows(rows);
    if (clean.length === 0) throw new ApiError(400, 'Keine verwertbaren Zeilen gefunden.');

    if (defaultEventId) {
      const ev = await getById(COL.events, defaultEventId);
      if (!ev) throw new ApiError(404, 'Ziel-Event nicht gefunden.');
    }

    const plan = buildPlan(clean, mapping as Mapping, hasHeader);
    const result = await commitImport(plan, {
      defaultEventId,
      defaultEventName,
      createMissingEvents,
    });
    await audit(
      'import.commit',
      `emails +${result.emailsCreated}, children +${result.childrenCreated}, links +${result.linksCreated}`,
    );
    res.json({ result });
  }),
);

// --- Orders --------------------------------------------------------------
// Only confirmed orders are real "Bestellungen". `cart` and `checkout_started`
// are intermediate states of the shopping flow and never surface here.
const REAL_ORDER_STATUSES = new Set(['pending', 'completed', 'cancelled']);

router.get(
  '/orders',
  asyncHandler(async (_req, res) => {
    const [allOrders, products, photos, children] = await Promise.all([
      runQuery<{ status: string; total_cents: number; currency: string; created_at: string; email_id: string }>(
        col(COL.orders),
      ),
      runQuery<{ id: string; type: string }>(col(COL.products)),
      runQuery<{ id: string; event_id: string; child_id: string | null }>(col(COL.photos)),
      runQuery<{ id: string; name: string }>(col(COL.children)),
    ]);

    const productType = new Map(products.map((p) => [p.id, p.type]));
    const photoMap = new Map(photos.map((p) => [p.id, p]));
    const childName = new Map(children.map((c) => [c.id, c.name]));

    const orders = allOrders
      .filter((o) => REAL_ORDER_STATUSES.has(o.status))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, 300);

    const result = await Promise.all(
      orders.map(async (o) => {
        const [e, items] = await Promise.all([
          getById<{ email: string }>(COL.parentEmails, o.email_id),
          runQuery<{ photo_id: string; product_id: string; product_name: string; qty: number }>(
            col(COL.orderItems).where('order_id', '==', o.id),
          ),
        ]);

        // Items that need printing/shipping – these carry the thumbnails the
        // admin wants to see directly for pending orders.
        const printItems = items
          .filter((it) => productType.get(it.product_id) === 'print')
          .map((it) => {
            const photo = photoMap.get(it.photo_id);
            return {
              photo_id: it.photo_id,
              product_name: it.product_name,
              qty: it.qty,
              child_name: photo?.child_id ? childName.get(photo.child_id) ?? null : null,
            };
          });

        return {
          id: o.id,
          status: o.status,
          total_cents: o.total_cents,
          currency: o.currency,
          created_at: o.created_at,
          email: e?.email ?? '',
          item_count: items.length,
          has_print: printItems.length > 0,
          print_items: printItems,
        };
      }),
    );
    res.json({ orders: result });
  }),
);

router.get(
  '/orders/:id',
  asyncHandler(async (req, res) => {
    const orderDoc = await getById<Record<string, unknown> & { email_id: string }>(COL.orders, req.params.id);
    if (!orderDoc) throw new ApiError(404, 'Bestellung nicht gefunden.');
    const parentEmail = await getById<{ email: string }>(COL.parentEmails, orderDoc.email_id);
    const order = { ...orderDoc, email: parentEmail?.email ?? '' };

    const rawItems = await runQuery<Record<string, unknown> & { photo_id: string; product_id: string }>(
      col(COL.orderItems).where('order_id', '==', req.params.id),
    );
    const items = await Promise.all(
      rawItems.map(async (oi) => {
        const [photo, product] = await Promise.all([
          getById<{ original_filename: string }>(COL.photos, oi.photo_id),
          getById<{ type: string }>(COL.products, oi.product_id),
        ]);
        return {
          ...oi,
          original_filename: photo?.original_filename ?? '',
          product_type: product?.type ?? 'digital',
        };
      }),
    );
    res.json({ order, items });
  }),
);

router.patch(
  '/orders/:id',
  asyncHandler(async (req, res) => {
    const { status } = parse(z.object({ status: z.enum(ADMIN_ORDER_STATUSES) }), req.body);
    const order = await getById(COL.orders, req.params.id);
    if (!order) throw new ApiError(404, 'Bestellung nicht gefunden.');
    await updateById(COL.orders, req.params.id, { status, updated_at: nowIso() });
    await audit('order.update', `${req.params.id}: ${status}`);
    res.json({ ok: true });
  }),
);

// --- Auswertung / Analytics ----------------------------------------------
// Per-Auftrag (event) evaluation: revenue, verified e-mails, order count, a
// per-buyer breakdown and a daily revenue series for the availability window so
// the admin can judge when a reminder is worthwhile (and whether it worked).
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CHART_DAYS = 92;

function dayKey(value: string | number | Date): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/**
 * Builds the per-Auftrag evaluation figures (revenue, verified e-mails, order
 * count, buyer breakdown and the daily revenue series). Shared by the global
 * Auswertung listing and the per-Auftrag detail view in "Aufträge". When
 * `filterEventId` is given only that single Auftrag is computed/returned.
 */
async function buildAnalytics(filterEventId?: string) {
    const [events, children, emailChildren, photoEmails, photos, parentEmails, orders, orderItems, reminders] =
      await Promise.all([
        runQuery<{ id: string; name: string; status: string; created_at: string; expires_at: string | null; invited_at?: string | null }>(
          col(COL.events),
        ),
        runQuery<{ id: string; event_id: string }>(col(COL.children)),
        runQuery<{ email_id: string; child_id: string }>(col(COL.emailChildren)),
        runQuery<{ email_id: string; photo_id: string }>(col(COL.photoEmails)),
        runQuery<{ id: string; event_id: string }>(col(COL.photos)),
        runQuery<{ id: string; email: string; name?: string; status: string }>(col(COL.parentEmails)),
        runQuery<{ id: string; email_id: string; status: string; total_cents: number; currency: string; created_at: string }>(
          col(COL.orders),
        ),
        runQuery<{ order_id: string; photo_id: string; qty: number; unit_price_cents: number }>(
          col(COL.orderItems),
        ),
        runQuery<{ id: string; event_id: string; sent_at: string; note?: string }>(col(COL.reminders)),
      ]);

    const childEvent = new Map<string, string>();
    for (const c of children) childEvent.set(c.id, c.event_id);
    const photoEvent = new Map<string, string>();
    for (const p of photos) photoEvent.set(p.id, p.event_id);
    const emailById = new Map(parentEmails.map((e) => [e.id, e]));

    // email_id -> set of event ids the address is connected to (child link or
    // direct photo assignment). Mirrors the /emails event filter.
    const eventEmails = new Map<string, Set<string>>();
    const addEmailEvent = (emailId: string, eventId: string | undefined) => {
      if (!eventId) return;
      let set = eventEmails.get(eventId);
      if (!set) {
        set = new Set<string>();
        eventEmails.set(eventId, set);
      }
      set.add(emailId);
    };
    for (const link of emailChildren) addEmailEvent(link.email_id, childEvent.get(link.child_id));
    for (const link of photoEmails) addEmailEvent(link.email_id, photoEvent.get(link.photo_id));

    // Only confirmed, revenue-bearing orders contribute to the figures.
    const orderById = new Map(orders.map((o) => [o.id, o]));
    const countsForRevenue = (status: string) => status === 'pending' || status === 'completed';

    // event_id -> aggregates
    interface BuyerAgg { email_id: string; revenue_cents: number; orderIds: Set<string> }
    const eventRevenue = new Map<string, number>();
    const eventOrders = new Map<string, Set<string>>();
    const eventBuyers = new Map<string, Map<string, BuyerAgg>>();
    const eventDaily = new Map<string, Map<string, number>>();

    for (const item of orderItems) {
      const order = orderById.get(item.order_id);
      if (!order || !countsForRevenue(order.status)) continue;
      const eventId = photoEvent.get(item.photo_id);
      if (!eventId) continue;
      const amount = (item.unit_price_cents ?? 0) * (item.qty ?? 0);

      eventRevenue.set(eventId, (eventRevenue.get(eventId) ?? 0) + amount);

      let oset = eventOrders.get(eventId);
      if (!oset) {
        oset = new Set<string>();
        eventOrders.set(eventId, oset);
      }
      oset.add(order.id);

      let buyers = eventBuyers.get(eventId);
      if (!buyers) {
        buyers = new Map<string, BuyerAgg>();
        eventBuyers.set(eventId, buyers);
      }
      let buyer = buyers.get(order.email_id);
      if (!buyer) {
        buyer = { email_id: order.email_id, revenue_cents: 0, orderIds: new Set<string>() };
        buyers.set(order.email_id, buyer);
      }
      buyer.revenue_cents += amount;
      buyer.orderIds.add(order.id);

      const key = dayKey(order.created_at);
      if (key) {
        let daily = eventDaily.get(eventId);
        if (!daily) {
          daily = new Map<string, number>();
          eventDaily.set(eventId, daily);
        }
        daily.set(key, (daily.get(key) ?? 0) + amount);
      }
    }

    const remindersByEvent = new Map<string, { id: string; sent_at: string; note: string }[]>();
    for (const r of reminders) {
      const list = remindersByEvent.get(r.event_id) ?? [];
      list.push({ id: r.id, sent_at: r.sent_at, note: r.note ?? '' });
      remindersByEvent.set(r.event_id, list);
    }

    const buildDaily = (eventId: string, createdAt: string, expiresAt: string | null) => {
      const start = new Date(createdAt);
      let startMs = isNaN(start.getTime()) ? Date.now() - 29 * DAY_MS : start.getTime();
      const exp = expiresAt ? new Date(expiresAt).getTime() : NaN;
      let endMs = !isNaN(exp) ? exp : startMs + 29 * DAY_MS;
      if (endMs < startMs) endMs = startMs;
      // Always extend the window up to today so a freshly created Auftrag still
      // shows a meaningful axis.
      endMs = Math.max(endMs, Date.now());
      // Cap the number of buckets to keep the chart readable.
      let days = Math.floor((endMs - startMs) / DAY_MS) + 1;
      if (days > MAX_CHART_DAYS) {
        startMs = endMs - (MAX_CHART_DAYS - 1) * DAY_MS;
        days = MAX_CHART_DAYS;
      }
      const daily = eventDaily.get(eventId);
      const series: { date: string; revenue_cents: number }[] = [];
      for (let i = 0; i < days; i += 1) {
        const key = dayKey(startMs + i * DAY_MS);
        series.push({ date: key, revenue_cents: daily?.get(key) ?? 0 });
      }
      return series;
    };

    const result = events
      .filter((ev) => !filterEventId || ev.id === filterEventId)
      .map((ev) => {
        const linked = eventEmails.get(ev.id) ?? new Set<string>();
        let verified = 0;
        for (const emailId of linked) {
          if (emailById.get(emailId)?.status === 'verified') verified += 1;
        }
        const buyersMap = eventBuyers.get(ev.id);
        const buyers = buyersMap
          ? Array.from(buyersMap.values())
              .map((b) => {
                const e = emailById.get(b.email_id);
                return {
                  email_id: b.email_id,
                  email: e?.email ?? '—',
                  name: e?.name ?? '',
                  verified: e?.status === 'verified',
                  order_count: b.orderIds.size,
                  revenue_cents: b.revenue_cents,
                };
              })
              .sort((a, b) => b.revenue_cents - a.revenue_cents)
          : [];

        return {
          id: ev.id,
          name: ev.name,
          status: ev.status,
          created_at: ev.created_at,
          expires_at: ev.expires_at ?? null,
          invited_at: ev.invited_at ?? null,
          revenue_cents: eventRevenue.get(ev.id) ?? 0,
          order_count: eventOrders.get(ev.id)?.size ?? 0,
          email_total: linked.size,
          email_verified: verified,
          buyers,
          daily: buildDaily(ev.id, ev.created_at, ev.expires_at ?? null),
          reminders: (remindersByEvent.get(ev.id) ?? []).sort((a, b) =>
            String(a.sent_at).localeCompare(String(b.sent_at)),
          ),
        };
      })
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

    return { events: result, currency: config.stripe.currency };
}

router.get(
  '/analytics',
  asyncHandler(async (_req, res) => {
    await archiveExpiredEvents();
    res.json(await buildAnalytics());
  }),
);

// Per-Auftrag evaluation, used by the read-only detail view of a finished
// (published/archived) Auftrag in "Aufträge".
router.get(
  '/events/:id/analytics',
  asyncHandler(async (req, res) => {
    await archiveExpiredEvents();
    const { events, currency } = await buildAnalytics(req.params.id);
    const event = events[0];
    if (!event) throw new ApiError(404, 'Auftrag nicht gefunden.');
    res.json({ event, currency });
  }),
);

// --- Reminders (markers for the Auswertung chart) ------------------------
router.post(
  '/events/:id/reminders',
  asyncHandler(async (req, res) => {
    const { sent_at, note } = parse(
      z.object({ sent_at: z.string().optional(), note: z.string().max(300).default('') }),
      req.body ?? {},
    );
    const event = await getById(COL.events, req.params.id);
    if (!event) throw new ApiError(404, 'Auftrag nicht gefunden.');
    const when = sent_at ? new Date(sent_at) : new Date();
    if (isNaN(when.getTime())) throw new ApiError(400, 'Ungültiges Datum.');
    const id = newId('rem');
    await setById(COL.reminders, id, {
      event_id: req.params.id,
      sent_at: when.toISOString(),
      note,
      created_at: nowIso(),
    });
    await audit('reminder.create', `${req.params.id}: ${when.toISOString()}`);
    res.json({ id });
  }),
);

router.delete(
  '/reminders/:id',
  asyncHandler(async (req, res) => {
    await deleteById(COL.reminders, req.params.id);
    await audit('reminder.delete', req.params.id);
    res.json({ ok: true });
  }),
);

// --- Reminder-E-Mail an die Eltern eines Auftrags ------------------------
// Verschickt – ähnlich der Galerie-Einladung – eine Erinnerung ("Ihre Fotos
// sind noch X Tage verfügbar") an ausgewählte Eltern-Adressen. Anders als die
// Einladung unter "Aufträge" wird hier pro Kind aufgeschlüsselt, welche
// Adressen bereits bestätigt wurden bzw. schon bestellt haben, damit der Admin
// gezielt nur die Nicht-Besteller erinnern kann.

/** Remaining days until the gallery is archived (null when no/expired date). */
function daysLeftUntil(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const end = new Date(expiresAt).getTime();
  if (isNaN(end)) return null;
  const days = Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000));
  return days > 0 ? days : null;
}

/**
 * Email ids that have a confirmed (pending/completed) order within this event.
 * An order belongs to the event when at least one of its items references a
 * photo of that event.
 */
async function orderedEmailIdsForEvent(eventId: string): Promise<Set<string>> {
  const [photos, orders, orderItems] = await Promise.all([
    runQuery<{ id: string }>(col(COL.photos).where('event_id', '==', eventId)),
    runQuery<{ id: string; email_id: string; status: string }>(col(COL.orders)),
    runQuery<{ order_id: string; photo_id: string }>(col(COL.orderItems)),
  ]);
  const photoIds = new Set(photos.map((p) => p.id));
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const ordered = new Set<string>();
  for (const item of orderItems) {
    if (!photoIds.has(item.photo_id)) continue;
    const order = orderById.get(item.order_id);
    if (!order) continue;
    if (order.status === 'pending' || order.status === 'completed') {
      ordered.add(order.email_id);
    }
  }
  return ordered;
}

router.get(
  '/events/:id/reminder-recipients',
  asyncHandler(async (req, res) => {
    const eventId = req.params.id;
    const event = await getById<{ expires_at: string | null; status: string }>(
      COL.events,
      eventId,
    );
    if (!event) throw new ApiError(404, 'Auftrag nicht gefunden.');

    const [children, childLinks, photos, photoLinks, ordered] = await Promise.all([
      runQuery<{ name: string }>(col(COL.children).where('event_id', '==', eventId)),
      runQuery<{ email_id: string; child_id: string }>(col(COL.emailChildren)),
      runQuery<{ id: string }>(col(COL.photos).where('event_id', '==', eventId)),
      runQuery<{ email_id: string; photo_id: string }>(col(COL.photoEmails)),
      orderedEmailIdsForEvent(eventId),
    ]);
    children.sort((a, b) => String(a.name).localeCompare(String(b.name)));

    const childIds = new Set(children.map((c) => c.id));
    const photoIds = new Set(photos.map((p) => p.id));
    const linksForEvent = childLinks.filter((l) => childIds.has(l.child_id));

    // All e-mail ids we need to load: child-linked plus direct photo-assigned.
    const neededIds = new Set<string>();
    for (const l of linksForEvent) neededIds.add(l.email_id);
    const directEmailIds = new Set<string>();
    for (const l of photoLinks) {
      if (photoIds.has(l.photo_id)) {
        directEmailIds.add(l.email_id);
        neededIds.add(l.email_id);
      }
    }
    const emailDocs = await getManyById<{ email: string; name?: string; status: string }>(
      COL.parentEmails,
      Array.from(neededIds),
    );

    const toView = (id: string) => {
      const e = emailDocs.get(id);
      if (!e || !e.email || e.status === 'disabled') return null;
      return {
        id: e.id,
        email: e.email,
        name: e.name ?? '',
        status: e.status,
        verified: e.status === 'verified',
        hasOrdered: ordered.has(e.id),
      };
    };

    const emailsByChild = new Map<string, ReturnType<typeof toView>[]>();
    const childLinkedEmailIds = new Set<string>();
    for (const l of linksForEvent) {
      const view = toView(l.email_id);
      if (!view) continue;
      childLinkedEmailIds.add(view.id);
      const list = emailsByChild.get(l.child_id) ?? [];
      list.push(view);
      emailsByChild.set(l.child_id, list);
    }

    const childrenOut = children.map((c) => ({
      id: c.id,
      name: c.name,
      emails: (emailsByChild.get(c.id) ?? [])
        .filter((e): e is NonNullable<typeof e> => e !== null)
        .sort((a, b) => a.email.localeCompare(b.email)),
    }));

    // E-mail addresses linked only through a direct photo assignment (no child).
    const otherEmails = Array.from(directEmailIds)
      .filter((id) => !childLinkedEmailIds.has(id))
      .map(toView)
      .filter((e): e is NonNullable<typeof e> => e !== null)
      .sort((a, b) => a.email.localeCompare(b.email));

    res.json({
      children: childrenOut,
      otherEmails,
      adminEmail: await resolveAdminEmail(req.admin!.username),
      devLogOnly: config.mail.devLogOnly,
      retentionDays: config.retentionDaysDefault,
      daysLeft: daysLeftUntil(event.expires_at ?? null),
    });
  }),
);

router.post(
  '/events/:id/send-reminder',
  asyncHandler(async (req, res) => {
    const { emailIds, sendToSelf, mentionExtension } = parse(
      z.object({
        emailIds: z.array(z.string()).optional(),
        sendToSelf: z.boolean().default(false),
        // Wenn gesetzt, weist die Erinnerung darauf hin, dass der
        // Bestellzeitraum (bis expires_at) verlängert wurde.
        mentionExtension: z.boolean().default(false),
      }),
      req.body ?? {},
    );
    const eventId = req.params.id;
    const event = await getById<{ expires_at: string | null }>(COL.events, eventId);
    if (!event) throw new ApiError(404, 'Auftrag nicht gefunden.');

    // Validate the selection against the addresses actually linked to the event.
    const allowed = await eventEmailIds(eventId);
    const selectedIds = (emailIds ?? Array.from(allowed)).filter((id) => allowed.has(id));
    const emails = await getManyById<{ email: string; status: string }>(
      COL.parentEmails,
      selectedIds,
    );
    const recipients = Array.from(emails.values()).filter(
      (e) => e.status !== 'disabled' && e.email,
    );

    const selfEmail = sendToSelf ? await resolveAdminEmail(req.admin!.username) : '';
    if (recipients.length === 0 && !selfEmail) {
      throw new ApiError(400, 'Es wurde keine (aktive) E-Mail-Adresse ausgewählt.');
    }

    const link = config.publicAppUrl;
    const daysLeft = daysLeftUntil(event.expires_at ?? null);
    const mailOpts = {
      retentionDays: config.retentionDaysDefault,
      reminder: true as const,
      daysLeft,
      extendedUntil: mentionExtension ? event.expires_at ?? null : null,
    };
    const results = await Promise.allSettled(
      recipients.map((r) => sendGalleryReadyEmail(r.email, link, mailOpts)),
    );
    const sent = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - sent;

    let sentToSelf = false;
    if (selfEmail) {
      try {
        await sendGalleryReadyEmail(selfEmail, link, mailOpts);
        sentToSelf = true;
      } catch {
        sentToSelf = false;
      }
    }

    if (sent > 0) {
      await setById(COL.reminders, newId('rem'), {
        event_id: eventId,
        sent_at: nowIso(),
        note: `Reminder per E-Mail an ${sent} Adresse(n)`,
        created_at: nowIso(),
      });
    }

    await audit(
      'event.reminder.send',
      `${eventId}: ${sent} sent, ${failed} failed${sentToSelf ? ', self copy' : ''}`,
    );
    res.json({
      sent,
      failed,
      total: recipients.length,
      sentToSelf,
      devLogOnly: config.mail.devLogOnly,
    });
  }),
);

// --- Reports -------------------------------------------------------------
router.get(
  '/reports',
  asyncHandler(async (_req, res) => {
    const reports = (await runQuery<{ created_at: string }>(col(COL.reports)))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, 300);
    res.json({ reports });
  }),
);

router.patch(
  '/reports/:id',
  asyncHandler(async (req, res) => {
    const { status } = parse(z.object({ status: z.enum(['open', 'in_progress', 'resolved']) }), req.body);
    await updateById(COL.reports, req.params.id, { status });
    res.json({ ok: true });
  }),
);

router.delete(
  '/reports/:id',
  asyncHandler(async (req, res) => {
    const report = await getById(COL.reports, req.params.id);
    if (!report) throw new ApiError(404, 'Meldung nicht gefunden.');
    await deleteById(COL.reports, req.params.id);
    await audit('report.delete', req.params.id);
    res.json({ ok: true });
  }),
);

// --- Products ------------------------------------------------------------
router.get(
  '/products',
  asyncHandler(async (_req, res) => {
    const products = (await runQuery<{ sort_order: number }>(col(COL.products))).sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
    );
    res.json({ products });
  }),
);

router.post(
  '/products',
  asyncHandler(async (req, res) => {
    const data = parse(
      z.object({
        name: z.string().trim().min(1).max(200),
        description: z.string().max(2000).default(''),
        type: z.enum(['digital', 'print']),
        price_cents: z.number().int().min(0),
        sort_order: z.number().int().default(0),
      }),
      req.body,
    );
    const id = newId('prod');
    await setById(COL.products, id, {
      name: data.name,
      description: data.description,
      type: data.type,
      price_cents: data.price_cents,
      currency: config.stripe.currency,
      active: 1,
      sort_order: data.sort_order,
      created_at: nowIso(),
    });
    res.json({ id });
  }),
);

router.patch(
  '/products/:id',
  asyncHandler(async (req, res) => {
    const data = parse(
      z.object({
        name: z.string().trim().min(1).max(200).optional(),
        description: z.string().max(2000).optional(),
        price_cents: z.number().int().min(0).optional(),
        active: z.boolean().optional(),
        sort_order: z.number().int().optional(),
      }),
      req.body,
    );
    const map: Record<string, unknown> = { ...data };
    if (data.active !== undefined) map.active = data.active ? 1 : 0;
    if (Object.keys(map).length) {
      await updateById(COL.products, req.params.id, map);
    }
    res.json({ ok: true });
  }),
);

export default router;
