import { z } from "zod";

export const DEFAULT_EMAIL_FROM_ADDRESS = "notifications@truckingprosfinancial.com";
export const DEFAULT_EMAIL_REPLY_TO = "dosh@truckingprosfinancial.com";

/** Shared by the server and standalone mail scripts; never reads credentials. */
export function resolveEmailConfig(env = {}) {
  const fromAddress = z.string().trim().email().parse(env.EMAIL_FROM ?? DEFAULT_EMAIL_FROM_ADDRESS);
  const replyTo = z.string().trim().email().parse(env.EMAIL_REPLY_TO ?? DEFAULT_EMAIL_REPLY_TO);
  return {
    fromAddress,
    from: `TruckingPros Financial <${fromAddress}>`,
    replyTo,
  };
}
