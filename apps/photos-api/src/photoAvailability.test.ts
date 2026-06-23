import assert from "node:assert/strict";
import test from "node:test";
import { buildPhotoReferenceSets, getPhotoMetadataStatus } from "./lib/photoAvailability";
import { PhotoRecord } from "./types/domain";

const references = buildPhotoReferenceSets({
  organizations: [{ id: "org1" }],
  jobs: [{ id: "job1", orgId: "org1" }],
  classes: [{ id: "class1", orgId: "org1", jobId: "job1" }],
  children: [
    { id: "child1", orgId: "org1", jobId: "job1", classId: "class1" },
    { id: "child2", orgId: "org1", jobId: "job1", classId: "class1" }
  ]
});

function photo(overrides: Partial<PhotoRecord> = {}): PhotoRecord {
  return {
    orgId: "org1",
    jobId: "job1",
    classId: "class1",
    childIds: ["child1"],
    type: "portrait",
    visibility: "child",
    originalPath: "original.jpg",
    previewPath: "preview.webp",
    thumbPath: "thumb.webp",
    originalFilename: "original.jpg",
    originalMimeType: "image/jpeg",
    originalSize: 100,
    createdByUid: "admin",
    ...overrides
  };
}

test("child visibility requires at least one valid child", () => {
  assert.equal(getPhotoMetadataStatus(photo({ childIds: [] }), references).complete, false);
  assert.equal(getPhotoMetadataStatus(photo({ childIds: ["child1", "child2"] }), references).complete, true);
});

test("all child references must exist and match org/job/class", () => {
  assert.equal(getPhotoMetadataStatus(photo({ childIds: ["child1", "missing"] }), references).complete, false);
  assert.equal(getPhotoMetadataStatus(photo({ classId: "other-class", childIds: ["child1"] }), references).complete, false);
});

test("class and job references must belong to the selected organization", () => {
  assert.equal(getPhotoMetadataStatus(photo({ jobId: "missing-job" }), references).job, false);
  assert.equal(getPhotoMetadataStatus(photo({ classId: "missing-class" }), references).class, false);
});
