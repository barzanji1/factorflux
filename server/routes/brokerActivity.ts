import type { Express, RequestHandler, Request, Response } from "express";
import { z } from "zod";
import { pool } from "../db";
import {
  activityFilters, brokerActivityBrokers, brokerActivityPage, brokerActivityStats, brokerNotificationPrefs,
  brokerResponseCsv, brokerResponseReport, positiveId, updateBrokerNotificationPrefs, type ActivityScope,
} from "../services/brokerActivity";

type ActivityRequest = Request & { user: { id: string }; brokerActivityScope: ActivityScope };
function checkWriteOrigin(req: Request) {
  const origin = req.get("origin");
  return req.get("sec-fetch-site") !== "cross-site" && (!origin || (() => {
    try { return new URL(origin).host === req.get("host"); } catch { return false; }
  })());
}
export function registerBrokerActivityRoutes(app: Express, auth: RequestHandler) {
  const managers: RequestHandler = async (req: any, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    try {
      const user = (await pool.query("SELECT role,status,is_test_account FROM users WHERE id=$1", [req.user.id])).rows[0];
      if (!user || user.status !== "active" || !["admin", "manager"].includes(user.role)) {
        res.status(403).json({ message: "Broker Activity is available to admins and managers only." }); return;
      }
      if (!["GET", "HEAD"].includes(req.method) && !checkWriteOrigin(req)) {
        res.status(403).json({ message: "Cross-site requests are not allowed." }); return;
      }
      req.brokerActivityScope = { userId: req.user.id, isTest: !!user.is_test_account };
      next();
    } catch { res.status(503).json({ message: "Broker Activity permissions could not be verified." }); }
  };
  const wrap = (handler: (req: ActivityRequest, res: Response) => Promise<unknown>): RequestHandler => async (req, res) => {
    try { await handler(req as ActivityRequest, res); }
    catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      if (error instanceof z.ZodError) { res.status(400).json({ message: error.issues[0]?.message || "Invalid filters." }); return; }
      console.error("[brokerActivity] Request failed", (error as { code?: string })?.code || "UNEXPECTED");
      res.status(500).json({ message: "Broker Activity could not be loaded. Please try again." });
    }
  };
  const activity = "/api/internal/broker-activity", notifications = "/api/internal/notifications", settings = "/api/internal/settings/broker-notifications";
  app.use(activity, auth, managers);
  app.use(notifications, auth, managers);
  app.use(settings, auth, managers);
  app.get(activity, wrap(async (req, res) => res.json(await brokerActivityPage(req.brokerActivityScope, activityFilters.parse(req.query)))));
  app.get(`${activity}/stats`, wrap(async (req, res) => res.json(await brokerActivityStats(req.brokerActivityScope, activityFilters.parse(req.query)))));
  app.get(`${activity}/brokers`, wrap(async (req, res) => res.json(await brokerActivityBrokers(req.query))));
  app.get(`${activity}/report`, wrap(async (req, res) => res.json(await brokerResponseReport(req.brokerActivityScope, activityFilters.parse(req.query)))));
  app.get(`${activity}/report/csv`, wrap(async (req, res) => {
    const filters = activityFilters.parse(req.query);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="TPF-broker-response-report-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    for await (const chunk of brokerResponseCsv(req.brokerActivityScope, filters)) {
      if (res.destroyed) return;
      if (!res.write(chunk)) await new Promise<void>(resolve => {
        const done = () => {
          res.off("drain", done); res.off("close", done); res.off("error", done); resolve();
        };
        res.once("drain", done); res.once("close", done); res.once("error", done);
      });
    }
    if (!res.destroyed) res.end();
  }));
  app.get(settings, wrap(async (req, res) => res.json(await brokerNotificationPrefs(req.user.id))));
  app.put(settings, wrap(async (req, res) => res.json(await updateBrokerNotificationPrefs(req.user.id, req.body))));
  app.get(`${notifications}/unread-count`, wrap(async (req, res) => {
    const result = await pool.query("SELECT count(*)::int AS count FROM notifications WHERE user_id=$1 AND read=false", [req.user.id]);
    res.json(result.rows[0]);
  }));
  app.get(notifications, wrap(async (req, res) => {
    const page = z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.page);
    const rows = await pool.query('SELECT id,user_id AS "userId",title,message,type,read,entity_type AS "entityType",entity_id AS "entityId",action_url AS "actionUrl",created_at AS "createdAt" FROM notifications WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 15 OFFSET $2', [req.user.id, (page - 1) * 15]);
    const total = await pool.query("SELECT count(*)::int AS total FROM notifications WHERE user_id=$1", [req.user.id]);
    res.json({ notifications: rows.rows, total: total.rows[0].total, page, pageSize: 15 });
  }));
  app.post(`${notifications}/:id/read`, wrap(async (req, res) => {
    const row = await pool.query("UPDATE notifications SET read=true WHERE id=$1 AND user_id=$2 RETURNING id", [positiveId.parse(req.params.id), req.user.id]);
    if (!row.rowCount) { res.status(404).json({ message: "Notification not found." }); return; }
    res.json({ success: true });
  }));
  app.post(`${notifications}/read-all`, wrap(async (req, res) => {
    await pool.query("UPDATE notifications SET read=true WHERE user_id=$1 AND read=false", [req.user.id]);
    res.json({ success: true });
  }));
  // Do not fall through to an unrelated API when a broker-management path is
  // misspelled or a protected mutation is attempted using the wrong method.
  for (const prefix of [activity, notifications, settings]) app.use(prefix, (_req, res) => { res.status(404).json({ message: "Endpoint not found." }); });
}
