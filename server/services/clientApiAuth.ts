import { createHash, createHmac, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import { z } from "zod";
import type { RequestHandler } from "express";
import { pool } from "../db";
import { sendEmail } from "../emailService";
import { escapeEmailHtml, wrapEmail } from "../emailTemplate.js";
import { PRODUCTION_APP_URL } from "../../shared/production-urls.js";
import { ClientApiError, clientTransaction } from "./clientApiCommon";

const email = z.string().trim().toLowerCase().email().max(254);
export const clientCredentials = z.object({ email, password: z.string().min(1).max(256) }).strict();
const registration = z.object({
  companyName: z.string().trim().min(1).max(250), contactName: z.string().trim().min(1).max(160),
  email, phone: z.string().trim().min(7).max(30),
  mcNumber: z.string().trim().regex(/^(?:MC[-\s]*)?\d{1,10}$/i).transform(v => v.replace(/\D/g, "")),
  password: z.string().min(12).refine(v => Buffer.byteLength(v, "utf8") <= 72, "Password exceeds 72 bytes."),
}).strict();
const ISSUER = "tpf-client-auth", AUDIENCE = "tpf-client-api";
function key() {
  if (!process.env.SESSION_SECRET) throw new ClientApiError(503, "Client authentication is not configured.");
  // Domain separation: never use the staff session signing key directly as a JWT key.
  return new Uint8Array(hkdfSync("sha256", process.env.SESSION_SECRET, "TPF", "client-api-jwt-v1", 32));
}
const fingerprint = (hash: string) => createHmac("sha256", key()).update(`credentials:${hash}`).digest("hex");
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export interface ClientIdentity { id: number; carrierId: number; email: string; companyName: string; contactName: string | null }
async function authorizedBinding(user: any, tx: Pick<typeof pool, "query"> = pool) {
  const result = await tx.query(`SELECT (
    EXISTS(SELECT 1 FROM users WHERE id=$3 AND role='admin') OR (
      (SELECT count(*) FROM clients WHERE lower(btrim(email))=$2)=1
      AND EXISTS(SELECT 1 FROM clients WHERE id=$1 AND lower(btrim(email))=$2)
    )) AS allowed`, [user.carrier_id, user.email.trim().toLowerCase(), user.reviewed_by]);
  return !!result.rows[0]?.allowed;
}

export async function consumeClientRegistrationAttempt(ip: string) {
  const ipHash = createHmac("sha256", key()).update(`client-registration-ip:${ip}`).digest("hex");
  const allowed = await clientTransaction(async tx => {
    await tx.query("SELECT pg_advisory_xact_lock(747336,hashtext($1))", [ipHash]);
    await tx.query("DELETE FROM client_registration_attempts WHERE ip_hash=$1 AND attempted_at<now()-interval '1 hour'", [ipHash]);
    const count = await tx.query("SELECT count(*)::int AS n FROM client_registration_attempts WHERE ip_hash=$1", [ipHash]);
    if (count.rows[0].n >= 3) return false;
    await tx.query("INSERT INTO client_registration_attempts(ip_hash) VALUES($1)", [ipHash]);
    return true;
  });
  if (!allowed) throw new ClientApiError(429, "Maximum three registration attempts per hour. Please try later.");
}

type VerificationSender = (email: string, token: string) => Promise<boolean>;
async function verificationEmail(to: string, token: string) {
  if (process.env.NODE_ENV !== "production") return false;
  const url = new URL("/api/client/verify-email", PRODUCTION_APP_URL); url.searchParams.set("token", token);
  return sendEmail({
    to, subject: "Verify your Trucking Pros Financial carrier account",
    text: `Verify your email using this link within one hour: ${url.href}\nIf you did not register, ignore this message.`,
    html: wrapEmail("Verify your carrier account", `<p>Verify your email to continue with Trucking Pros Financial.</p><p><a href="${escapeEmailHtml(url.href)}">Verify email</a></p><p>This link expires in one hour. If you did not register, ignore this message.</p>`),
  });
}
export function createClientAuth(sendVerification: VerificationSender = verificationEmail) {
  async function issueVerification(id: number, address: string) {
    const token = randomBytes(32).toString("base64url");
    await clientTransaction(async tx => {
      await tx.query("SELECT id FROM carrier_portal_users WHERE id=$1 FOR UPDATE", [id]);
      await tx.query("UPDATE client_email_verifications SET used_at=now() WHERE portal_user_id=$1 AND used_at IS NULL", [id]);
      await tx.query("INSERT INTO client_email_verifications(token_hash,portal_user_id,email,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')", [hashToken(token), id, address]);
    });
    let sent = false; try { sent = await sendVerification(address, token); } catch { /* Explicitly reported; never log bearer links or provider responses. */ }
    return { verificationEmailSent: sent, ...(!sent ? { deliveryNotice: "Account requires verification. Verification email was not sent; retry from the published service." } : {}) };
  }
  async function register(input: unknown) {
    const data = registration.parse(input), passwordHash = await bcrypt.hash(data.password, 12);
    const account = await clientTransaction(async tx => {
      await tx.query("SELECT pg_advisory_xact_lock(747337,hashtext($1))", [data.email]);
      if ((await tx.query("SELECT id FROM carrier_portal_users WHERE lower(btrim(email))=$1 LIMIT 1", [data.email])).rowCount)
        throw new ClientApiError(409, "An account already exists. Use your carrier credentials and request email verification.");
      const result = await tx.query(`INSERT INTO carrier_portal_users(email,password_hash,company_name,client_contact_name,phone,mc_number,status)
        VALUES($1,$2,$3,$4,$5,$6,'pending') RETURNING id`, [data.email, passwordHash, data.companyName, data.contactName, data.phone, data.mcNumber]);
      return result.rows[0];
    });
    return { id: account.id, status: "pending", message: "Verify your email. Matching contacts activate automatically; other accounts require admin approval.",
      ...await issueVerification(account.id, data.email) };
  }
  async function resend(input: unknown) {
    const data = clientCredentials.parse(input);
    const user = (await pool.query("SELECT * FROM carrier_portal_users WHERE lower(btrim(email))=$1 LIMIT 2", [data.email])).rows;
    if (user.length !== 1 || !await bcrypt.compare(data.password, user[0].password_hash))
      throw new ClientApiError(401, "Invalid email or password.");
    if (["suspended", "rejected"].includes(user[0].status)) throw new ClientApiError(403, "Account access is disabled.");
    return issueVerification(user[0].id, data.email);
  }
  async function verify(token: unknown) {
    const value = z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(token);
    return clientTransaction(async tx => {
      const challenge = (await tx.query(`SELECT * FROM client_email_verifications
        WHERE token_hash=$1 AND expires_at>now() FOR UPDATE`, [hashToken(value)])).rows[0];
      if (!challenge || challenge.used_at) throw new ClientApiError(410, "This verification link is expired or already used.");
      const user = (await tx.query("SELECT * FROM carrier_portal_users WHERE id=$1 FOR UPDATE", [challenge.portal_user_id])).rows[0];
      if (!user || user.email.trim().toLowerCase() !== challenge.email || ["suspended", "rejected"].includes(user.status))
        throw new ClientApiError(403, "This account cannot be verified.");
      const matches = (await tx.query(`SELECT id,mc_number FROM clients WHERE lower(btrim(email))=$1 LIMIT 2 FOR UPDATE`, [challenge.email])).rows;
      // Email ownership, not the publicly knowable MC number, determines which
      // existing carrier may be activated automatically.
      // Verification must never silently move an existing portal account (and
      // its legacy session/history) to a different carrier.
      const match = matches.length === 1 && (!user.carrier_id || user.carrier_id === matches[0].id) ? matches[0] : null;
      if (match) {
        const occupied = await tx.query("SELECT id FROM carrier_portal_users WHERE carrier_id=$1 AND status='active' AND id<>$2 LIMIT 1", [match.id, user.id]);
        if (occupied.rowCount) throw new ClientApiError(409, "This carrier already has an active account. Contact TPF for assistance.");
      }
      // Existing admin approval remains authoritative; a newly unmatched
      // account stays pending even after proving ownership of its own email.
      const approved = user.status === "active" && user.reviewed_by && user.carrier_id && await authorizedBinding(user, tx);
      const active = Boolean(match || approved);
      await tx.query(`UPDATE carrier_portal_users SET client_email_verified_at=now(),
         carrier_id=COALESCE($2,carrier_id),status=$3 WHERE id=$1`,
      [user.id, match?.id ?? null, active || user.status === "active" ? "active" : "pending"]);
      await tx.query("UPDATE client_email_verifications SET used_at=now() WHERE token_hash=$1", [challenge.token_hash]);
      return { status: active ? "active" : "pending", message: active ? "Email verified. Your carrier account is active." : "Email verified. Your account requires admin approval." };
    });
  }
  async function login(input: unknown) {
    const data = clientCredentials.parse(input);
    const matches = (await pool.query("SELECT * FROM carrier_portal_users WHERE lower(btrim(email))=$1 LIMIT 2", [data.email])).rows;
    const user = matches.length === 1 ? matches[0] : null;
    const valid = user ? await bcrypt.compare(data.password, user.password_hash) : await bcrypt.compare(data.password, "$2a$12$QdfSSMsf7WZxCf9rQXJTuOOVZrR0VrbAQ8j.5aO5vm4FhV7XjIkgK");
    if (!user || !valid) throw new ClientApiError(401, "Invalid email or password.");
    if (!user.client_email_verified_at) throw new ClientApiError(403, "Verify your carrier contact email before signing in.", { requiresVerification: true });
    if (user.status !== "active" || !user.carrier_id || !await authorizedBinding(user)) throw new ClientApiError(403, "Your account is pending admin approval or access is disabled.");
    const token = await new SignJWT({ carrierId: user.carrier_id, credentialVersion: fingerprint(user.password_hash) })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" }).setSubject(String(user.id)).setIssuer(ISSUER).setAudience(AUDIENCE)
      .setIssuedAt().setExpirationTime("1h").setJti(randomUUID()).sign(key());
    await pool.query("UPDATE carrier_portal_users SET last_login_at=now() WHERE id=$1", [user.id]);
    return { token, tokenType: "Bearer", expiresIn: 3600, client: { id: user.id, carrierId: user.carrier_id, companyName: user.company_name } };
  }
  return { register, login, verify, resend };
}

export const requireClientJwt: RequestHandler = async (req: any, res, next) => {
  try {
    const match = /^Bearer ([A-Za-z0-9_.-]{1,4096})$/.exec(req.get("authorization") || "");
    if (!match) throw new ClientApiError(401, "Client bearer token required.");
    const { payload, protectedHeader } = await jwtVerify(match[1], key(), { algorithms: ["HS256"], issuer: ISSUER, audience: AUDIENCE, maxTokenAge: "1h" });
    if (protectedHeader.typ !== "JWT" || !/^[1-9]\d{0,9}$/.test(payload.sub || "")) throw new ClientApiError(401, "Invalid client token.");
    const user = (await pool.query("SELECT * FROM carrier_portal_users WHERE id=$1", [Number(payload.sub)])).rows[0];
    if (!user || user.status !== "active" || !user.client_email_verified_at || !user.carrier_id ||
      user.carrier_id !== payload.carrierId || fingerprint(user.password_hash) !== payload.credentialVersion || !await authorizedBinding(user))
      throw new ClientApiError(401, "Client access expired or revoked.");
    req.clientUser = { id: user.id, carrierId: user.carrier_id, email: user.email, companyName: user.company_name, contactName: user.client_contact_name } satisfies ClientIdentity;
    next();
  } catch (error) {
    const unavailable = !(error instanceof joseErrors.JOSEError) && !(error instanceof ClientApiError && error.status === 401);
    res.status(unavailable ? 503 : 401).json({ message: unavailable ? "Client authentication is not configured." : "A valid client bearer token is required." });
  }
};
