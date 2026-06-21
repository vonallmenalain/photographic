type FunctionPayload = Record<string, unknown>;

export class FunctionCallError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "FunctionCallError";
    this.status = status;
  }
}

export async function callFunction<T>(
  name: string,
  payload: FunctionPayload,
  idToken?: string
): Promise<T> {
  const response = await fetch(`/.netlify/functions/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {})
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new FunctionCallError(data.error ?? "Die Anfrage ist fehlgeschlagen.", response.status);
  }

  return data as T;
}

export interface RedeemAccessCodeResponse {
  jobId: string;
}

export interface UploadUrlResponse {
  uploadUrl: string;
  key: string;
  expiresIn: number;
}

export interface PreviewUrlResponse {
  url: string;
  expiresIn: number;
}

export interface GeneratedAccessCode {
  accessCodeId: string;
  childId: string;
  classId: string;
  pseudonym: string;
  code: string;
  qrPayload: string;
  expiresAt: string;
}

export interface GeneratedAccessCodesResponse {
  codes: GeneratedAccessCode[];
}
