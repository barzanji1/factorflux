import { firestore } from "../firebase";

export async function upsertClientMirror(client: {
  id: number | string;
  name: string;
  contactPerson?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  status?: string | null;
  createdAt?: string | Date | null;
}) {
  const clientId = String(client.id);
  const ref = firestore.collection("clients").doc(clientId);

  const payload = {
    id: clientId,
    name: client.name ?? "",
    contactPerson: client.contactPerson ?? "",
    email: client.email ?? "",
    phone: client.phone ?? "",
    address: client.address ?? "",
    status: client.status ?? "active",
    createdAt: client.createdAt
      ? new Date(client.createdAt).toISOString()
      : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await ref.set(payload, { merge: true });

  return payload;
}

export async function addClientActivityLog(
  clientId: number | string,
  entry: {
    type: string;
    message: string;
  }
) {
  const id = String(clientId);

  const ref = firestore
    .collection("clients")
    .doc(id)
    .collection("activity")
    .doc();

  const payload = {
    id: ref.id,
    type: entry.type,
    message: entry.message,
    createdAt: new Date().toISOString(),
  };

  await ref.set(payload);

  return payload;
}
