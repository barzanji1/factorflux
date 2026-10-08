export const DEFAULT_EMAIL_FROM_ADDRESS: string;
export const DEFAULT_EMAIL_REPLY_TO: string;
export function resolveEmailConfig(env?: { EMAIL_FROM?: string; EMAIL_REPLY_TO?: string }): {
  fromAddress: string;
  from: string;
  replyTo: string;
};
