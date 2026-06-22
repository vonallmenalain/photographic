export type UserRole = "admin" | "guardian";
export type OrganizationType = "school" | "kindergarten";
export type PhotoType = "portrait" | "sibling" | "class" | "classMirror" | "event";
export type PhotoVisibility = "child" | "class" | "job";
export type PhotoStatus = "hidden" | "review" | "published";
export type ConsentStatus = "unknown" | "granted" | "denied";

export type UserRecord = {
  uid: string;
  email: string;
  emailLower: string;
  role: UserRole;
  createdAt?: unknown;
  updatedAt?: unknown;
  lastLoginAt?: unknown;
};

export type GuardianLinkRecord = {
  id?: string;
  email: string;
  emailLower: string;
  orgId: string;
  jobId: string;
  classId: string;
  childId: string;
  revokedAt: unknown | null;
};

export type PhotoRecord = {
  id?: string;
  orgId: string;
  jobId: string;
  classId: string;
  childIds: string[];
  type: PhotoType;
  visibility: PhotoVisibility;
  status: PhotoStatus;
  originalPath: string;
  previewPath: string;
  thumbPath: string;
  originalFilename: string;
  originalMimeType: string;
  originalSize: number;
  createdAt?: unknown;
  createdByUid: string;
  updatedAt?: unknown;
};

export type OrderItem = {
  photoId: string;
  quantity: number;
  productType?: string;
};
