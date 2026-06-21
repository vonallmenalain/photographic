import type { HandlerEvent, HandlerResponse } from "@netlify/functions";
import { ZodError } from "zod";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

export class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

export function json(statusCode: number, body: unknown): HandlerResponse {
  return {
    statusCode,
    headers,
    body: JSON.stringify(body)
  };
}

export function empty(statusCode = 204): HandlerResponse {
  return {
    statusCode,
    headers,
    body: ""
  };
}

export function ensurePost(event: HandlerEvent): HandlerResponse | null {
  if (event.httpMethod === "OPTIONS") {
    return empty();
  }

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Methode nicht erlaubt." });
  }

  return null;
}

export function parseBody(event: HandlerEvent): unknown {
  if (!event.body) {
    throw new HttpError(400, "Die Anfrage ist leer.");
  }

  try {
    return JSON.parse(event.body);
  } catch {
    throw new HttpError(400, "Die Anfrage ist ungültig.");
  }
}

export function handleError(error: unknown): HandlerResponse {
  if (error instanceof HttpError) {
    return json(error.statusCode, { error: error.message });
  }

  if (error instanceof ZodError) {
    return json(400, { error: "Die Eingaben sind ungültig." });
  }

  console.error(error);
  return json(500, { error: "Die Anfrage konnte nicht verarbeitet werden." });
}
