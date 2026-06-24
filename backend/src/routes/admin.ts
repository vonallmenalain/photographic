import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getDb } from '../db';
import { config } from '../config';
import { asyncHandler, ApiError } from '../middleware/errorHandler';
import { requireAdmin, ADMIN_COOKIE } from '../middleware/adminAuth';
import { adminLoginLimiter } from '../middleware/rateLimit';
import { signAdminToken } from '../lib/auth';
import { setAuthCookie, clearAuthCookie } from '../lib/cookies';
import { newId } from '../lib/ids';
import { emailSchema, parse, normalizeEmail } from '../lib/validation';
import { processOriginal, reprocessFromOriginal, deleteAllVariants, variantPath } from '../lib/images';
import { requestVerification } from '../services/verification';

const router = Router();

const EVENT_STATUSES = ['draft', 'in_progress', 'ready', 'published', 'archived', 'disabled'] as const;
const EMAIL_STATUSES = ['created', 'not_verified', 'verification_sent', 'verified', 'disabled', 'support'] as const;
const PHOTO_STATUSES = ['uploaded', 'processed', 'assigned', 'disabled'] as const;
const ORDER_STATUSES = ['cart', 'checkout_started', 'paid', 'failed', 'completed', 'fulfilled', 'cancelled', 'refunded'] as const;

function audit(action: string, detail: string, actor = 'admin') {
  getDb().prepare('INSERT INTO audit_log (id, actor, action, detail) VALUES (?, ?, ?, ?)').run(
    newId('aud'),
    actor,
    action,
    detail,
  );
}

// --- Auth ----------------------------------------------------------------
router.post(
  '/login',
  adminLoginLimiter,
  asyncHandler(async (req, res) => {
    const { username, password } = parse(
      z.object({ username: z.string().min(1), password: z.string().min(1) }),
      req.body,
    );
    const db = getDb();
    const user = db
      .prepare('SELECT id, username, password_hash FROM admin_users WHERE username = ?')
      .get(username) as { id: string; username: string; password_hash: string } | undefined;
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

// All routes below require admin.
router.use(requireAdmin);

// --- Dashboard -----------------------------------------------------------
router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const one = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
    res.json({
      events: one('SELECT COUNT(*) c FROM events'),
      publishedEvents: one("SELECT COUNT(*) c FROM events WHERE status='published'"),
      photos: one('SELECT COUNT(*) c FROM photos'),
      publishedPhotos: one('SELECT COUNT(*) c FROM photos WHERE published=1'),
      emails: one('SELECT COUNT(*) c FROM parent_emails'),
      verifiedEmails: one("SELECT COUNT(*) c FROM parent_emails WHERE status='verified'"),
      orders: one("SELECT COUNT(*) c FROM orders WHERE status!='cart'"),
      openReports: one("SELECT COUNT(*) c FROM reports WHERE status='open'"),
    });
  }),
);

// --- Events --------------------------------------------------------------
router.get(
  '/events',
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const events = db
      .prepare(
        `SELECT e.*, (SELECT COUNT(*) FROM photos p WHERE p.event_id = e.id) AS photo_count,
                (SELECT COUNT(*) FROM children c WHERE c.event_id = e.id) AS child_count
         FROM events e ORDER BY e.created_at DESC`,
      )
      .all();
    res.json({ events });
  }),
);

router.post(
  '/events',
  asyncHandler(async (req, res) => {
    const { name, description } = parse(
      z.object({ name: z.string().trim().min(1).max(200), description: z.string().max(2000).default('') }),
      req.body,
    );
    const db = getDb();
    const id = newId('evt');
    const expires = new Date(Date.now() + config.retentionDaysDefault * 86400_000)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19);
    db.prepare('INSERT INTO events (id, name, description, expires_at) VALUES (?, ?, ?, ?)').run(
      id,
      name,
      description,
      expires,
    );
    audit('event.create', id);
    res.json({ id });
  }),
);

