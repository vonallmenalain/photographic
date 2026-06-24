import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import fs from 'fs';
import { config } from './config';
import { migrate } from './db/migrate';
import { archiveExpiredEvents } from './services/events';
import { checkWatermarkRendering } from './lib/images';
import { errorHandler, notFound } from './middleware/errorHandler';
import parentRoutes from './routes/parent';
import adminRoutes from './routes/admin';
import filesRoutes from './routes/files';
import webhookRoutes from './routes/webhook';

function buildApp() {
  const app = express();
  app.set('trust proxy', 1);

  // CORS: allow the configured public app (Netlify) + extra origins, with credentials.
  const allowed = new Set<string>([config.publicAppUrl, ...config.extraCorsOrigins]);
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin) return cb(null, true); // same-origin / curl / mobile
        if (allowed.has(origin)) return cb(null, true);
        return cb(new Error('Not allowed by CORS'));
      },
      credentials: true,
    }),
  );

  // Stripe webhook needs the raw body, so mount it BEFORE json parser.
  app.use('/webhook', webhookRoutes);

  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  app.get('/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  app.use('/api/parent', parentRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/files', filesRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

async function main() {
  // Ensure storage directories exist on the (QNAP) volume.
  fs.mkdirSync(config.storageDir, { recursive: true });
  await migrate();

  // Auto-archive expired galleries: once on startup and then periodically.
  const runArchiveSweep = () =>
    archiveExpiredEvents().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[archive] sweep failed', err);
    });
  await runArchiveSweep();
  setInterval(runArchiveSweep, 6 * 60 * 60 * 1000).unref();

  const watermarkOk = await checkWatermarkRendering();

  const app = buildApp();
  app.listen(config.port, () => {
    const emulator = config.firebase.firestoreEmulatorHost || config.firebase.authEmulatorHost;
    // eslint-disable-next-line no-console
    console.log(`[server] listening on :${config.port} (env=${config.env})`);
    console.log(`[server] storage dir: ${config.storageDir}`);
    console.log(`[server] public app : ${config.publicAppUrl}`);
    console.log(`[server] firestore   : project ${config.firebase.projectId}${emulator ? ' (EMULATOR)' : ''}`);
    console.log(`[server] parent auth : ${config.firebase.parentAuthEnabled ? 'Firebase + code fallback' : 'code only'}`);
    console.log(`[server] stripe      : ${config.stripe.enabled ? 'enabled' : 'manual/test mode'}`);
    console.log(`[server] mail        : ${config.mail.devLogOnly ? 'DEV LOG ONLY' : config.mail.host}`);
    console.log(`[server] watermark   : ${watermarkOk ? 'OK (fonts available)' : 'BROKEN — no fonts, previews NOT watermarked!'}`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[server] failed to start', err);
  process.exit(1);
});
