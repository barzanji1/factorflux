import { apiRequest } from "@/lib/queryClient";

export async function confirmationRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await apiRequest(method, path, body);
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error(`Broker confirmation API unavailable: ${method} ${path} did not return JSON.`);
  }
  return response.json();
}
