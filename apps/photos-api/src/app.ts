import cors from "cors";
import express from "express";
import { Request } from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env";
import { requireAuth } from "./middleware/requireAuth";
import { requireAdmin } from "./middleware/requireAdmin";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { getRequestId, requestIdMiddleware } from "./middleware/requestId";
import { AppError } from "./lib/response";
import { adminRouter } from "./routes/admin";
import { galleryRouter } from "./routes/gallery";
import { healthRouter } from "./routes/health";
import { meRouter } from "./routes/me";
import { ordersRouter } from "./routes/orders";
import { photosRouter } from "./routes/photos";

export function createApp() {
  const app = express();
  const allowedOrigins = new Set(env.CORS_ORIGINS);

  app.disable("x-powered-by");
  app.use(requestIdMiddleware);
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "same-site" }
    })
  );
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) {
          callback(null, true);
          return;
        }
        callback(
          new AppError(403, "CORS_BLOCKED", "Diese Herkunft ist fuer die API nicht freigegeben.")
        );
      },
      exposedHeaders: ["X-Request-ID"]
    })
  );
  morgan.token("request-id", (req: Request) => getRequestId(req) || "-");
  app.use(morgan(":method :url :status :res[content-length] - :response-time ms :request-id"));
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false }));

  app.use("/api/health", healthRouter);
  app.use("/api/me", requireAuth, meRouter);
  app.use("/api/admin", requireAuth, requireAdmin, adminRouter);
  app.use("/api/gallery", requireAuth, galleryRouter);
  app.use("/api/photos", requireAuth, photosRouter);
  app.use("/api/orders", requireAuth, ordersRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
