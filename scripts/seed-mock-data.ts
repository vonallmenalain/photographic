import { adminAuth, adminDb, FieldValue } from "../netlify/lib/firebaseAdmin";

const orgId = "demo-org";
const jobId = "demo-job-2026";
const classAId = "demo-class-a";
const classBId = "demo-class-b";

async function seed() {
  await adminDb.collection("organizations").doc(orgId).set(
    {
      name: "Demo Schule",
      type: "school",
      createdAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  await adminDb.collection("jobs").doc(jobId).set(
    {
      orgId,
      title: "Demo Fototag",
      date: "2026-05-15",
      status: "draft",
      retentionUntil: "2026-11-15",
      createdAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  await adminDb.collection("classes").doc(classAId).set(
    {
      orgId,
      jobId,
      name: "Klasse A",
      teacherName: "Lehrperson A"
    },
    { merge: true }
  );

  await adminDb.collection("classes").doc(classBId).set(
    {
      orgId,
      jobId,
      name: "Klasse B",
      teacherName: "Lehrperson B"
    },
    { merge: true }
  );

  const children = [
    ["demo-child-a-01", classAId, "Kind A-01"],
    ["demo-child-a-02", classAId, "Kind A-02"],
    ["demo-child-b-01", classBId, "Kind B-01"]
  ] as const;

  for (const [childId, classId, pseudonym] of children) {
    await adminDb.collection("children").doc(childId).set(
      {
        orgId,
        jobId,
        classId,
        pseudonym,
        consentStatus: "unknown",
        createdAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
  }

  const adminUid = process.env.SEED_ADMIN_UID;
  if (adminUid) {
    const user = await adminAuth.getUser(adminUid);
    await adminDb.collection("users").doc(adminUid).set(
      {
        email: user.email ?? null,
        role: "admin",
        createdAt: FieldValue.serverTimestamp(),
        lastLoginAt: FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    await adminAuth.setCustomUserClaims(adminUid, { admin: true });
  }

  console.log("Mock data seeded.");
}

seed().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
