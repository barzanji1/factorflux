import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { users } from "@shared/schema";
import { ROLE_DEFAULT_PERMISSIONS } from "@shared/schema";

const DENIED_MESSAGE = "You don't have permission to access this resource";

function sessionUser(req: Request): any {
  return (req.session as any)?.user;
}

export async function auditAuthorizationDenial(req: Request, user: any, permission: string) {
  // Activities are the existing, durable audit trail. Logging is deliberately
  // best-effort: an unavailable audit table must never turn a 403 into a 500.
  try {
    await storage.createActivity({
      userId: user?.id,
      type: "permission_denied",
      description: `Permission denied: ${permission}`,
      entityType: "api",
      metadata: { method: req.method, path: req.originalUrl, permission },
    } as any);
  } catch (error) {
    console.warn("[permissions] denial audit failed:", error instanceof Error ? error.message : "unknown error");
  }
}

// Short alias for route-specific authorization middleware.
export const auditDenial = auditAuthorizationDenial;

export async function authenticateCurrentUser(req: Request, res: Response, next: NextFunction) {
  const stored = sessionUser(req);
  if (!stored?.id) return res.status(401).json({ message: "Authentication required" });

  try {
    const [current] = await db.select().from(users).where(eq(users.id, stored.id)).limit(1);
    if (!current) return res.status(401).json({ message: "Authentication required" });
    if (current.status === "suspended") {
      return res.status(403).json({ message: "Your account has been suspended. Contact your administrator." });
    }
    if (current.status === "inactive") {
      return res.status(403).json({ message: "This account has been deactivated." });
    }
    const user = {
      ...stored,
      id: current.id,
      username: current.email || current.id,
      name: `${current.firstName || ""} ${current.lastName || ""}`.trim(),
      role: current.role,
      firstName: current.firstName || "",
      lastName: current.lastName || "",
      verified: current.verified ?? false,
      profileImageUrl: current.profileImageUrl || "",
    };
    (req.session as any).user = user;
    (req as any).user = user;
    next();
  } catch (error) {
    console.error("[auth] current user lookup failed:", error);
    return res.status(500).json({ message: "Unable to verify authentication" });
  }
}

export function requirePermission(permission: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    await authenticateCurrentUser(req, res, async () => {
      const user = (req as any).user;
      if (user.role === "admin") return next();
      if (user.role === "employee" && req.path.startsWith("/admin")) {
        await auditAuthorizationDenial(req, user, "admin");
        return res.status(403).json({ message: DENIED_MESSAGE });
      }
      try {
        const cache = ((req as any).__permissionCache ??= new Map<string, string[]>()) as Map<string, string[]>;
        let permissions = cache.get(user.id);
        if (!permissions) {
          permissions = await storage.getUserPermissions(user.id);
          if (!permissions.length) permissions = ROLE_DEFAULT_PERMISSIONS[user.role] ?? ROLE_DEFAULT_PERMISSIONS.employee;
          cache.set(user.id, permissions);
        }
        if (!permissions.includes(permission)) {
          await auditAuthorizationDenial(req, user, permission);
          return res.status(403).json({ message: DENIED_MESSAGE });
        }
        return next();
      } catch (error) {
        console.error("[permissions] lookup failed:", error);
        return res.status(500).json({ message: "Unable to verify permission" });
      }
    });
  };
}

export function requireAnyPermission(permissions: readonly string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    await authenticateCurrentUser(req, res, async () => {
      const user = (req as any).user;
      if (user.role === "admin") return next();
      if (user.role === "employee" && req.path.startsWith("/admin")) {
        await auditAuthorizationDenial(req, user, "any:" + permissions.join(","));
        return res.status(403).json({ message: DENIED_MESSAGE });
      }
      try {
        const cache = ((req as any).__permissionCache ??= new Map<string, string[]>()) as Map<string, string[]>;
        let granted = cache.get(user.id);
        if (!granted) {
          granted = await storage.getUserPermissions(user.id);
          if (!granted.length) granted = ROLE_DEFAULT_PERMISSIONS[user.role] ?? ROLE_DEFAULT_PERMISSIONS.employee;
          cache.set(user.id, granted);
        }
        if (!permissions.some((permission) => granted!.includes(permission))) {
          await auditAuthorizationDenial(req, user, "any:" + permissions.join(","));
          return res.status(403).json({ message: DENIED_MESSAGE });
        }
        return next();
      } catch (error) {
        console.error("[permissions] lookup failed:", error);
        return res.status(500).json({ message: "Unable to verify permission" });
      }
    });
  };
}

export { DENIED_MESSAGE };