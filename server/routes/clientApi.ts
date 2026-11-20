import { Router, type Express, type RequestHandler, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { z } from "zod";
import { pool } from "../db";
import { storage } from "../storage";
import { ClientApiError, clientId, clientPage, clientTransaction } from "../services/clientApiCommon";
import { createClientAuth, consumeClientRegistrationAttempt, requireClientJwt } from "../services/clientApiAuth";
import { clientFundingProgress, clientSubmissionForInvoice, changeClientFundingStep, ownedClientSubmission, clientNotes, addClientNote } from "../services/clientFunding";
import { clientDashboard, clientSubmissionPage, clientSubmissionDetail, createClientSubmission, addClientDocuments, clientDocumentPage, clientDocumentDownload, type ClientIntakeChecks } from "../services/clientSubmissions";
import { registerClientPushToken, unregisterClientPushToken } from "../services/clientPush";
import { escapeEmailHtml } from "../emailTemplate.js";
import { LOAD_TYPES } from "../../shared/load-types";

type Dependencies = ClientIntakeChecks & {
  requireAuth: RequestHandler;
  requireSubmissionAccess: RequestHandler;
  requireInvoiceRead: RequestHandler;
  canAccessInvoice: (req: any, id: number) => Promise<boolean>;
};
const wrap = (handler: (req: any, res: any, next: NextFunction) => Promise<unknown>): RequestHandler => async (req, res, next) => {
  try { await handler(req, res, next); }
  catch (error: any) {
    const status = error instanceof z.ZodError ? 400 : error instanceof ClientApiError ? error.status : error?.code === "23505" ? 409 : 500;
    if (status === 429) res.setHeader("Retry-After", "3600");
    if (status === 500) console.error("[clientApi] Request failed:", typeof error?.code === "string" && /^[A-Z0-9_]{1,30}$/.test(error.code) ? error.code : "INTERNAL_ERROR");
    res.status(status).json({ message: error instanceof z.ZodError ? error.errors[0]?.message || "Invalid input."
      : error instanceof ClientApiError ? error.message : status === 409 ? "This record already exists." : "The request could not be completed.",
    ...(error instanceof ClientApiError && error.details ? { details: error.details } : {}) });
  }
};
const sameOrigin: RequestHandler = (req, res, next) => {
  const origin = req.get("origin");
  try {
    if (req.get("sec-fetch-site") === "cross-site" || origin && new URL(origin).host !== req.get("host"))
      return void res.status(403).json({ message: "Cross-site update rejected." });
  } catch { return void res.status(403).json({ message: "Invalid request origin." }); }
  next();
};
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 6, fields: 24, fieldSize: 32768 } });
let activeUploads = 0;
const receiveDocuments: RequestHandler = (req, res, next) => {
  if (!req.is("multipart/form-data")) return next();
  if (activeUploads >= 2) { res.setHeader("Retry-After", "3"); return void res.status(429).json({ message: "Upload capacity is busy. Please retry shortly." }); }
  activeUploads++;
  let released = false;
  const release = () => { if (!released) { activeUploads--; released = true; } };
  res.once("finish", release); res.once("close", release);
  upload.array("documents", 6)(req, res, error => error
    ? res.status((error as any).code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ message: "Upload up to six documents, at most 20 MB each." }) : next());
};
function intakeBody(req: any) {
  const body = { ...req.body };
  let types: unknown = body.documentTypes || [];
  if (typeof types === "string") { try { types = JSON.parse(types); } catch { throw new ClientApiError(400, "documentTypes must be a JSON array."); } }
  delete body.documentTypes;
  if (typeof body.acknowledgements === "string") {
    try { body.acknowledgements = JSON.parse(body.acknowledgements); }
    catch { throw new ClientApiError(400, "acknowledgements must be a JSON array."); }
  }
  return { body, types, files: (req.files || []) as Express.Multer.File[] };
}
export function registerClientApiRoutes(app: Express, deps: Dependencies, auth = createClientAuth()) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
  const verificationLimit = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
  const uploadLimit = rateLimit({ windowMs: 60000, max: 10, standardHeaders: true, legacyHeaders: false, keyGenerator: (req: any) => String(req.clientUser.id) });
  router.post("/register", wrap(async (req, res) => {
    await consumeClientRegistrationAttempt(req.ip || req.socket.remoteAddress || "unknown");
    res.status(201).json(await auth.register(req.body));
  }));
  router.post("/login", loginLimit, wrap(async (req, res) => res.json(await auth.login(req.body))));
  router.post("/request-verification", verificationLimit, wrap(async (req, res) => res.json(await auth.resend(req.body))));
  // A mail scanner's GET does not consume the verification link.
  router.get("/verify-email", verificationLimit, (req, res) => {
    const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/).safeParse(req.query.token);
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    if (!token.success) return void res.status(400).send("Invalid verification link.");
    res.type("html").send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Verify carrier email — TPF</title>
      <body style="font:16px system-ui;max-width:520px;margin:12vh auto;padding:24px"><h1>Trucking Pros Financial</h1><p>Confirm ownership of your carrier contact email.</p>
      <form method="post" action="/api/client/verify-email"><input type="hidden" name="token" value="${escapeEmailHtml(token.data)}"><button type="submit">Verify email</button></form></body></html>`);
  });
  router.post("/verify-email", verificationLimit, wrap(async (req, res) => {
    const result = await auth.verify(req.body?.token);
    if (req.is("application/x-www-form-urlencoded")) res.type("html").send(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Carrier email verification</title><body><h1>Trucking Pros Financial</h1><p>${escapeEmailHtml(result.message)}</p></body></html>`);
    else res.json(result);
  }));
  router.use(requireClientJwt);
  router.get("/dashboard", wrap(async (req, res) => res.json(await clientDashboard(req.clientUser))));
  router.get("/submissions", wrap(async (req, res) => res.json(await clientSubmissionPage(req.clientUser, req.query.page))));
  router.post("/submissions", uploadLimit, receiveDocuments, wrap(async (req, res) => {
    const value = intakeBody(req);
    res.status(201).json(await createClientSubmission(req.clientUser, value.body, value.files, value.types, deps));
  }));
  router.get("/submissions/:id", wrap(async (req, res) => {
    const id = clientId(req.params.id), detail = await clientSubmissionDetail(req.clientUser, id);
    const progress = await clientFundingProgress(id, false);
    // Internal actors/reversion reasons stay internal. Client fields expose
    // only their own progress and verified payment evidence.
    const { history: _history, stepChangedBy: _actor, canUpdate: _can, ...publicProgress } = progress;
    res.json({ ...detail, progress: publicProgress });
  }));
  router.post("/submissions/:id/documents", uploadLimit, wrap(async (req, _res, next) => {
    await ownedClientSubmission(req.clientUser, clientId(req.params.id));
    next();
  }), receiveDocuments, wrap(async (req, res) => {
    const value = intakeBody(req);
    res.status(201).json(await addClientDocuments(req.clientUser, clientId(req.params.id), value.files, value.types));
  }));
  router.get("/submissions/:id/documents", wrap(async (req, res) =>
    res.json(await clientDocumentPage(req.clientUser, clientId(req.params.id), req.query.page))));
  router.get("/submissions/:id/documents/:documentId/download", wrap(async (req, res) =>
    res.json(await clientDocumentDownload(req.clientUser, clientId(req.params.id), clientId(req.params.documentId)))));
  router.get("/submissions/:id/notes", wrap(async (req, res) => {
    const id = clientId(req.params.id); await ownedClientSubmission(req.clientUser, id); res.json(await clientNotes(id, req.query.page));
  }));
  router.post("/submissions/:id/notes", wrap(async (req, res) =>
    res.status(201).json(await addClientNote(clientId(req.params.id), { type: "client", id: req.clientUser.id, carrierId: req.clientUser.carrierId }, req.body))));
  router.post("/push-token", wrap(async (req, res) => res.status(201).json(await registerClientPushToken(req.clientUser.id, req.body))));
  router.delete("/push-token", wrap(async (req, res) => res.json(await unregisterClientPushToken(req.clientUser.id, req.body))));
  router.get("/submission-options", wrap(async (req, res) => {
    const banks = await pool.query("SELECT id,label FROM client_vault WHERE client_id=$1 AND data_type='bank_account' AND is_active ORDER BY id LIMIT 100", [req.clientUser.carrierId]);
    res.json({ loadTypes: LOAD_TYPES, bankAccounts: banks.rows });
  }));
  router.get("/brokers", wrap(async (req, res) => {
    const page = clientPage(req.query.page), search = z.string().trim().max(100).default("").parse(req.query.search).replace(/[\\%_]/g, "\\$&");
    const [items, total] = await Promise.all([
      pool.query("SELECT id,name FROM brokers WHERE status='active' AND name ILIKE $1 ESCAPE '\\' ORDER BY name,id LIMIT 15 OFFSET $2", [`%${search}%`, page.offset]),
      pool.query("SELECT count(*)::int AS n FROM brokers WHERE status='active' AND name ILIKE $1 ESCAPE '\\'", [`%${search}%`]),
    ]);
    res.json({ items: items.rows, total: total.rows[0].n, page: page.page, pageSize: 15 });
  }));
  router.get("/brokers/:id/branches", wrap(async (req, res) => {
    const page = clientPage(req.query.page);
    const rows = await pool.query(`SELECT bb.id,bb.branch_name AS name,count(*) OVER()::int AS total FROM broker_branches bb
      JOIN brokers b ON b.id=bb.broker_id WHERE b.id=$1 AND b.status='active' AND bb.status='active'
      ORDER BY bb.branch_name,bb.id LIMIT 15 OFFSET $2`, [clientId(req.params.id), page.offset]);
    res.json({ items: rows.rows.map(({ total, ...r }) => r), total: rows.rows[0]?.total || 0, page: page.page, pageSize: 15 });
  }));
  router.use((_req, res) => { res.status(404).json({ message: "Client endpoint not found." }); });
  app.use("/api/client", router);

  const internal = Router();
  internal.use(deps.requireAuth, (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  internal.get("/submissions/:id/funding-progress", deps.requireSubmissionAccess, wrap(async (req, res) =>
    res.json({ progress: await clientFundingProgress(clientId(req.params.id), true) })));
  internal.get("/invoices/:id/funding-progress", deps.requireInvoiceRead, wrap(async (req, res) => {
    const id = clientId(req.params.id);
    if (!await deps.canAccessInvoice(req, id)) throw new ClientApiError(403, "Invoice access denied.");
    const submissionId = await clientSubmissionForInvoice(id);
    const canUpdate = req.user.role === "admin" || (await storage.getUserPermissions(req.user.id)).includes("portal_submissions");
    res.json({ progress: submissionId ? await clientFundingProgress(submissionId, canUpdate) : null });
  }));
  internal.put("/submissions/:id/step", deps.requireSubmissionAccess, sameOrigin, wrap(async (req, res) =>
    res.json({ progress: await changeClientFundingStep(clientId(req.params.id), req.user.id, req.body) })));
  internal.get("/submissions/:id/notes", deps.requireSubmissionAccess, wrap(async (req, res) => {
    const id = clientId(req.params.id); await clientFundingProgress(id, false); res.json(await clientNotes(id, req.query.page));
  }));
  internal.post("/submissions/:id/notes", deps.requireSubmissionAccess, sameOrigin, wrap(async (req, res) =>
    res.status(201).json(await addClientNote(clientId(req.params.id), { type: "staff", id: req.user.id }, req.body))));
  internal.post("/client-accounts/:id/approve", sameOrigin, wrap(async (req, res) => {
    if (req.user.role !== "admin") throw new ClientApiError(403, "Admin approval required.");
    const { carrierId } = z.object({ carrierId: z.number().int().positive() }).strict().parse(req.body), id = clientId(req.params.id);
    await clientTransaction(async tx => {
      const user = (await tx.query("SELECT id,status,carrier_id FROM carrier_portal_users WHERE id=$1 FOR UPDATE", [id])).rows[0];
      if (!user || !["pending", "active"].includes(user.status)) throw new ClientApiError(409, "Only pending or existing active portal accounts can be approved.");
      if (user.carrier_id && user.carrier_id !== carrierId) throw new ClientApiError(409, "This endpoint cannot reassign an existing carrier binding.");
      if (!(await tx.query("SELECT id FROM clients WHERE id=$1 FOR UPDATE", [carrierId])).rowCount) throw new ClientApiError(404, "Carrier not found.");
      if ((await tx.query("SELECT id FROM carrier_portal_users WHERE carrier_id=$1 AND status='active' AND id<>$2", [carrierId, id])).rowCount)
        throw new ClientApiError(409, "This carrier already has an active account.");
      await tx.query("UPDATE carrier_portal_users SET carrier_id=$2,status='active',reviewed_by=$3,reviewed_at=now(),rejection_reason=NULL WHERE id=$1", [id, carrierId, req.user.id]);
    });
    res.json({ approved: true, message: "Approved. Email verification is still required before client sign-in." });
  }));
  // Only these new paths are mounted; do not shadow existing internal endpoints.
  app.use("/api/internal", (req, res, next) => {
    if (/^\/(?:submissions\/[^/]+\/(?:funding-progress|step|notes)|invoices\/[^/]+\/funding-progress|client-accounts\/[^/]+\/approve)\/?$/.test(req.path))
      return internal(req, res, next);
    next();
  });
}
