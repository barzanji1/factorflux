import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Express, RequestHandler } from "express";
import { and, asc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db as applicationDb } from "../db";
import { brokerConfirmationSettings, brokers, invoices, tasks, users } from "../../shared/schema";
import {
  brokerConfirmationService as brokerService, ConfirmationError, escapeConfirmationHtml as escape,
  getConfirmationAgingRows, getConfirmationInvoiceScope,
  type ConfirmationStore,
} from "../services/brokerConfirmationService";
import { SYSTEM_EMAIL_REPLY_TO } from "../resendTransport.js";

type Dependencies = {
  requireAuth: RequestHandler;
  requireManagerOrAdmin: RequestHandler;
  canAccessInvoice: (req: any, invoiceId: number) => Promise<boolean>;
  store?: ConfirmationStore;
  service?: typeof brokerService;
};
const idSchema = z.coerce.number().int().positive();
const tokenSchema = z.string().uuid();
const noteSchema = z.object({ notes: z.string().trim().min(3).max(2000) }).strict();
export const confirmationSettingsSchema = z.object({
  maxReminders: z.number().int().min(0).max(3),
  reminderDays: z.tuple([z.number().int().min(1).max(365), z.number().int().min(1).max(365), z.number().int().min(1).max(365)])
    .refine(days => days[0] < days[1] && days[1] < days[2], "Reminder days must be strictly increasing."),
  publicBaseUrl: z.string().url().refine(value => {
    const url = new URL(value);
    return url.protocol === "https:" && url.pathname === "/" && !url.search && !url.hash &&
      !url.username && !url.password && !url.hostname.endsWith(".replit.dev") &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  }, "Use the published HTTPS site URL, without a path."),
}).strict();

function page(title: string, content: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" type="image/png" href="/images/tpf-logo.png"><title>${escape(title)} — Trucking Pros Financial</title><style>body{background:#c0c0c0;color:#111;font:16px Arial,sans-serif;margin:0;padding:32px 12px}main{max-width:620px;margin:auto;padding:4px;border:3px outset #ddd;background:#c0c0c0}header{padding:12px;color:white;background:#000080;font-weight:bold}.body{padding:20px}h1{font-size:24px}table{width:100%;border:2px inset #ddd;background:white;margin:16px 0}th,td{text-align:left;padding:8px;overflow-wrap:anywhere}button,a.button{font:inherit;display:inline-block;border:3px outset #ddd;background:#c0c0c0;color:#111;padding:10px 20px;cursor:pointer;text-decoration:none}textarea{box-sizing:border-box;width:100%;min-height:100px;border:2px inset #ddd;font:inherit;margin:8px 0 16px}button:active{border-style:inset}.muted{font-size:14px;color:#444}</style></head><body><main><header><img src="/images/tpf-logo-white.png" alt="Trucking Pros Financial" width="40" height="40" style="vertical-align:middle;margin-right:12px">Trucking Pros Financial — Broker Invoice Confirmation</header><div class="body"><h1>${escape(title)}</h1>${content}</div></main></body></html>`;
}

function publicHeaders(res: any) {
  res.set({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  });
}

