import { firestore as db } from "../firebase";

export async function deleteClientMirror(clientId: number) {
  const clientIdStr = String(clientId);

  try {
    console.log(`[FIRESTORE DELETE] starting delete for clientId=${clientIdStr}`);

    const directRef = db.collection("clients").doc(clientIdStr);
    const directSnap = await directRef.get();

    if (directSnap.exists) {
      await directRef.delete();
      console.log(`[FIRESTORE DELETE] deleted by doc id: ${clientIdStr}`);
      return { deleted: true, method: "docId", count: 1 };
    }

    const stringMatchSnap = await db
      .collection("clients")
      .where("id", "==", clientIdStr)
      .get();

    if (!stringMatchSnap.empty) {
      const batch = db.batch();
      stringMatchSnap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();

      return {
        deleted: true,
        method: "query_string_id",
        count: stringMatchSnap.docs.length,
      };
    }

    const numberMatchSnap = await db
      .collection("clients")
      .where("id", "==", clientId)
      .get();

    if (!numberMatchSnap.empty) {
      const batch = db.batch();
      numberMatchSnap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();

      return {
        deleted: true,
        method: "query_numeric_id",
        count: numberMatchSnap.docs.length,
      };
    }

    return { deleted: false, method: "not_found", count: 0 };
  } catch (error) {
    console.error(`[FIRESTORE DELETE] failed for clientId=${clientIdStr}:`, error);
    throw error;
  }
}