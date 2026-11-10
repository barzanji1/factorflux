import { Sentry, sentryRequestHandler } from "./instrumentation";
import express, { type Request, type Response, type NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import compression from "compression";
import path from "path";
import fs from "fs";

import { registerRoutes } from "./routes";
import { apiNotFound } from "./apiNotFound";
import { serveStatic, serveStaticAssets } from "./static";
import { log } from "./log";
import { startAuthorityScheduler } from "./services/authorityScheduler";
import { recoverStuckOcrJobs } from "./services/jobQueue";
import { ensureDevAdmin } from "./services/devAdminBootstrap";
import { startBrokerCreditScheduler } from "./services/brokerCreditEngine";
import { emailActorContext } from "./services/emailContext";
import { startDatabaseBackupScheduler } from "./services/databaseBackup";
import { registerHealthRoute } from "./routes/maintenance";

const app = express();
app.use(sentryRequestHandler);
// No session lookup: dependency failures must still return health-check JSON.
registerHealthRoute(app);

// Trust Replit's HTTPS proxy so secure cookies work in production
app.set("trust proxy", 1);

const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set in environment variables");
}

if (!process.env.NEON_DATABASE_URL) {
  throw new Error("NEON_DATABASE_URL must be set in environment variables");
}

const PgSession = connectPgSimple(session);

const isProduction = process.env.NODE_ENV === "production";

if (isProduction) {
  app.use(compression({ threshold: 1024 }));
  serveStaticAssets(app);
}

app.use(
  session({
    store: new PgSession({
      conString: process.env.NEON_DATABASE_URL,
      tableName: "sessions",
      // Prune expired sessions every hour
      pruneSessionInterval: 60 * 60,
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      secure: isProduction,
      httpOnly: true,
      sameSite: "lax",
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    },
  })
);

app.use(express.json({ verify(req: any, _res, buffer) {
  if (req.originalUrl.split("?")[0] === "/api/webhooks/resend") req.rawBody = Buffer.from(buffer);
} }));
app.use(express.urlencoded({ extended: false }));
app.use(emailActorContext);

app.use("/uploads", express.static(uploadsDir));

app.use((req, res, next) => {
  const start = Date.now();
  const reqPath = req.path.replace(/^(\/api\/broker-(?:confirm|dispute)\/)[^/]+$/, "$1[redacted]");
  res.on("finish", () => {
    const duration = Date.now() - start;

    if (reqPath.startsWith("/api")) {
      log(`${req.method} ${reqPath} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});

export async function startServer(
  port = parseInt(process.env.PORT || "5000", 10)
) {
  await ensureDevAdmin();
  const server = await registerRoutes(app);
  app.use("/api", apiNotFound);

  const isDev = process.env.NODE_ENV === "development";

  if (isDev) {
    // Do not let the production bundler hoist Vite's config/plugin imports.
    // The source module is only resolved by the development tsx process.
    const developmentServerModule = "./vite";
    const { setupVite }: typeof import("./vite") = await import(developmentServerModule);
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  Sentry.setupExpressErrorHandler(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err?.status || err?.statusCode || 500;
    const message = err?.message || "Internal Server Error";

    if (!res.headersSent) {
      res.status(status).json({ message });
    }

    console.error("Server error:", err);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);

    server.listen(
      {
        port,
        host: "0.0.0.0",
      },
      () => {
        log(`serving on port ${port}`);
        resolve();
      }
    );
  });

  startAuthorityScheduler();
  startBrokerCreditScheduler();
  startDatabaseBackupScheduler();
  import("./services/emailBroadcast")
    .then(m => m.startEmailBroadcastWorker())
    .catch(e => console.error("[emailBroadcast] startup error:", e?.message));
  import("./services/brokerCollections")
    .then(m => m.startBrokerCollectionsScheduler())
    .catch(e => console.warn("[brokerCollections] startup error:", e?.message));

  // Recover any jobs that were stuck in "queued"/"processing" before the restart
  recoverStuckOcrJobs().catch(e =>
    console.warn("[JobQueue] Startup recovery error:", e?.message)
  );

  import("./services/invoiceAgingEngine")
    .then(m => m.startInvoiceAgingScheduler())
    .catch(e => console.warn("[agingScheduler] startup error:", e?.message));
  import("./services/calendarScheduler")
    .then(m => m.startCalendarScheduler())
    .catch(e => console.warn("[calendarScheduler] startup error:", e?.message));

  import("./services/seedTemplates").then(m => m.seedDefaultTemplates()).catch(e =>
    console.warn("[templateSeed] error:", e?.message)
  );

  // Seed default document validation rules (no-op if already seeded)
  import("./services/docValidation").then(m => m.seedDocumentRules()).catch(e =>
    console.warn("[docValidation] seed error:", e?.message)
  );

  return server;
}

if (process.env.ELECTRON_RUN_AS_NODE !== "1") {
  startServer().catch(async (err) => {
    Sentry.captureException(err);
    console.error("Failed to start server:", err);
    await Sentry.flush(2000);
    process.exit(1);
  });
}