import type { CollectionRunResult } from "@shared/broker-collections";
import { apiRequest, HttpError } from "./queryClient";

export class CollectionRunFailure extends Error {
  constructor(public readonly result: CollectionRunResult) {
    super(result.message);
    this.name = "CollectionRunFailure";
  }
}

export async function runBrokerCollections(): Promise<CollectionRunResult> {
  let result: CollectionRunResult;
  try {
    result = await (await apiRequest("POST", "/api/broker-collections/run", {})).json();
  } catch (error) {
    // apiRequest retains the JSON error body in HttpError.message. Preserve the
    // full batch result: some other invoices may already have sent successfully.
    if (error instanceof HttpError) {
      let body: CollectionRunResult | undefined;
      try { body = JSON.parse(error.message); } catch { /* Non-JSON server/network error. */ }
      if (body && body.failed > 0 && Array.isArray(body.errors)) throw new CollectionRunFailure(body);
    }
    throw error;
  }
  // Never show a success banner for a failure payload, even if a future server
  // accidentally labels the response HTTP 200.
  if (result.failed > 0 || result.status === "failed" || result.status === "partial_failure") throw new CollectionRunFailure(result);
  return result;
}
