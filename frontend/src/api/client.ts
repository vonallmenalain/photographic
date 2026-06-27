export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '');

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /**
   * Marks a request as belonging to the admin area. Admin authentication is
   * carried solely by the httpOnly `admin_token` cookie (set on login and sent
   * automatically via `credentials: 'include'`). The token is intentionally NOT
   * stored in localStorage anymore, so it cannot be stolen via XSS. This flag is
   * kept for readability/back-compat at the call sites and currently has no
   * additional effect.
   */
  admin?: boolean;
  formData?: FormData;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    credentials: 'include',
    headers,
  };

  if (opts.formData) {
    init.body = opts.formData;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }

  const res = await fetch(`${API_BASE}${path}`, init);
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json().catch(() => ({})) : await res.text();

  if (!res.ok) {
    const message = (isJson && (data as { error?: string }).error) || 'Es ist ein Fehler aufgetreten.';
    throw new ApiError(res.status, message);
  }
  return data as T;
}

/**
 * Fetches an admin-protected image and returns an object URL. Authentication is
 * carried by the httpOnly `admin_token` cookie (`credentials: 'include'`).
 */
export async function fetchAdminImage(path: string): Promise<string> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
  });
  if (!res.ok) throw new ApiError(res.status, 'Bild konnte nicht geladen werden.');
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/** Builds an absolute URL for a token-protected (parent) image. */
export function imageUrl(path: string): string {
  return `${API_BASE}${path}`;
}
