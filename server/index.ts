import express, { type Request, type Response, type NextFunction } from "express";
import session from "express-session";
import path from "path";
import fs from "fs";

import { registerRoutes } from "./routes";
import { setupVite } from "./vite";
import { serveStatic } from "./static";
import { log } from "./log";

const app = express();

const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET must be set in environment variables");
}

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);

app.use(express.json());
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

  return server;
}

if (process.env.ELECTRON_RUN_AS_NODE !== "1") {
  startServer().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}