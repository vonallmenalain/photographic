import { NextFunction, Request, Response } from 'express';
import { config } from '../config';

export class ApiError extends Error {
  status: number;
  publicMessage: string;
  constructor(status: number, publicMessage: string, internal?: string) {
    super(internal ?? publicMessage);
    this.status = status;
    this.publicMessage = publicMessage;
  }
}

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: 'Nicht gefunden.' });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.publicMessage });
    return;
  }
  // Never leak internal details to clients (no technical errors for parents).
  // eslint-disable-next-line no-console
  console.error('[error]', err);
  res.status(500).json({
    error: 'Es ist ein unerwarteter Fehler aufgetreten. Bitte versuche es später erneut.',
  });
  if (!config.isProd && err instanceof Error) {
    // help local debugging
    // eslint-disable-next-line no-console
    console.error(err.stack);
  }
}

/** Wraps async route handlers so thrown errors reach the error middleware. */
export function asyncHandler<T extends Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as T, res, next)).catch(next);
  };
}
