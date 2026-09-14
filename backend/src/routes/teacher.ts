import { Router, Request } from 'express';
import { z } from 'zod';
import { COL, getById } from '../db';
import { asyncHandler, ApiError } from '../middleware/errorHandler';
import { requireParent } from '../middleware/parentAuth';
import { consentLimiter } from '../middleware/rateLimit';
import { parse } from '../lib/validation';
import { config } from '../config';
import {
  type RegistrationEvent,
  isTeacherOf,
  registrationOpen,
  registrationView,
  rosterForEvent,
  addChildrenByNames,
  renameChild,
  confirmChild,
  mergeChildren,
  removeChild,
  inviteParents,
  remindPendingConsents,
  markTeacherCompleted,
  rotateParentLink,
  qrCodeSvg,
  parentLinkUrl,
  parentShareText,
  teacherEventsForEmail,
} from '../services/registration';

/**
 * Klassenseite der Lehrperson. Eine „Lehrperson“ ist keine eigene Rolle mit
 * Konto, sondern die bestätigte E-Mail-Adresse, die der Fotograf am Auftrag
 * als Lehrperson eingetragen hat. Jede Route prüft deshalb: gültige Eltern-
 * Sitzung (wie im Elternbereich) UND die Sitzungsadresse ist die Lehrperson
 * dieses Auftrags. Fremde Klassen liefern 404, nie 403 – kein Hinweis darauf,
 * dass es sie gibt.
 *
 * Was die Lehrperson sieht, hängt von der Einstellung des Fotografen ab:
 * E-Mail-Adressen der Eltern nur, wenn sie diese selbst erfasst
 * (`teacher_enters_emails`), sonst maskiert. Fotos, Bestellungen und andere
 * Aufträge sind hier nie erreichbar.
 */
const router = Router();
router.use(requireParent);
router.use(consentLimiter);

/** Erinnerungen durch die Lehrperson höchstens einmal je 24 Stunden. */
const TEACHER_REMIND_THROTTLE_MS = 24 * 60 * 60 * 1000;

async function loadTeacherEvent(req: Request): Promise<RegistrationEvent> {
  const ev = await getById<RegistrationEvent>(COL.events, req.params.id);
  if (!ev || !isTeacherOf(ev, req.parent!.email)) throw new ApiError(404, 'Klasse nicht gefunden.');
  return ev;
}

function requireOpen(ev: RegistrationEvent): void {
  if (!registrationOpen(ev)) {
    throw new ApiError(410, 'Die Erfassung dieser Klasse ist abgeschlossen. Änderungen sind nicht mehr möglich.');
  }
}

/** Sicht der Lehrperson auf die Einstellungen – ohne interne Felder. */
function teacherRegistrationView(ev: RegistrationEvent) {
  const v = registrationView(ev);
  if (!v) return null;
  return {
    school: v.school,
    shooting_date: v.shooting_date,
    shooting_date_text: v.shooting_date_text,
    deadline: v.deadline,
    deadline_text: v.deadline_text,
    teacher_name: v.teacher_name,
    teacher_enters_emails: v.teacher_enters_emails,
    parent_link_enabled: v.parent_link_enabled,
    parent_link_url: v.parent_link_url,
    consent_required: v.consent_required,
    teacher_completed_at: v.teacher_completed_at,
    last_reminder_at: v.last_reminder_at,
    closed_at: v.closed_at,
    open: v.open,
  };
}

router.get(
  '/classes',
  asyncHandler(async (req, res) => {
    const events = await teacherEventsForEmail(req.parent!.email);
    const classes = await Promise.all(
      events.map(async (ev) => {
        const roster = await rosterForEvent(ev, { showEmails: false });
        return {
          id: ev.id,
          name: ev.name,
          status: ev.status,
          open: registrationOpen(ev),
          registration: teacherRegistrationView(ev),
          stats: roster.stats,
        };
      }),
    );
    res.json({ classes });
  }),
);

