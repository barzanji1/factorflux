import { firestore as db } from "../firebase";

async function deleteActivitySubcollection(
  clientIdStr: string
): Promise<number> {
  if (!db) return 0;

  const activityRefs = await db
    .collection("clients")
    .doc(clientIdStr)
    .collection("activity")
    .listDocuments();

  if (activityRefs.length === 0) return 0;

  const batch = db.batch();
  activityRefs.forEach((ref) => batch.delete(ref));
  await batch.commit();

  console.log(
    `[FIRESTORE DELETE] removed ${activityRefs.length} activity sub-doc(s) for clientId=${clientIdStr}`
  );
  return activityRefs.length;
}

export async function deleteClientMirror(clientId: number) {
  if (!db) {
    console.warn("[Firestore] deleteClientMirror skipped — Firestore not initialized.");
    return { deleted: false, method: "firestore_disabled", count: 0 };
  }

  const clientIdStr = String(clientId);

  try {
    console.log(`[FIRESTORE DELETE] starting delete for clientId=${clientIdStr}`);

    // 1. Try direct document ID lookup
    const directRef = db.collection("clients").doc(clientIdStr);
    const directSnap = await directRef.get();

    if (directSnap.exists) {
      await deleteActivitySubcollection(clientIdStr);
      await directRef.delete();
      console.log(`[FIRESTORE DELETE] deleted by doc id: ${clientIdStr}`);
      return { deleted: true, method: "docId", count: 1 };
    }

    console.log(
      `[FIRESTORE DELETE] doc not found at id=${clientIdStr}, running fallback field queries in parallel`
    );

    // 2. Fallback: run both string and numeric field queries in parallel
    const [stringSnap, numericSnap] = await Promise.all([
      db.collection("clients").where("id", "==", clientIdStr).get(),
      db.collection("clients").where("id", "==", clientId).get(),
    ]);

    const allDocs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    [...stringSnap.docs, ...numericSnap.docs].forEach((doc) =>
      allDocs.set(doc.id, doc)
    );

    if (allDocs.size > 0) {
      await Promise.all(
        Array.from(allDocs.keys()).map((docId) =>
          deleteActivitySubcollection(docId)
        )
      );

      const batch = db.batch();
      allDocs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();

      console.log(
        `[FIRESTORE DELETE] fallback query deleted ${allDocs.size} doc(s) for clientId=${clientIdStr} ` +
          `(string matches: ${stringSnap.size}, numeric matches: ${numericSnap.size})`
      );
      return { deleted: true, method: "query_fallback", count: allDocs.size };
    }

    console.log(
      `[FIRESTORE DELETE] no Firestore document found for clientId=${clientIdStr} — nothing deleted`
    );
    return { deleted: false, method: "not_found", count: 0 };
  } catch (error) {
    console.error(
      `[FIRESTORE DELETE] failed for clientId=${clientIdStr}:`,
      error
    );
    throw error;
  }
}
