import type { Express, Request, Response, RequestHandler } from "express";
import multer from "multer";
import { z } from "zod";
import {
  BrokerPortalError, brokerPortalAuth, brokerIdentity, revokeBrokerSession, portalCsrf, validPortalCsrf,
  portalEmail, portalRateLimit, type BrokerIdentity,
} from "../services/brokerPortalAuth";
import {
  listBrokerInvoices, getBrokerInvoice, respondToBrokerInvoice, listBrokerDocuments, brokerDocumentUrl,
  uploadBrokerDocument, ownBrokerInvoice, brokerNotes, addBrokerNote, portalId,
} from "../services/brokerPortalInvoices";
import { ConfirmationError } from "../services/brokerConfirmationService";

const COOKIE = "tpf_broker_session";
type BrokerRequest = Request & { broker: BrokerIdentity };
function readToken(req: Request) {
  const cookie = (req.headers.cookie ?? "").split(";").map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`));
  return cookie?.slice(COOKIE.length + 1) ?? "";
}
function sessionResult(actor: BrokerIdentity, token: string) {
  const { brokerId: _brokerId, ...user } = actor;
  return { user, csrfToken: portalCsrf(token) };
}
const cookieOptions = () => ({ path: "/api/broker", httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const });
function sameOrigin(req: Request) {
  const origin = req.get("origin");
  if (req.get("sec-fetch-site") === "cross-site") throw new BrokerPortalError(403, "Cross-site requests are not allowed.");
  if (origin) {
    let host: string;
    try { host = new URL(origin).host; } catch { throw new BrokerPortalError(403, "Invalid request origin."); }
    if (host !== req.get("host")) throw new BrokerPortalError(403, "Cross-site requests are not allowed.");
  }
}
export function registerBrokerPortalRoutes(app: Express, deps: {
  requireAuth: RequestHandler;
  requireInvoiceRead: RequestHandler;
  canAccessInvoice: (req: any, id: number) => Promise<boolean>;
}) {
  const wrap = (work: (req: BrokerRequest, res: Response) => Promise<unknown>): RequestHandler => async (req, res) => {
    try { await work(req as BrokerRequest, res); }
    catch (error) {
      if (res.headersSent) return;
      if (error instanceof z.ZodError) { res.status(400).json({ message: error.issues[0]?.message ?? "Invalid input." }); return; }
      if (error instanceof BrokerPortalError || error instanceof ConfirmationError) {
        if (error.status === 429) res.setHeader("Retry-After", "3600");
        res.status(error.status).json({ message: error.message }); return;
      }
      if (error instanceof multer.MulterError) { res.status(400).json({ message: "Upload one PDF, JPEG, or PNG up to 15 MB." }); return; }
      console.error("[brokerPortal] Request failed:", error instanceof Error ? error.name : "UnknownError");
      res.status(500).json({ message: "The Broker Portal could not complete this request." });
    }
  };
  app.use("/broker", (_req, res, next) => {
    res.set({ "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" }); next();
  });
  app.use("/api/broker", (_req, res, next) => {
    res.set({ "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" }); next();
  });
  const auth: RequestHandler = async (req, res, next) => {
    try {
      (req as BrokerRequest).broker = await brokerIdentity(readToken(req));
      if (!["GET", "HEAD"].includes(req.method)) {
        sameOrigin(req);
        if (!validPortalCsrf(readToken(req), req.get("X-Broker-CSRF"))) throw new BrokerPortalError(403, "Session verification failed. Refresh and try again.");
      }
      next();
    } catch (error) { res.status(error instanceof BrokerPortalError ? error.status : 500).json({ message: error instanceof BrokerPortalError ? error.message : "Session verification is unavailable." }); }
  };
  const startSession = async (req: Request, res: Response, token: string) => {
    await revokeBrokerSession(readToken(req));
    const actor = await brokerIdentity(token);
    res.cookie(COOKIE, token, { ...cookieOptions(), maxAge: 8 * 60 * 60 * 1000 });
    return sessionResult(actor, token);
  };
  const rateAuth = async (req: Request, action: string, email: unknown, limit = 5) => {
    sameOrigin(req);
    await portalRateLimit(`${action}/ip`, req.ip || "unknown", action === "login" ? 30 : 20);
    const normalized = portalEmail.parse(email);
    await portalRateLimit(action, normalized, limit);
  };
  app.post("/api/broker/register", wrap(async (req, res) => {
    await rateAuth(req, "register", req.body.email);
    res.status(202).json(await brokerPortalAuth.register(req.body));
  }));
  app.post("/api/broker/login", wrap(async (req, res) => {
    await rateAuth(req, "login", req.body.email, 10);
    const token = await brokerPortalAuth.login(req.body);
    res.json(await startSession(req, res, token));
  }));
  app.post("/api/broker/magic-link", wrap(async (req, res) => {
    await rateAuth(req, "magic", req.body.email);
    res.status(202).json(await brokerPortalAuth.magic(req.body.email));
  }));
  app.post("/api/broker/verify", wrap(async (req, res) => {
    sameOrigin(req);
    await portalRateLimit("verify/ip", req.ip || "unknown", 20);
    const value = z.object({ token: z.string().length(64), password: z.string().min(1).max(200) }).parse(req.body);
    const token = await brokerPortalAuth.redeem(value.token, "verify", value.password);
    res.json(await startSession(req, res, token));
  }));
  app.get("/api/broker/magic-link/:token", async (req, res) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    try {
      await portalRateLimit("magic-redeem/ip", req.ip || "unknown", 30);
      const token = await brokerPortalAuth.redeem(req.params.token, "magic");
      await startSession(req, res, token);
      res.redirect(303, "/broker/dashboard");
    } catch { res.redirect(303, "/broker/login?error=invalid-link"); }
  });
  app.get("/api/broker/me", auth, wrap(async (req, res) => res.json(sessionResult(req.broker, readToken(req)))));
  app.post("/api/broker/logout", auth, wrap(async (req, res) => {
    await revokeBrokerSession(readToken(req)); res.clearCookie(COOKIE, cookieOptions()); res.json({ message: "Signed out." });
  }));
  app.get("/api/broker/invoices", auth, wrap(async (req, res) => res.json(await listBrokerInvoices(req.broker, req.query))));
  app.get("/api/broker/invoices/:id", auth, wrap(async (req, res) => res.json(await getBrokerInvoice(req.broker, portalId.parse(req.params.id)))));
  for (const action of ["confirm", "dispute"] as const) {
    app.post(`/api/broker/invoices/:id/${action}`, auth, wrap(async (req, res) => {
      await portalRateLimit("response/user", String(req.broker.id), 120);
      res.json(await respondToBrokerInvoice(req.broker, portalId.parse(req.params.id), action === "confirm" ? "confirmed" : "disputed", req.body.reason));
    }));
  }
  app.get("/api/broker/invoices/:id/documents", auth, wrap(async (req, res) => res.json(await listBrokerDocuments(req.broker, portalId.parse(req.params.id)))));
  app.get("/api/broker/invoices/:id/documents/:documentId/download", auth, wrap(async (req, res) => {
    res.redirect(302, await brokerDocumentUrl(req.broker, portalId.parse(req.params.id), portalId.parse(req.params.documentId)));
  }));
  // Busboy emits partsLimit as soon as the count is reached. Leave room for
  // the terminal boundary; files/fields independently enforce one of each.
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 1, parts: 3 } }).single("file");
  app.post("/api/broker/invoices/:id/documents", auth, wrap(async (req, res) => {
    const id = portalId.parse(req.params.id);
    await ownBrokerInvoice(req.broker, id);
    await portalRateLimit("upload/user", String(req.broker.id), 30);
    await new Promise<void>((resolve, reject) => upload(req, res, error => error ? reject(error) : resolve()));
    if (!req.file) throw new BrokerPortalError(400, "Choose a document.");
    res.status(201).json(await uploadBrokerDocument(req.broker, id, req.body.documentType, req.file));
  }));
  app.get("/api/broker/invoices/:id/notes", auth, wrap(async (req, res) => {
    const id = portalId.parse(req.params.id); await ownBrokerInvoice(req.broker, id); res.json(await brokerNotes(id, req.query.page, req.broker.brokerId));
  }));
  app.post("/api/broker/invoices/:id/notes", auth, wrap(async (req, res) => {
    const id = portalId.parse(req.params.id); await ownBrokerInvoice(req.broker, id);
    await portalRateLimit("note/user", String(req.broker.id), 60);
    res.status(201).json(await addBrokerNote(id, req.body, { brokerUserId: req.broker.id, brokerId: req.broker.brokerId, name: req.broker.contactName }));
  }));
  // A Phase 2 UI can use these new staff-only reply endpoints. No existing
  // internal page or route is changed, and broker cookies cannot authorize them.
  const staffScope = async (req: Request, id: number) => {
    const role = (req as any).user?.role;
    if (!["admin", "manager", "employee"].includes(role) || !await deps.canAccessInvoice(req, id))
      throw new BrokerPortalError(403, "You cannot access this invoice.");
  };
  app.get("/api/broker-portal-staff/invoices/:id/notes", deps.requireAuth, deps.requireInvoiceRead, wrap(async (req, res) => {
    const id = portalId.parse(req.params.id); await staffScope(req, id); res.json(await brokerNotes(id, req.query.page));
  }));
  app.post("/api/broker-portal-staff/invoices/:id/notes", deps.requireAuth, deps.requireInvoiceRead, wrap(async (req, res) => {
    sameOrigin(req);
    const id = portalId.parse(req.params.id); await staffScope(req, id);
    const user = (req as any).user;
    res.status(201).json(await addBrokerNote(id, req.body, { staffUserId: user.id, name: [user.firstName, user.lastName].filter(Boolean).join(" ") || "TPF team" }));
  }));
  // Fail closed before the generic internal API boundary, including unmatched
  // methods/paths. No broker path can fall into a permissive staff alias.
  app.use("/api/broker", (_req, res) => res.status(404).json({ message: "Broker endpoint not found." }));
  app.use("/api/broker-portal-staff", (_req, res) => res.status(404).json({ message: "Endpoint not found." }));
}
