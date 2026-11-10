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
import { isProductionAppOrigin } from "../../shared/production-urls.js";
import { BROKER_PUBLIC_ORIGIN } from "../services/brokerConfirmationPresentation";

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
  chargebackWarningDays: z.number().int().min(1).max(89).optional(),
  dumpStatementIntervalDays: z.number().int().min(1).max(365).optional(),
  maxReminders: z.number().int().min(0).max(3),
  reminderDays: z.tuple([z.number().int().min(1).max(365), z.number().int().min(1).max(365), z.number().int().min(1).max(365)])
    .refine(days => days[0] < days[1] && days[1] < days[2], "Reminder days must be strictly increasing."),
  publicBaseUrl: z.string().url().refine(isProductionAppOrigin,
    "Use https://factorflux.io, without a path."),
}).strict();

function page(title: string, content: string): string {
  const pageClass = /^(Confirmation unavailable|Unable to record response)$/.test(title) ? " page-error" : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" type="image/png" href="/images/tpf-logo.png"><title>${escape(title)} — Trucking Pros Financial</title><style>
    :root{color-scheme:light;--surface:#e0e0e0;--ink:#394541;--muted:#68736e;--teal:#27aab8;--teal-deep:#168f99;--shadow:4px 4px 8px #c8c8c8,-4px -4px 8px #fff;--inset:inset 3px 3px 6px #c8c8c8,inset -3px -3px 6px #fff;--input-inset:inset 2px 2px 4px #c8c8c8,inset -2px -2px 4px #fff}
    *{box-sizing:border-box}
    body{min-height:100vh;margin:0;padding:clamp(16px,5vw,48px) 14px;background:var(--surface);color:var(--ink);font:16px/1.55 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{width:min(100%,620px);margin:0 auto;overflow:hidden;border-radius:20px;background:var(--surface);box-shadow:var(--shadow)}
    header{display:flex;align-items:center;gap:13px;min-height:76px;padding:16px 22px;background:var(--teal);color:#fff;font-size:15px;font-weight:700;letter-spacing:.01em}
    header img{width:40px;height:40px;flex:0 0 40px;object-fit:contain}
    .body{padding:clamp(22px,6vw,36px)}
    h1{margin:0 0 22px;color:var(--ink);font-size:clamp(24px,6vw,30px);font-weight:650;letter-spacing:-.035em;line-height:1.15}
    p{margin:14px 0}
    .invoice-details{width:100%;margin:20px 0 24px;border:0;border-radius:15px;background:var(--surface);box-shadow:var(--shadow);border-spacing:0;overflow:hidden}
    .invoice-details caption{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    .invoice-details th,.invoice-details td{padding:12px 16px;border-bottom:1px solid rgba(160,171,165,.42);text-align:left;overflow-wrap:anywhere}
    .invoice-details tr:last-child th,.invoice-details tr:last-child td{border-bottom:0}
    .invoice-details th{width:39%;color:var(--muted);font-size:13px;font-weight:650}
    .invoice-details td{color:var(--ink);font-weight:600}
    form{margin-top:22px}
    label{display:block;margin:0 0 7px;font-size:14px;font-weight:650}
    textarea{display:block;width:100%;min-height:112px;margin:8px 0 18px;padding:13px 14px;border:0;border-radius:12px;background:var(--surface);box-shadow:var(--input-inset);color:var(--ink);font:inherit;resize:vertical}
    button,a.button{display:inline-flex;min-height:50px;align-items:center;justify-content:center;border:0;border-radius:12px;background:var(--teal);box-shadow:3px 3px 6px #c8c8c8,-3px -3px 6px #fff;color:#fff;padding:12px 22px;font:inherit;font-weight:700;text-align:center;text-decoration:none;cursor:pointer;transition:transform .16s ease,box-shadow .16s ease,background-color .16s ease}
    button:hover,a.button:hover{background:var(--teal-deep)}
    button:active,a.button:active{transform:translateY(1px);box-shadow:inset 2px 2px 4px rgba(24,93,97,.28),inset -2px -2px 4px rgba(255,255,255,.25)}
    :focus-visible{outline:3px solid #147b84;outline-offset:3px}
    .muted{margin-top:20px;color:var(--muted);font-size:14px}
    .result{margin:4px 0 0;padding:24px;border-radius:16px;background:var(--surface);box-shadow:var(--shadow)}
    .success-mark{display:grid;width:54px;height:54px;place-items:center;margin-bottom:17px;border-radius:50%;background:var(--surface);box-shadow:var(--inset);color:var(--teal-deep)}
    .success-mark svg{width:27px;height:27px}
    .result-copy{margin:0 0 12px;font-size:17px;font-weight:600}
    .invoice-ref{margin:0;color:var(--muted);font-size:14px}
    .notice{padding:16px 18px;border-radius:12px;background:var(--surface);box-shadow:var(--inset)}
    .notice-error{border-left:4px solid #b76556;color:#66473f}
    .page-error .body>p:first-of-type{margin:4px 0 0;padding:16px 18px;border-left:4px solid #b76556;border-radius:12px;background:var(--surface);box-shadow:var(--inset);color:#66473f}
    @media(max-width:480px){
      body{padding:14px 12px}
      main{border-radius:16px}
      header{min-height:68px;padding:13px 17px;font-size:14px}
      header img{width:36px;height:36px;flex-basis:36px}
      .body{padding:23px 18px}
      .invoice-details{display:block}
      .invoice-details tbody{display:block}
      .invoice-details tr{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.35fr);gap:8px}
      .invoice-details th,.invoice-details td{width:auto;padding:11px 13px}
      button,a.button{width:100%}
      .result{padding:20px}
    }
    @media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition:none!important}}
  </style></head><body><main class="page${pageClass}"><header><img src="/images/tpf-logo-white.png" alt="Trucking Pros Financial" width="40" height="40"> <span>Trucking Pros Financial <span aria-hidden="true">—</span> Broker Invoice Confirmation</span></header><div class="body"><h1>${escape(title)}</h1>${content}</div></main></body></html>`;
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
    await db.update(brokerConfirmationSettings).set({ ...value, publicBaseUrl: BROKER_PUBLIC_ORIGIN, updatedBy: req.user.id, updatedAt: new Date() })
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
            `<section class="result" aria-label="Response recorded"><div class="success-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="m5 12.5 4.5 4.5L19 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div><p class="result-copy">${invoice.status === "confirmed" ? "Receipt of this invoice has been confirmed." : "Your dispute has been recorded. Please contact Trucking Pros Financial."}</p><p class="invoice-ref">Invoice ${escape(invoice.invoiceNumber)}</p><p class="muted">Contact: ${escape(SYSTEM_EMAIL_REPLY_TO)}</p></section>`));
        }
        const csrf = randomBytes(32).toString("hex");
        const cookie = `ff-broker-confirm-${invoice.invoiceId}`;
        res.cookie(cookie, csrf, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: `/api/broker-${mode}/${token}`, maxAge: 30 * 60_000 });
        const summary = [["Invoice", invoice.invoiceNumber], ["Carrier invoice", invoice.carrierInvoiceNumber || "Not provided"],
          ["Load", invoice.loadNumber || "Not provided"], ["Amount", `$${Number(invoice.amount).toFixed(2)}`], ["Carrier", invoice.carrier || "Not provided"]];
        res.send(page(mode === "confirm" ? "Confirm invoice receipt" : "Dispute invoice receipt",
          `<table class="invoice-details"><caption>Invoice details</caption><tbody>${summary.map(([key, value]) => `<tr><th scope="row">${escape(key)}</th><td>${escape(value)}</td></tr>`).join("")}</tbody></table><p>${mode === "confirm" ? "Opening this page has not confirmed receipt. Click the button below to confirm." : "Describe the issue, then submit your dispute. Please also contact Trucking Pros Financial."}</p><form method="post" action="/api/broker-${mode}/${token}"><input type="hidden" name="csrf" value="${csrf}">${mode === "dispute" ? '<label for="reason">Reason (optional)</label><textarea id="reason" name="reason" maxlength="2000"></textarea>' : ""}<button type="submit" data-testid="broker-confirm-submit">${mode === "confirm" ? "Confirm Receipt" : "Submit Dispute"}</button></form><p class="muted">Contact: ${escape(SYSTEM_EMAIL_REPLY_TO)}</p>`));
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
          `<section class="result" aria-label="Response recorded"><div class="success-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="m5 12.5 4.5 4.5L19 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div><p class="result-copy">${escape(response.message)}</p><p class="invoice-ref">Invoice ${escape(invoice.invoiceNumber)}</p>${mode === "dispute" ? `<p class="muted">Contact: ${escape(SYSTEM_EMAIL_REPLY_TO)}</p>` : ""}</section>`));
      } catch (error) {
        const status = error instanceof z.ZodError ? 400 : error instanceof ConfirmationError ? error.status : 500;
        res.status(status).send(page("Unable to record response", `<p>${escape(error instanceof ConfirmationError ? error.message : "The response could not be recorded. Please reopen the link and try again.")}</p>`));
      }
    });
  }
}
