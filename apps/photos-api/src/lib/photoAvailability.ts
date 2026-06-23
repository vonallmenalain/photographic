import { PhotoRecord } from "../types/domain";
import { getPhotoStorageStatus, PhotoStorageStatus } from "./storage";

type RecordWithId = {
  id?: string;
};

type JobReference = RecordWithId & {
  orgId?: unknown;
};

type ClassReference = RecordWithId & {
  orgId?: unknown;
  jobId?: unknown;
};

type ChildReference = RecordWithId & {
  orgId?: unknown;
  jobId?: unknown;
  classId?: unknown;
};

export type PhotoMetadataStatus = {
  organization: boolean;
  job: boolean;
  class: boolean;
  childReferences: boolean;
  complete: boolean;
};

export type PhotoAvailability = {
  storage: PhotoStorageStatus;
  metadata: PhotoMetadataStatus;
  displayable: boolean;
};

export type PhotoReferenceSets = {
  organizationIds: Set<string>;
  jobIds: Set<string>;
  classIds: Set<string>;
  childIds: Set<string>;
  jobsById: Map<string, JobReference>;
  classesById: Map<string, ClassReference>;
  childrenById: Map<string, ChildReference>;
};

export function buildPhotoReferenceSets({
  organizations,
  jobs,
  classes,
  children
}: {
  organizations: RecordWithId[];
  jobs: JobReference[];
  classes: ClassReference[];
  children: ChildReference[];
}): PhotoReferenceSets {
  const jobsById = new Map(
    jobs.filter((item) => item.id).map((item) => [item.id as string, item])
  );
  const classesById = new Map(
    classes.filter((item) => item.id).map((item) => [item.id as string, item])
  );
  const childrenById = new Map(
    children.filter((item) => item.id).map((item) => [item.id as string, item])
  );

  return {
    organizationIds: new Set(organizations.map((item) => item.id).filter(Boolean) as string[]),
    jobIds: new Set(jobsById.keys()),
    classIds: new Set(classesById.keys()),
    childIds: new Set(childrenById.keys()),
    jobsById,
    classesById,
    childrenById
  };
}

export function getPhotoMetadataStatus(
  photo: PhotoRecord,
  references: PhotoReferenceSets
): PhotoMetadataStatus {
  const organization = references.organizationIds.has(photo.orgId);
  const jobRecord = references.jobsById.get(photo.jobId);
  const classRecord = references.classesById.get(photo.classId);
  const childIds = Array.isArray(photo.childIds) ? photo.childIds : [];
  const job = Boolean(jobRecord && jobRecord.orgId === photo.orgId);
  const schoolClass = Boolean(
    classRecord && classRecord.orgId === photo.orgId && classRecord.jobId === photo.jobId
  );
  const allChildReferencesConsistent = childIds.every((childId) => {
    const child = references.childrenById.get(childId);
    return (
      child &&
      child.orgId === photo.orgId &&
      child.jobId === photo.jobId &&
      child.classId === photo.classId
    );
  });
  const childReferences =
    photo.visibility === "child"
      ? childIds.length > 0 && allChildReferencesConsistent
      : allChildReferencesConsistent;

  return {
    organization,
    job,
    class: schoolClass,
    childReferences,
    complete: organization && job && schoolClass && childReferences
  };
}

export async function getPhotoAvailability(
  photo: PhotoRecord,
  references: PhotoReferenceSets
): Promise<PhotoAvailability> {
  const [storage, metadata] = await Promise.all([
    getPhotoStorageStatus(photo),
    Promise.resolve(getPhotoMetadataStatus(photo, references))
  ]);

  return {
    storage,
    metadata,
    displayable: storage.complete && metadata.complete && photo.processingStatus !== "error"
  };
}

export async function filterDisplayablePhotos<T extends PhotoRecord>(
  photos: T[],
  references: PhotoReferenceSets
) {
  const availability = await Promise.all(
    photos.map((photo) => getPhotoAvailability(photo, references))
  );

  return photos.filter((_, index) => availability[index].displayable);
}
