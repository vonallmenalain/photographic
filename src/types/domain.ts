export type UserRole = "admin" | "guardian" | "teacher" | "school";
export type OrganizationType = "school" | "kindergarten";
export type JobStatus = "draft" | "review" | "published" | "archived";
export type ConsentStatus = "unknown" | "granted" | "denied";
export type PhotoType = "portrait" | "sibling" | "class" | "event";
export type PhotoVisibility = "child" | "class" | "job";
export type PhotoStatus = "hidden" | "review" | "published";
export type OrderStatus = "draft" | "pending" | "paid" | "fulfilled" | "cancelled";

export interface AppUser {
  email: string | null;
  role: UserRole;
  createdAt?: unknown;
  lastLoginAt?: unknown;
}

export interface Organization {
  id: string;
  name: string;
  type: OrganizationType;
  createdAt?: unknown;
}

export interface Job {
  id: string;
  orgId: string;
  title: string;
  date: string;
  status: JobStatus;
  retentionUntil: string;
  createdAt?: unknown;
}

export interface SchoolClass {
  id: string;
  orgId: string;
  jobId: string;
  name: string;
  teacherName: string;
}

export interface ChildRecord {
  id: string;
  orgId: string;
  jobId: string;
  classId: string;
  pseudonym: string;
  consentStatus: ConsentStatus;
  createdAt?: unknown;
}

export interface GuardianAccess {
  id: string;
  uid: string;
  orgId: string;
  jobId: string;
  classId: string;
  childId?: string;
  scope?: "child" | "class" | "job";
  source: "accessCode" | "admin";
  createdAt?: unknown;
  revokedAt: unknown | null;
}

export interface PhotoRecord {
  id: string;
  orgId: string;
  jobId: string;
  classId: string;
  childIds: string[];
  type: PhotoType;
  visibility: PhotoVisibility;
  status: PhotoStatus;
  originalKey?: string;
  previewKey?: string;
  thumbKey?: string;
  createdAt?: unknown;
}

export interface CartItem {
  photoId: string;
  product: "digital_preview" | "print_13x18";
  quantity: number;
  amount: number;
}

export interface Order {
  id: string;
  uid: string;
  jobId: string;
  status: OrderStatus;
  items: CartItem[];
  amount: number;
  currency: "CHF";
  createdAt?: unknown;
}