export function registerBrokerConfirmationRoutes(app: Express, deps: Dependencies) {
  const service = deps.service ?? brokerService;
  const db = deps.store ?? applicationDb;
  const wrap = (handler: (req: any, res: any) => Promise<unknown>): RequestHandler => async (req, res) => {
    try { await handler(req, res); }
    catch (error) {
      if (error instanceof z.ZodError) return void res.status(400).json({ message: "Invalid confirmation data", errors: error.errors });
      if (error instanceof ConfirmationError) return void res.status(error.status).json({ message: error.message });
      console.error("[brokerConfirmation] Request failed:", error instanceof Error ? error.message : "Unknown error");
      res.status(500).json({ message: "Unable to process broker confirmation." });
    }
  };
  const access = async (req: any) => {
    const id = idSchema.parse(req.params.id);
    if (!await deps.canAccessInvoice(req, id)) throw new ConfirmationError(403, "You may only access your assigned invoices.");
    return id;
  };
  const actor = (req: any) => ({ kind: "agent" as const, id: req.user.id as string });

  app.get("/api/invoices/:id/broker-confirmation", deps.requireAuth, wrap(async (req, res) => {
    const detail = await service.details(await access(req));
    res.json({ ...detail, canReassign: ["manager", "admin"].includes(req.user.role) });
  }));
  app.post("/api/invoices/:id/broker-confirmation/resend", deps.requireAuth, wrap(async (req, res) => {
    res.json(await service.sendForInvoice(await access(req), actor(req)));
  }));
  app.post("/api/invoices/:id/broker-confirmation/mark-confirmed", deps.requireAuth, wrap(async (req, res) => {
    const { notes } = noteSchema.parse(req.body);
    res.json(await service.resolve(await access(req), "confirmed", actor(req), `Phone confirmation: ${notes}`));
  }));
  app.get("/api/invoices/:id/broker-confirmation/agents", deps.requireManagerOrAdmin, wrap(async (req, res) => {
    await access(req);
    const rows = await db.select({ id: users.id, name: sql<string>`concat_ws(' ', ${users.firstName}, ${users.lastName})` })
      .from(users).where(and(eq(users.status, "active"), eq(users.isTestAccount, false))).orderBy(asc(users.firstName), asc(users.lastName));
    res.json(rows);
  }));
  app.patch("/api/invoices/:id/broker-confirmation/assignment", deps.requireManagerOrAdmin, wrap(async (req, res) => {
    const { agentId } = z.object({ agentId: z.string().trim().max(200) }).strict().parse(req.body);
    res.json(await service.reassign(await access(req), agentId || null, actor(req)));
  }));
  app.get("/api/broker-confirmation-settings", deps.requireAuth, wrap(async (_req, res) => res.json(await service.settings())));
  app.patch("/api/broker-confirmation-settings", deps.requireManagerOrAdmin, wrap(async (req, res) => {
    const value = confirmationSettingsSchema.parse(req.body);
    await db.update(brokerConfirmationSettings).set({ ...value, publicBaseUrl: new URL(value.publicBaseUrl).origin, updatedBy: req.user.id, updatedAt: new Date() })
      .where(eq(brokerConfirmationSettings.id, 1));
    res.json(await service.settings());
  }));
  app.get("/api/confirmation-follow-ups", deps.requireAuth, wrap(async (req, res) => {
    const rows = await db.select({
      id: tasks.id, invoiceId: invoices.id, invoiceNumber: invoices.invoiceNumber, brokerName: brokers.name,
      title: tasks.title, description: tasks.description, priority: tasks.priority, status: tasks.status,
      dueDate: tasks.dueDate, assignedTo: tasks.assignedTo,
      agentName: sql<string | null>`nullif(concat_ws(' ', ${users.firstName}, ${users.lastName}), '')`,
      kind: tasks.confirmationKind, confirmationStatus: invoices.brokerConfirmationStatus,
    }).from(tasks).innerJoin(invoices, eq(tasks.confirmationInvoiceId, invoices.id))
      .leftJoin(brokers, eq(invoices.brokerId, brokers.id)).leftJoin(users, eq(tasks.assignedTo, users.id))
      .where(req.user.role === "employee" ? eq(tasks.assignedTo, req.user.id) : undefined)
      .orderBy(asc(tasks.dueDate), asc(tasks.id));
    res.json(rows);
  }));
  app.patch("/api/confirmation-follow-ups/:id", deps.requireAuth, wrap(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const { status } = z.object({ status: z.enum(["todo", "in_progress", "completed"]) }).strict().parse(req.body);
    const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
    if (!row?.confirmationInvoiceId) throw new ConfirmationError(404, "Confirmation follow-up not found.");
    if (req.user.role === "employee" && row.assignedTo !== req.user.id) throw new ConfirmationError(403, "You may only update your assigned follow-ups.");
    await db.update(tasks).set({ status, progress: status === "completed" ? 100 : 0, updatedAt: new Date() })
      .where(and(eq(tasks.id, id), req.user.role === "employee" ? eq(tasks.assignedTo, req.user.id) : undefined));
    res.json({ message: "Confirmation follow-up updated." });
  }));
  app.get("/api/reports/confirmation-aging", deps.requireAuth, wrap(async (req, res) => {
    res.json(await getConfirmationAgingRows(await getConfirmationInvoiceScope(req.user, db), db));
  }));

  // GET is deliberately non-confirming. Only an explicit, CSRF-protected POST records receipt/dispute.
  for (const mode of ["confirm", "dispute"] as const) {
    const route = `/api/broker-${mode}/:token`;
    app.get(route, async (req, res) => {
      publicHeaders(res);
      try {
        const token = tokenSchema.parse(req.params.token);
        const invoice = await service.publicInvoice(token, true);
        if (["confirmed", "disputed"].includes(invoice.status)) {
          return void res.send(page(invoice.status === "confirmed" ? "Thank you" : "Dispute recorded",
            `<p>${invoice.status === "confirmed" ? "Receipt of this invoice has been confirmed." : "Your dispute has been recorded. Please contact Trucking Pros Financial."}</p><p>Invoice ${escape(invoice.invoiceNumber)}</p><p>Contact: ${escape(SYSTEM_EMAIL_REPLY_TO)}</p>`));
        }
        const csrf = randomBytes(32).toString("hex");
        const cookie = `ff-broker-confirm-${invoice.invoiceId}`;
        res.cookie(cookie, csrf, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: `/api/broker-${mode}/${token}`, maxAge: 30 * 60_000 });
        const summary = [["Invoice", invoice.invoiceNumber], ["Carrier invoice", invoice.carrierInvoiceNumber || "Not provided"],
          ["Load", invoice.loadNumber || "Not provided"], ["Amount", `$${Number(invoice.amount).toFixed(2)}`], ["Carrier", invoice.carrier || "Not provided"]];
        res.send(page(mode === "confirm" ? "Confirm invoice receipt" : "Dispute invoice receipt",
          `<table>${summary.map(([key, value]) => `<tr><th>${escape(key)}</th><td>${escape(value)}</td></tr>`).join("")}</table><p>${mode === "confirm" ? "Opening this page has not confirmed receipt. Click the button below to confirm." : "Describe the issue, then submit your dispute. Please also contact Trucking Pros Financial."}</p><form method="post" action="/api/broker-${mode}/${token}"><input type="hidden" name="csrf" value="${csrf}">${mode === "dispute" ? '<label for="reason">Reason (optional)</label><textarea id="reason" name="reason" maxlength="2000"></textarea>' : ""}<button type="submit" data-testid="broker-confirm-submit">${mode === "confirm" ? "Confirm Receipt" : "Submit Dispute"}</button></form><p class="muted">Contact: ${escape(SYSTEM_EMAIL_REPLY_TO)}</p>`));
      } catch (error) {
        const status = error instanceof z.ZodError ? 404 : error instanceof ConfirmationError ? error.status : 500;
        res.status(status).send(page("Confirmation unavailable", `<p>${escape(error instanceof ConfirmationError ? error.message : "This link is invalid or currently unavailable. Please contact Trucking Pros Financial.")}</p>`));
      }
    });
    app.post(route, async (req, res) => {
      publicHeaders(res);
      try {
        const token = tokenSchema.parse(req.params.token);
        const input = z.object({ csrf: z.string().regex(/^[a-f0-9]{64}$/), reason: z.string().trim().max(2000).optional() }).parse(req.body);
        const invoice = await service.publicInvoice(token);
        const cookieName = `ff-broker-confirm-${invoice.invoiceId}=`;
        const cookie = req.headers.cookie?.split(";").map(value => value.trim()).find(value => value.startsWith(cookieName))?.slice(cookieName.length);
        if (!cookie || cookie.length !== input.csrf.length || !timingSafeEqual(Buffer.from(cookie), Buffer.from(input.csrf))) {
          throw new ConfirmationError(403, "Please reopen the email link and use the confirmation button.");
        }
        const response = await service.brokerRespond(token, mode === "confirm" ? "confirmed" : "disputed", input.reason || "");
        res.send(page(mode === "confirm" ? "Thank you" : "Dispute recorded",
          `<p>${escape(response.message)}</p><p>Invoice ${escape(invoice.invoiceNumber)}</p>${mode === "dispute" ? `<p>Contact: ${escape(SYSTEM_EMAIL_REPLY_TO)}</p>` : ""}`));
      } catch (error) {
        const status = error instanceof z.ZodError ? 400 : error instanceof ConfirmationError ? error.status : 500;
        res.status(status).send(page("Unable to record response", `<p>${escape(error instanceof ConfirmationError ? error.message : "The response could not be recorded. Please reopen the link and try again.")}</p>`));
      }
    });
  }
}
