import { NextFunction, Request, Response } from "express";

export class AppError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}

export function sendOk<T>(res: Response, data: T, status = 200) {
  return res.status(status).json({ ok: true, data });
}

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

export function routeParam(req: Request, name: string) {
  const value = req.params[name];
  const singleValue = Array.isArray(value) ? value[0] : value;

  if (!singleValue) {
    throw new AppError(400, "INVALID_ROUTE_PARAM", "Der Routenparameter ist ungueltig.");
  }

  return singleValue;
}