router.get(
  '/events/:id',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
    if (!event) throw new ApiError(404, 'Event nicht gefunden.');
    const children = db
      .prepare('SELECT * FROM children WHERE event_id = ? ORDER BY name')
      .all(req.params.id);
    const photos = db
      .prepare(
        `SELECT id, child_id, is_class_photo, original_filename, status, published, sort_order, width, height
         FROM photos WHERE event_id = ? ORDER BY sort_order, created_at`,
      )
      .all(req.params.id);
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
      }),
      req.body,
    );
    const db = getDb();
    const event = db.prepare('SELECT id FROM events WHERE id = ?').get(req.params.id);
    if (!event) throw new ApiError(404, 'Event nicht gefunden.');
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [k, v] of Object.entries(data)) {
      fields.push(`${k} = ?`);
      values.push(v);
    }
    if (fields.length) {
      values.push(req.params.id);
      db.prepare(`UPDATE events SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(
        ...values,
      );
      audit('event.update', `${req.params.id}: ${JSON.stringify(data)}`);
    }
    res.json({ ok: true });
  }),
);

router.delete(
  '/events/:id',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const photos = db.prepare('SELECT storage_key, ext FROM photos WHERE event_id = ?').all(req.params.id) as {
      storage_key: string;
      ext: string;
    }[];
    db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
    await Promise.all(photos.map((p) => deleteAllVariants(p.storage_key, p.ext)));
    audit('event.delete', req.params.id);
    res.json({ ok: true });
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
    const db = getDb();
    const event = db.prepare('SELECT id FROM events WHERE id = ?').get(req.params.id);
    if (!event) throw new ApiError(404, 'Event nicht gefunden.');
    const id = newId('chd');
    db.prepare('INSERT INTO children (id, event_id, name, note) VALUES (?, ?, ?, ?)').run(
      id,
      req.params.id,
      name,
      note,
    );
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
    const db = getDb();
    const fields = Object.keys(data).map((k) => `${k} = ?`);
    if (fields.length) {
      db.prepare(`UPDATE children SET ${fields.join(', ')} WHERE id = ?`).run(
        ...Object.values(data),
        req.params.id,
      );
    }
    res.json({ ok: true });
  }),
);

router.delete(
  '/children/:id',
  asyncHandler(async (req, res) => {
    getDb().prepare('DELETE FROM children WHERE id = ?').run(req.params.id);
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
    const db = getDb();
    const event = db.prepare('SELECT id FROM events WHERE id = ?').get(req.params.id);
    if (!event) throw new ApiError(404, 'Event nicht gefunden.');
    const files = (req.files as Express.Multer.File[]) ?? [];
    if (files.length === 0) throw new ApiError(400, 'Keine Dateien empfangen.');

    const results: { id: string; filename: string; ok: boolean; error?: string }[] = [];
    for (const file of files) {
      const id = newId('pho');
      const ext = (path.extname(file.originalname).replace('.', '').toLowerCase() || 'jpg').slice(0, 5);
      const storageKey = `${req.params.id}/${id}`;
      db.prepare(
        `INSERT INTO photos (id, event_id, original_filename, storage_key, ext, status)
         VALUES (?, ?, ?, ?, ?, 'uploaded')`,
      ).run(id, req.params.id, file.originalname.slice(0, 255), storageKey, ext);
      try {
        const meta = await processOriginal(file.buffer, storageKey, ext);
        db.prepare(
          "UPDATE photos SET status='processed', width=?, height=?, bytes=?, updated_at=datetime('now') WHERE id=?",
        ).run(meta.width, meta.height, meta.bytes, id);
        results.push({ id, filename: file.originalname, ok: true });
      } catch (err) {
        db.prepare("UPDATE photos SET processing_error=?, updated_at=datetime('now') WHERE id=?").run(
          String(err).slice(0, 500),
          id,
        );
        results.push({ id, filename: file.originalname, ok: false, error: 'Verarbeitung fehlgeschlagen' });
      }
    }
    audit('photo.upload', `${req.params.id}: ${results.length} files`);
    res.json({ results });
  }),
);

// Admin-only clean thumbnail (auth required via cookie/bearer).
router.get(
  '/photos/:id/thumb',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const photo = db.prepare('SELECT storage_key FROM photos WHERE id = ?').get(req.params.id) as
      | { storage_key: string }
      | undefined;
    if (!photo) throw new ApiError(404, 'Foto nicht gefunden.');
    const fs = await import('fs');
    const p = variantPath('admin', photo.storage_key);
    if (!fs.existsSync(p)) throw new ApiError(404, 'Vorschau nicht verfügbar.');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=60');
    fs.createReadStream(p).pipe(res);
  }),
);

router.patch(
  '/photos/:id',
  asyncHandler(async (req, res) => {
    const data = parse(
      z.object({
        child_id: z.string().nullable().optional(),
        is_class_photo: z.boolean().optional(),
        published: z.boolean().optional(),
        status: z.enum(PHOTO_STATUSES).optional(),
        sort_order: z.number().int().optional(),
      }),
      req.body,
    );
    const db = getDb();
    const photo = db.prepare('SELECT id FROM photos WHERE id = ?').get(req.params.id);
    if (!photo) throw new ApiError(404, 'Foto nicht gefunden.');
    const map: Record<string, unknown> = {};
    if (data.child_id !== undefined) map.child_id = data.child_id;
    if (data.is_class_photo !== undefined) map.is_class_photo = data.is_class_photo ? 1 : 0;
    if (data.published !== undefined) map.published = data.published ? 1 : 0;
    if (data.status !== undefined) map.status = data.status;
    if (data.sort_order !== undefined) map.sort_order = data.sort_order;
    const fields = Object.keys(map).map((k) => `${k} = ?`);
    if (fields.length) {
      db.prepare(`UPDATE photos SET ${fields.join(', ')}, updated_at=datetime('now') WHERE id = ?`).run(
        ...Object.values(map),
        req.params.id,
      );
      audit('photo.update', `${req.params.id}: ${JSON.stringify(data)}`);
    }
    res.json({ ok: true });
  }),
);

router.post(
  '/photos/:id/reprocess',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const photo = db.prepare('SELECT storage_key, ext FROM photos WHERE id = ?').get(req.params.id) as
      | { storage_key: string; ext: string }
      | undefined;
    if (!photo) throw new ApiError(404, 'Foto nicht gefunden.');
    const meta = await reprocessFromOriginal(photo.storage_key, photo.ext);
    db.prepare(
      "UPDATE photos SET status='processed', processing_error=NULL, width=?, height=?, bytes=?, updated_at=datetime('now') WHERE id=?",
    ).run(meta.width, meta.height, meta.bytes, req.params.id);
    res.json({ ok: true });
  }),
);

router.delete(
  '/photos/:id',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const photo = db.prepare('SELECT storage_key, ext FROM photos WHERE id = ?').get(req.params.id) as
      | { storage_key: string; ext: string }
      | undefined;
    if (!photo) throw new ApiError(404, 'Foto nicht gefunden.');
    db.prepare('DELETE FROM photos WHERE id = ?').run(req.params.id);
    await deleteAllVariants(photo.storage_key, photo.ext);
    audit('photo.delete', req.params.id);
    res.json({ ok: true });
  }),
);

// Direct photo <-> e-mail assignment (class photos / overrides).
router.post(
  '/photos/:id/emails',
  asyncHandler(async (req, res) => {
    const { emailId } = parse(z.object({ emailId: z.string() }), req.body);
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO photo_emails (photo_id, email_id) VALUES (?, ?)').run(
      req.params.id,
      emailId,
    );
    res.json({ ok: true });
  }),
);

router.delete(
  '/photos/:id/emails/:emailId',
  asyncHandler(async (req, res) => {
    getDb()
      .prepare('DELETE FROM photo_emails WHERE photo_id = ? AND email_id = ?')
      .run(req.params.id, req.params.emailId);
    res.json({ ok: true });
  }),
);

router.get(
  '/photos/:id/emails',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const direct = db
      .prepare(
        `SELECT pe.email_id, e.email FROM photo_emails pe JOIN parent_emails e ON e.id = pe.email_id WHERE pe.photo_id = ?`,
      )
      .all(req.params.id);
    res.json({ emails: direct });
  }),
);

// --- E-mail / parent management ------------------------------------------
router.get(
  '/emails',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const q = String(req.query.q ?? '').trim().toLowerCase();
    const rows = q
      ? db
          .prepare('SELECT * FROM parent_emails WHERE email LIKE ? ORDER BY created_at DESC LIMIT 200')
          .all(`%${q}%`)
      : db.prepare('SELECT * FROM parent_emails ORDER BY created_at DESC LIMIT 200').all();
    res.json({ emails: rows });
  }),
);

router.post(
  '/emails',
  asyncHandler(async (req, res) => {
    const { email, note } = parse(
      z.object({ email: emailSchema, note: z.string().max(1000).default('') }),
      req.body,
    );
    const db = getDb();
    const existing = db.prepare('SELECT id FROM parent_emails WHERE email = ?').get(email);
    if (existing) throw new ApiError(409, 'Diese E-Mail-Adresse existiert bereits.');
    const id = newId('eml');
    db.prepare("INSERT INTO parent_emails (id, email, status, note) VALUES (?, ?, 'not_verified', ?)").run(
      id,
      normalizeEmail(email),
      note,
    );
    audit('email.create', email);
    res.json({ id });
  }),
);

router.get(
  '/emails/:id',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const email = db.prepare('SELECT * FROM parent_emails WHERE id = ?').get(req.params.id);
    if (!email) throw new ApiError(404, 'E-Mail-Adresse nicht gefunden.');
    const children = db
      .prepare(
        `SELECT c.id, c.name, c.event_id, ev.name AS event_name FROM email_children ec
         JOIN children c ON c.id = ec.child_id JOIN events ev ON ev.id = c.event_id
         WHERE ec.email_id = ?`,
      )
      .all(req.params.id);
    const directPhotos = db
      .prepare(
        `SELECT p.id, p.original_filename, p.event_id FROM photo_emails pe JOIN photos p ON p.id = pe.photo_id WHERE pe.email_id = ?`,
      )
      .all(req.params.id);
    const orders = db
      .prepare("SELECT id, status, total_cents, currency, created_at FROM orders WHERE email_id = ? AND status != 'cart' ORDER BY created_at DESC")
      .all(req.params.id);
    res.json({ email, children, directPhotos, orders });
  }),
);

router.patch(
  '/emails/:id',
  asyncHandler(async (req, res) => {
    const data = parse(
      z.object({
        email: emailSchema.optional(),
        status: z.enum(EMAIL_STATUSES).optional(),
        note: z.string().max(1000).optional(),
      }),
      req.body,
    );
    const db = getDb();
    const existing = db.prepare('SELECT id FROM parent_emails WHERE id = ?').get(req.params.id);
    if (!existing) throw new ApiError(404, 'E-Mail-Adresse nicht gefunden.');
    if (data.email) {
      const clash = db
        .prepare('SELECT id FROM parent_emails WHERE email = ? AND id != ?')
        .get(normalizeEmail(data.email), req.params.id);
      if (clash) throw new ApiError(409, 'Diese E-Mail-Adresse existiert bereits.');
    }
    const map: Record<string, unknown> = {};
    if (data.email) map.email = normalizeEmail(data.email);
    if (data.status) map.status = data.status;
    if (data.note !== undefined) map.note = data.note;
    const fields = Object.keys(map).map((k) => `${k} = ?`);
    if (fields.length) {
      db.prepare(`UPDATE parent_emails SET ${fields.join(', ')}, updated_at=datetime('now') WHERE id = ?`).run(
        ...Object.values(map),
        req.params.id,
      );
      audit('email.update', `${req.params.id}: ${JSON.stringify(data)}`);
    }
    res.json({ ok: true });
  }),
);

router.delete(
  '/emails/:id',
  asyncHandler(async (req, res) => {
    getDb().prepare('DELETE FROM parent_emails WHERE id = ?').run(req.params.id);
    audit('email.delete', req.params.id);
    res.json({ ok: true });
  }),
);

router.post(
  '/emails/:id/children',
  asyncHandler(async (req, res) => {
    const { childId } = parse(z.object({ childId: z.string() }), req.body);
    getDb()
      .prepare('INSERT OR IGNORE INTO email_children (email_id, child_id) VALUES (?, ?)')
      .run(req.params.id, childId);
    res.json({ ok: true });
  }),
);

router.delete(
  '/emails/:id/children/:childId',
  asyncHandler(async (req, res) => {
    getDb()
      .prepare('DELETE FROM email_children WHERE email_id = ? AND child_id = ?')
      .run(req.params.id, req.params.childId);
    res.json({ ok: true });
  }),
);

router.post(
  '/emails/:id/resend-verification',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const row = db.prepare('SELECT email FROM parent_emails WHERE id = ?').get(req.params.id) as
      | { email: string }
      | undefined;
    if (!row) throw new ApiError(404, 'E-Mail-Adresse nicht gefunden.');
    await requestVerification(row.email);
    audit('email.resend', req.params.id);
    res.json({ ok: true });
  }),
);

// --- Orders --------------------------------------------------------------
router.get(
  '/orders',
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const orders = db
      .prepare(
        `SELECT o.id, o.status, o.total_cents, o.currency, o.created_at, e.email
         FROM orders o JOIN parent_emails e ON e.id = o.email_id
         WHERE o.status != 'cart' ORDER BY o.created_at DESC LIMIT 300`,
      )
      .all();
    res.json({ orders });
  }),
);

router.get(
  '/orders/:id',
  asyncHandler(async (req, res) => {
    const db = getDb();
    const order = db
      .prepare(
        `SELECT o.*, e.email FROM orders o JOIN parent_emails e ON e.id = o.email_id WHERE o.id = ?`,
      )
      .get(req.params.id);
    if (!order) throw new ApiError(404, 'Bestellung nicht gefunden.');
    const items = db
      .prepare(
        `SELECT oi.*, ph.original_filename FROM order_items oi JOIN photos ph ON ph.id = oi.photo_id WHERE oi.order_id = ?`,
      )
      .all(req.params.id);
    res.json({ order, items });
  }),
);

router.patch(
  '/orders/:id',
  asyncHandler(async (req, res) => {
    const { status } = parse(z.object({ status: z.enum(ORDER_STATUSES) }), req.body);
    const db = getDb();
    db.prepare("UPDATE orders SET status = ?, updated_at=datetime('now') WHERE id = ?").run(
      status,
      req.params.id,
    );
    audit('order.update', `${req.params.id}: ${status}`);
    res.json({ ok: true });
  }),
);

// --- Reports -------------------------------------------------------------
router.get(
  '/reports',
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const reports = db.prepare('SELECT * FROM reports ORDER BY created_at DESC LIMIT 300').all();
    res.json({ reports });
  }),
);

router.patch(
  '/reports/:id',
  asyncHandler(async (req, res) => {
    const { status } = parse(z.object({ status: z.enum(['open', 'in_progress', 'resolved']) }), req.body);
    getDb().prepare('UPDATE reports SET status = ? WHERE id = ?').run(status, req.params.id);
    res.json({ ok: true });
  }),
);

// --- Products ------------------------------------------------------------
router.get(
  '/products',
  asyncHandler(async (_req, res) => {
    res.json({ products: getDb().prepare('SELECT * FROM products ORDER BY sort_order').all() });
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
    getDb()
      .prepare(
        `INSERT INTO products (id, name, description, type, price_cents, currency, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, data.name, data.description, data.type, data.price_cents, config.stripe.currency, data.sort_order);
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
    const fields = Object.keys(map).map((k) => `${k} = ?`);
    if (fields.length) {
      getDb()
        .prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`)
        .run(...Object.values(map), req.params.id);
    }
    res.json({ ok: true });
  }),
);

export default router;
