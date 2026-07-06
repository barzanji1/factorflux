import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let firestore: Firestore | null = null;

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!raw) {
  console.warn("[Firebase] FIREBASE_SERVICE_ACCOUNT not set — Firestore features disabled.");
} else {
  try {
    const serviceAccount = JSON.parse(raw) as {
      project_id: string;
      client_email: string;
      private_key: string;
    };

    const app =
      getApps().length > 0
        ? getApps()[0]
        : initializeApp({
            credential: cert({
              projectId: serviceAccount.project_id,
              clientEmail: serviceAccount.client_email,
              privateKey: serviceAccount.private_key,
            }),
          });

    firestore = getFirestore(app);
    console.log("[Firebase] Firestore initialized successfully.");
  } catch (err: any) {
    console.warn("[Firebase] Failed to initialize Firestore:", err?.message ?? err, "— Firestore features disabled.");
  }
}

export { firestore };