router.get(
  '/classes/:id',
  asyncHandler(async (req, res) => {
    const ev = await loadTeacherEvent(req);
    const reg = ev.registration!;
    const roster = await rosterForEvent(ev, { showEmails: reg.teacher_enters_emails });
    const linkUrl = reg.parent_link_enabled && reg.parent_link_token ? parentLinkUrl(reg.parent_link_token) : null;
    res.json({
      event: { id: ev.id, name: ev.name, status: ev.status },
      registration: teacherRegistrationView(ev),
      roster,
      parentLink: linkUrl
        ? { url: linkUrl, qrSvg: await qrCodeSvg(linkUrl), shareText: parentShareText(ev, linkUrl) }
        : null,
      devLogOnly: config.mail.devLogOnly,
    });
  }),
);

router.post(
  '/classes/:id/children',
  asyncHandler(async (req, res) => {
    const ev = await loadTeacherEvent(req);
    requireOpen(ev);
    const { names } = parse(
      z.object({ names: z.array(z.string().max(200)).min(1).max(200) }),
      req.body ?? {},
    );
    const result = await addChildrenByNames(ev, names, 'teacher', req.parent!.email);
    res.json(result);
  }),
);

router.patch(
  '/classes/:id/children/:childId',
  asyncHandler(async (req, res) => {
    const ev = await loadTeacherEvent(req);
    requireOpen(ev);
    const { name, confirm, mergeInto } = parse(
      z.object({
        name: z.string().trim().min(1).max(200).optional(),
        confirm: z.boolean().optional(),
        mergeInto: z.string().optional(),
      }),
      req.body ?? {},
    );
    if (mergeInto) {
      await mergeChildren(ev, req.params.childId, mergeInto, req.parent!.email);
      res.json({ ok: true });
      return;
    }
    if (name !== undefined) await renameChild(ev, req.params.childId, name, req.parent!.email);
    if (confirm) await confirmChild(ev, req.params.childId, req.parent!.email);
    res.json({ ok: true });
  }),
);

router.delete(
  '/classes/:id/children/:childId',
  asyncHandler(async (req, res) => {
    const ev = await loadTeacherEvent(req);
    requireOpen(ev);
    await removeChild(ev, req.params.childId, req.parent!.email);
    res.json({ ok: true });
  }),
);

router.post(
  '/classes/:id/invite',
  asyncHandler(async (req, res) => {
    const ev = await loadTeacherEvent(req);
    requireOpen(ev);
    if (!ev.registration!.teacher_enters_emails) {
      throw new ApiError(
        403,
        'Für diese Klasse erfassen die Eltern ihre E-Mail-Adresse selbst über den Klassenlink.',
      );
    }
    const { entries } = parse(
      z.object({
        entries: z
          .array(
            z.object({
              childName: z.string().max(200),
              emails: z.array(z.string().max(254)).max(6),
              parentName: z.string().max(200).default(''),
            }),
          )
          .min(1)
          .max(200),
      }),
      req.body ?? {},
    );
    const result = await inviteParents(ev, entries, 'teacher', req.parent!.email);
    res.json({ ...result, devLogOnly: config.mail.devLogOnly });
  }),
);

router.post(
  '/classes/:id/remind',
  asyncHandler(async (req, res) => {
    const ev = await loadTeacherEvent(req);
    const result = await remindPendingConsents(ev, {
      actor: req.parent!.email,
      auto: false,
      throttleMs: TEACHER_REMIND_THROTTLE_MS,
    });
    res.json({ ...result, devLogOnly: config.mail.devLogOnly });
  }),
);

router.post(
  '/classes/:id/link/rotate',
  asyncHandler(async (req, res) => {
    const ev = await loadTeacherEvent(req);
    requireOpen(ev);
    if (!ev.registration!.parent_link_enabled) {
      throw new ApiError(403, 'Für diese Klasse ist kein Klassenlink vorgesehen.');
    }
    const token = await rotateParentLink(ev, req.parent!.email);
    const url = parentLinkUrl(token);
    res.json({ url, qrSvg: await qrCodeSvg(url), shareText: parentShareText(ev, url) });
  }),
);

router.post(
  '/classes/:id/complete',
  asyncHandler(async (req, res) => {
    const ev = await loadTeacherEvent(req);
    requireOpen(ev);
    await markTeacherCompleted(ev, req.parent!.email);
    res.json({ ok: true });
  }),
);

export default router;
