import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { brokers, brokerBranches, insertBrokerBranchSchema } from "../../shared/schema";

const createSchema = insertBrokerBranchSchema.extend({
  brokerId: z.coerce.number().int().positive(),
  status: z.literal("active").default("active"),
});

const defaultStore = {
  async broker(id: number) {
    const [broker] = await db.select({ id: brokers.id, status: brokers.status })
      .from(brokers).where(eq(brokers.id, id)).limit(1);
    return broker;
  },
  async create(input: z.infer<typeof createSchema>) {
    const [branch] = await db.insert(brokerBranches).values(input).returning();
    return branch;
  },
};

export function registerInvoiceBranchRoutes(
  app: Express,
  requireAuth: RequestHandler,
  canAccessBroker: (req: any, brokerId: number) => Promise<boolean>,
  store = defaultStore,
) {
  // The central API boundary requires invoices permission. This separate route
  // does not broaden the manager-only broker-profile edit/delete endpoints.
  app.post("/api/invoices/broker-branches", requireAuth, async (req, res) => {
    try {
      const input = createSchema.parse(req.body);
      if (!(await canAccessBroker(req, input.brokerId))) {
        return void res.status(403).json({ message: "You may only add branches for brokers assigned to you" });
      }
      const broker = await store.broker(input.brokerId);
      if (!broker) return void res.status(404).json({ message: "Broker not found" });
      if (broker.status !== "active") return void res.status(400).json({ message: "Broker is not active" });
      res.status(201).json(await store.create(input));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return void res.status(400).json({ message: "Invalid branch data", errors: error.errors });
      }
      console.error("[invoice-branch] Create failed", error instanceof Error ? error.name : "UnknownError");
      res.status(500).json({ message: "Failed to create broker branch" });
    }
  });
}
