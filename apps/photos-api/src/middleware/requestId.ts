import { randomUUID } from "node:crypto";
import { NextFunction, Request, Response } from "express";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export type RequestWithId = Request & {
  requestId?: string;
};

export function getRequestId(req: Request) {
  return (req as RequestWithId).requestId || "";
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header("x-request-id") || "";
  const requestId = REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();

  (req as RequestWithId).requestId = requestId;
  res.setHeader("X-Request-ID", requestId);
  next();
}
