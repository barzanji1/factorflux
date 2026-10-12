export const SYSTEM_EMAIL_FROM: string;
export const SYSTEM_EMAIL_REPLY_TO: string;
export class ResendDeliveryError extends Error {
  statusCode: number;
  uncertain: boolean;
  constructor(statusCode: number, message: string, uncertain?: boolean);
}
export interface ResendEmailParams {
  to: string | string[];
  cc?: string[];
  subject: string;
  text?: string;
  html?: string;
  idempotencyKey?: string;
  emailLog?: {
    sentByUserId?: string | null;
    templateName?: string;
    entityType?: "invoice" | "carrier" | "broker" | "chargeback" | "followup";
    entityId?: string | number;
    retryOfId?: number;
    confirmationReminder?: number | null;
    followupReminderId?: number;
    followupImmediate?: boolean;
  };
  attachments?: Array<{
    content: string;
    filename: string;
    type?: string;
    disposition?: string;
    content_id?: string;
    s3Key?: string;
  }>;
}
export type ResendProxy = (connector: string, path: string, options: {
  method: string; headers: Record<string, string>; body: unknown;
}) => Promise<Response>;
export interface EmailLogRecorder {
  begin(params: ResendEmailParams, body: { from: string; reply_to: string; to: string[]; cc?: string[]; tags: { name: string; value: string }[] }, key: string): Promise<number>;
  previousAcceptance?(key: string, correlationKey: string): Promise<string | null>;
  accepted(id: number, messageId: string): Promise<void>;
  failed(id: number, error: { message: string; uncertain: boolean }): Promise<void>;
}
export function createResendTransport(proxy?: ResendProxy, timeoutMs?: number, recorder?: EmailLogRecorder):
  (params: ResendEmailParams) => Promise<string>;
export const sendResendEmail: (params: ResendEmailParams) => Promise<string>;
