export const SYSTEM_EMAIL_FROM: string;
export const SYSTEM_EMAIL_REPLY_TO: string;
export class ResendDeliveryError extends Error {
  statusCode: number;
  uncertain: boolean;
  constructor(statusCode: number, message: string, uncertain?: boolean);
}
export interface ResendEmailParams {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  idempotencyKey?: string;
  attachments?: Array<{
    content: string;
    filename: string;
    type?: string;
    disposition?: string;
    content_id?: string;
  }>;
}
export type ResendProxy = (connector: string, path: string, options: {
  method: string; headers: Record<string, string>; body: unknown;
}) => Promise<Response>;
export function createResendTransport(proxy?: ResendProxy, timeoutMs?: number):
  (params: ResendEmailParams) => Promise<string>;
export const sendResendEmail: (params: ResendEmailParams) => Promise<string>;
