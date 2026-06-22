export type UserRole = "admin" | "guardian";
export type OrganizationType = "school" | "kindergarten";
export type PhotoType = "portrait" | "sibling" | "class" | "classMirror" | "event";
export type PhotoVisibility = "child" | "class" | "job";

export type ApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export type MeResponse = {
  uid: string;
  email: string;
  role: UserRole;
  emailVerified: boolean;
};

export type Organization = {
  id: string;
  name: string;
  type: OrganizationType;
};

export type Job = {
  id: string;
  orgId: string;
  title: string;
  date: string;
  status: string;
  retentionUntil?: string | null;
};

export type SchoolClass = {
  id: string;
  orgId: string;
  jobId: string;
  name: string;
  teacherName?: string;
};

export type Child = {
  id: string;
  orgId: string;
  jobId: string;
  classId: string;
  displayName: string;
  pseudonym?: string;
};

export type GuardianLink = {
  id: string;
  email: string;
  emailLower: string;
  orgId: string;
  jobId: string;
  classId: string;
  childId: string;
  revokedAt: string | null;
};

export type Photo = {
  id: string;
  photoId?: string;
  orgId: string;
  jobId: string;
  classId: string;
  childIds: string[];
  type: PhotoType;
  visibility: PhotoVisibility;
  originalFilename?: string;
  originalMimeType?: string;
  originalSize?: number;
  createdAt?: string;
  updatedAt?: string;
  storageStatus?: {
    original: boolean;
    preview: boolean;
    thumb: boolean;
    complete: boolean;
  };
  metadataStatus?: {
    organization: boolean;
    job: boolean;
    class: boolean;
    childReferences: boolean;
    complete: boolean;
  };
  displayable?: boolean;
};

export type AdminData = {
  organizations: Organization[];
  jobs: Job[];
  classes: SchoolClass[];
  children: Child[];
  guardianLinks: GuardianLink[];
  photos: Photo[];
};

export type GalleryPhoto = {
  photoId: string;
  jobId: string;
  classId: string;
  childNames: string[];
  type: PhotoType;
  visibility: PhotoVisibility;
  hasThumb: boolean;
  hasPreview: boolean;
};

export type GalleryResponse = {
  photos: GalleryPhoto[];
  message?: string;
};

export type CartItem = {
  photoId: string;
  jobId: string;
  type: PhotoType;
  quantity: number;
};
