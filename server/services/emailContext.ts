import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestHandler } from "express";

const actorContext = new AsyncLocalStorage<{ actor: () => string | null }>();
export const emailActorContext: RequestHandler = (req: any, _res, next) =>
  actorContext.run({ actor: () => req.user?.id ?? null }, next);
export function currentEmailActor(): string | null {
  return actorContext.getStore()?.actor() ?? null;
}
