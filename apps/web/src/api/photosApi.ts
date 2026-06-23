import { ApiEnvelope } from "../types/domain";

export type TokenProvider = () => Promise<string>;

const API_BASE_URL = (
  import.meta.env.VITE_PHOTOS_API_BASE_URL || "http://localhost:8787"
).replace(/\/$/, "");

export class ApiError extends Error {
  code: string;
  status: number;
  requestId?: string;
  userMessage: string;

  constructor(message: string, code: string, status: number, requestId?: string) {
    const details = [`Code: ${code}`];
    if (requestId) {
      details.push(`Request-ID: ${requestId}`);
    }

    super(`${message} (${details.join(", ")})`);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.userMessage = message;
  }
}

function buildUrl(path: string) {
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

async function authHeaders(getIdToken?: TokenProvider): Promise<Record<string, string>> {
  if (!getIdToken) {
    return {};
  }
  const token = await getIdToken();
  return { Authorization: `Bearer ${token}` };
}

async function readApiEnvelope<T>(response: Response): Promise<ApiEnvelope<T> | null> {
  const text = await response.text().catch(() => "");
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    return null;
  }
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = await readApiEnvelope<T>(response);

  if (!response.ok || !payload?.ok) {
    const requestId =
      response.headers.get("x-request-id") ||
      (payload && !payload.ok ? payload.error.requestId : undefined);
    const message =
      payload && !payload.ok
        ? payload.error.message
        : "Die Anfrage konnte nicht verarbeitet werden.";
    const code = payload && !payload.ok ? payload.error.code : "HTTP_ERROR";
    throw new ApiError(message, code, response.status, requestId || undefined);
  }

  return payload.data;
}

async function requestJson<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  getIdToken?: TokenProvider,
  body?: unknown
) {
  const headers: HeadersInit = {
    Accept: "application/json",
    ...(await authHeaders(getIdToken))
  };

  const response = await fetch(buildUrl(path), {
    method,
    headers: body === undefined ? headers : { ...headers, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  return parseJsonResponse<T>(response);
}

export function apiGet<T>(path: string, getIdToken?: TokenProvider) {
  return requestJson<T>("GET", path, getIdToken);
}

export function apiPost<T>(path: string, body: unknown, getIdToken?: TokenProvider) {
  return requestJson<T>("POST", path, getIdToken, body);
}

export function apiPatch<T>(path: string, body: unknown, getIdToken?: TokenProvider) {
  return requestJson<T>("PATCH", path, getIdToken, body);
}

export function apiDelete<T>(path: string, getIdToken?: TokenProvider) {
  return requestJson<T>("DELETE", path, getIdToken);
}

export async function apiUploadFormData<T>(
  path: string,
  formData: FormData,
  getIdToken: TokenProvider
) {
  const response = await fetch(buildUrl(path), {
    method: "POST",
    headers: {
      Accept: "application/json",
      ...(await authHeaders(getIdToken))
    },
    body: formData
  });

  return parseJsonResponse<T>(response);
}

export async function fetchAuthorizedBlob(path: string, getIdToken: TokenProvider) {
  const response = await fetch(buildUrl(path), {
    headers: {
      ...(await authHeaders(getIdToken))
    }
  });

  if (!response.ok) {
    const payload = await readApiEnvelope<unknown>(response);
    const requestId =
      response.headers.get("x-request-id") ||
      (payload && !payload.ok ? payload.error.requestId : undefined);
    const message =
      payload && !payload.ok
        ? payload.error.message
        : "Das geschuetzte Bild konnte nicht geladen werden.";
    const code = payload && !payload.ok ? payload.error.code : "IMAGE_FETCH_FAILED";
    throw new ApiError(message, code, response.status, requestId || undefined);
  }

  return response.blob();
}
