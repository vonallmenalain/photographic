import { PhotoRecord } from "../types/domain";
import { getPhotoStorageStatus, PhotoStorageStatus } from "./storage";

type RecordWithId = {
  id?: string;
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
};

export function buildPhotoReferenceSets({
  organizations,
  jobs,
  classes,
  children
}: {
  organizations: RecordWithId[];
  jobs: RecordWithId[];
  classes: RecordWithId[];
  children: RecordWithId[];
}): PhotoReferenceSets {
  return {
    organizationIds: new Set(organizations.map((item) => item.id).filter(Boolean) as string[]),
    jobIds: new Set(jobs.map((item) => item.id).filter(Boolean) as string[]),
    classIds: new Set(classes.map((item) => item.id).filter(Boolean) as string[]),
    childIds: new Set(children.map((item) => item.id).filter(Boolean) as string[])
  };
}

export function getPhotoMetadataStatus(
  photo: PhotoRecord,
  references: PhotoReferenceSets
): PhotoMetadataStatus {
  const organization = references.organizationIds.has(photo.orgId);
  const job = references.jobIds.has(photo.jobId);
  const schoolClass = references.classIds.has(photo.classId);
  const childReferences =
    photo.visibility !== "child" ||
    photo.childIds.length === 0 ||
    photo.childIds.some((childId) => references.childIds.has(childId));

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
    displayable: storage.complete && metadata.complete
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
