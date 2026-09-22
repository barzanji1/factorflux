import type { RequestHandler } from "express";
import type { BrokerAuthorityCheck } from "@shared/schema";

type GetHistory = (
  entityType: "broker" | "debtor",
  entityId: number,
) => Promise<BrokerAuthorityCheck[]>;

export function createFmcsaHistoryHandler(getHistory: GetHistory): RequestHandler {
  return async (req, res) => {
    const entityId = Number(req.params.id);
    const entityType = req.query.entityType;

    if (!Number.isInteger(entityId) || entityId <= 0) {
      return res.status(400).json({ message: "A valid entity id is required" });
    }
    if (entityType !== "broker" && entityType !== "debtor") {
      return res.status(400).json({ message: "entityType must be broker or debtor" });
    }

    try {
      const checks = await getHistory(entityType, entityId);
      return res.json({ checks });
    } catch (error) {
      console.error("[FMCSA History] Failed:", error);
      return res.status(500).json({ message: "Failed to load FMCSA check history" });
    }
  };
}