export type UserRole = "admin" | "guardian";
export type OrganizationType = "school" | "kindergarten";
export type PhotoType = "portrait" | "sibling" | "class" | "classMirror" | "event";
export type PhotoVisibility = "child" | "class" | "job";
export type PhotoProcessingStatus = "ready" | "error";

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

export type ChildRecord = {
  id?: string;
  orgId: string;
  jobId: string;
  classId: string;
  displayName: string;
  pseudonym?: string;
};

export type PhotoRecord = {
  id?: string;
  photoId?: string;
  albumId?: string;
  schoolId?: string;
  orgId: string;
  jobId: string;
  classId: string;
  childIds: string[];
  type: PhotoType;
  visibility: PhotoVisibility;
  originalPath: string;
  previewPath?: string | null;
  thumbPath?: string | null;
  originalFilename: string;
  originalMimeType: string;
  originalSize: number;
  width?: number;
  height?: number;
  fileSizeOriginal?: number;
  fileSizePreview?: number;
  fileSizeThumb?: number;
  processingStatus?: PhotoProcessingStatus;
  processingError?: string | null;
  checksumSha256?: string;
  uploadedAt?: unknown;
  createdAt?: unknown;
  createdByUid: string;
  updatedAt?: unknown;
};

export type OrderItem = {
  photoId: string;
  quantity: number;
  productType?: string;
};

export type OrderRecord = {
  id?: string;
  uid: string;
  emailLower: string;
  jobId: string;
  status: "pending" | "paid" | "completed" | "fulfilled" | "cancelled" | "refunded";
  items: OrderItem[];
};
