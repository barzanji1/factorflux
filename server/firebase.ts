import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;

if (!raw) {
  throw new Error("Missing FIREBASE_SERVICE_ACCOUNT");
}

let serviceAccount: {
  project_id: string;
  client_email: string;
  private_key: string;
};

try {
  serviceAccount = JSON.parse(raw);
} catch (error) {
  throw new Error("FIREBASE_SERVICE_ACCOUNT is not valid JSON");
}

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

export const firestore = getFirestore(app);