import express, { type Request, type Response, type NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import path from "path";
import fs from "fs";

import { registerRoutes } from "./routes";
import { setupVite } from "./vite";
import { serveStatic } from "./static";
import { log } from "./log";
import { startAuthorityScheduler } from "./services/authorityScheduler";
import { recoverStuckOcrJobs } from "./services/jobQueue";
import { ensureDevAdmin } from "./services/devAdminBootstrap";
import { startBrokerCreditScheduler } from "./services/brokerCreditEngine";

const app = express();

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
const pgPool = new pg.Pool({ connectionString: process.env.NEON_DATABASE_URL });

const isProduction = process.env.NODE_ENV === "production";

app.use(
  session({
    store: new PgSession({
      pool: pgPool,
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

app.use(express.json({
  verify: (req, _res, buffer) => {
    if ((req as any).originalUrl.split("?")[0] === "/api/webhooks/sendgrid") {
      (req as any).rawBody = Buffer.from(buffer);
    }
  },
}));
app.use(express.urlencoded({ extended: false }));

app.use("/uploads", express.static(uploadsDir));

app.use((req, res, next) => {
  const start = Date.now();
  const reqPath = req.path;
  let capturedJsonResponse: Record<string, any> | undefined;

  const originalResJson = res.json.bind(res);
  res.json = function (bodyJson: any, ...args: any[]) {
    capturedJsonResponse = bodyJson;
    return originalResJson(bodyJson, ...(args as []));  
  } as typeof res.json;

  res.on("finish", () => {
    const duration = Date.now() - start;

    if (reqPath.startsWith("/api")) {
      let logLine = `${req.method} ${reqPath} ${res.statusCode} in ${duration}ms`;

      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 200) {
        logLine = `${logLine.slice(0, 199)}…`;
      }

      log(logLine);
    }
  });

  next();
});

export async function startServer(
  port = parseInt(process.env.PORT || "5000", 10)
) {
  await ensureDevAdmin();
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err?.status || err?.statusCode || 500;
    const message = err?.message || "Internal Server Error";

    if (!res.headersSent) {
      res.status(status).json({ message });
    }

    console.error("Server error:", err);
  });

  const isDev = process.env.NODE_ENV === "development";

  if (isDev) {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

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

  // Recover any jobs that were stuck in "queued"/"processing" before the restart
  recoverStuckOcrJobs().catch(e =>
    console.warn("[JobQueue] Startup recovery error:", e?.message)
  );

  import("./services/brokerFollowUpEngine")
    .then(m => m.startReminderScheduler())
    .catch(e => console.warn("[reminderScheduler] startup error:", e?.message));
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
  startServer().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}