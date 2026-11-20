import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "../db";
import { sendEmail } from "../emailService";
import { wrapEmail, escapeEmailHtml } from "../emailTemplate.js";
import { BROKER_PUBLIC_ORIGIN } from "./brokerConfirmationPresentation";
import type { BrokerPortalAccount } from "../../shared/broker-portal";

export class BrokerPortalError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const portalEmail = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(12, "Use at least 12 characters.").max(72, "Use at most 72 characters.")
  .refine(value => Buffer.byteLength(value) <= 72, "Password must be at most 72 UTF-8 bytes.");
export const registration = z.object({
  companyName: z.string().trim().min(1).max(200),
  contactName: z.string().trim().min(1).max(150),
  email: portalEmail, phone: z.string().trim().min(5).max(40), password,
});
export const loginInput = z.object({ email: portalEmail, password: z.string().min(1).max(200) });
export const GENERIC_MAIL_MESSAGE = "If this email uniquely matches an eligible broker contact, we’ll email the next step. Check your inbox and spam folder.";
const tokenValue = () => randomBytes(32).toString("hex");
export const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");
const validToken = (value: string) => /^[a-f0-9]{64}$/.test(value);
const SESSION_MS = 8 * 60 * 60 * 1000;
type PortalRow = {
  id: number; broker_id: number; company_name: string; contact_name: string;
  email: string; password_hash: string | null; verified_at: Date | null; disabled: boolean;
};
export type BrokerIdentity = BrokerPortalAccount & { brokerId: number };
const secret = () => {
  if (!process.env.SESSION_SECRET) throw new Error("Session signing is not configured");
  return process.env.SESSION_SECRET;
};
export const portalCsrf = (token: string) => createHmac("sha256", secret()).update(`broker-csrf/${token}`).digest("hex");
export function validPortalCsrf(token: string, supplied: unknown) {
  if (typeof supplied !== "string" || !validToken(supplied)) return false;
  return timingSafeEqual(Buffer.from(portalCsrf(token)), Buffer.from(supplied));
}
export async function brokerPortalTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { await client.query("BEGIN"); const value = await work(client); await client.query("COMMIT"); return value; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
async function eligibleBroker(client: Pick<PoolClient, "query">, email: string) {
  const result = await client.query("SELECT id,name,status FROM brokers WHERE lower(btrim(email))=$1 ORDER BY id LIMIT 2", [email]);
  return result.rows.length === 1 && result.rows[0].status === "active" ? result.rows[0] as { id: number; name: string } : null;
}
export async function portalRateLimit(action: string, key: string, limit: number, windowMs = 3_600_000) {
  const bucket = createHmac("sha256", secret()).update(`${action}/${key}`).digest("hex");
  const allowed = await brokerPortalTransaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`broker-limit/${bucket}`]);
    await client.query("DELETE FROM broker_portal_rate_limits WHERE bucket=$1 AND requested_at < $2", [bucket, new Date(Date.now() - windowMs)]);
    const result = await client.query("SELECT count(*)::int AS n FROM broker_portal_rate_limits WHERE bucket=$1", [bucket]);
    if (result.rows[0].n >= limit) return false;
    await client.query("INSERT INTO broker_portal_rate_limits(bucket) VALUES($1)", [bucket]);
    return true;
  });
  if (!allowed) throw new BrokerPortalError(429, "Too many attempts. Please try again later.");
}
async function issueToken(client: PoolClient, id: number, purpose: "verify" | "magic", now: Date) {
  const token = tokenValue();
  await client.query("UPDATE broker_portal_tokens SET consumed_at=$3 WHERE portal_user_id=$1 AND purpose=$2 AND consumed_at IS NULL", [id, purpose, now]);
  await client.query("INSERT INTO broker_portal_tokens(token_hash,portal_user_id,purpose,expires_at) VALUES($1,$2,$3,$4)",
    [tokenHash(token), id, purpose, new Date(+now + 15 * 60 * 1000)]);
  return token;
}
async function issueSession(client: PoolClient, id: number, now: Date) {
  const token = tokenValue();
  await client.query("DELETE FROM broker_portal_sessions WHERE expires_at <= $1", [now]);
  await client.query("INSERT INTO broker_portal_sessions(token_hash,portal_user_id,expires_at) VALUES($1,$2,$3)",
    [tokenHash(token), id, new Date(+now + SESSION_MS)]);
  return token;
}
export function createBrokerPortalAuth({ send = sendEmail, now = () => new Date() } = {}) {
  async function mail(email: string, token: string, purpose: "verify" | "magic") {
    const route = purpose === "verify" ? "verify" : "magic";
    const url = `${BROKER_PUBLIC_ORIGIN}/broker/${route}?token=${token}`;
    const subject = purpose === "verify" ? "Verify your Broker Portal email" : "Your Broker Portal sign-in link";
    const sent = await send({
      to: email, subject,
      text: `${subject}. This private link expires in 15 minutes and can be used once. If you did not request it, ignore this email.\n${url}`,
      html: wrapEmail(subject, `<p>This private link expires in 15 minutes and can be used once.</p><p><a href="${escapeEmailHtml(url)}">Continue to the Broker Portal</a></p><p>If you did not request this, ignore this email.</p>`),
      emailLog: { templateName: `broker_portal_${purpose}` },
    });
    if (!sent) {
      await pool.query("DELETE FROM broker_portal_tokens WHERE token_hash=$1", [tokenHash(token)]);
      throw new BrokerPortalError(503, "We couldn’t send the email. Please try again later.");
    }
  }
  async function register(input: unknown) {
    const value = registration.parse(input);
    // An email advisory lock serializes re-registration with verification.
    const passwordHash = await bcrypt.hash(value.password, 12);
    const token = await brokerPortalTransaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`broker-account/${value.email}`]);
      const broker = await eligibleBroker(client, value.email);
      if (!broker) return null;
      const existing = await client.query<PortalRow>("SELECT * FROM broker_portal_users WHERE email=$1 FOR UPDATE", [value.email]);
      if (existing.rows[0]?.verified_at || existing.rows[0]?.disabled) return null;
      const result = await client.query<{ id: number }>(`INSERT INTO broker_portal_users(broker_id,company_name,contact_name,email,phone,password_hash)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(email) DO UPDATE SET broker_id=EXCLUDED.broker_id,company_name=EXCLUDED.company_name,
        contact_name=EXCLUDED.contact_name,phone=EXCLUDED.phone,password_hash=EXCLUDED.password_hash RETURNING id`,
      [broker.id, value.companyName, value.contactName, value.email, value.phone, passwordHash]);
      return issueToken(client, result.rows[0].id, "verify", now());
    });
    if (token) await mail(value.email, token, "verify");
    return { message: GENERIC_MAIL_MESSAGE };
  }
  async function magic(emailInput: unknown) {
    const email = portalEmail.parse(emailInput);
    const token = await brokerPortalTransaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`broker-account/${email}`]);
      const broker = await eligibleBroker(client, email);
      if (!broker) return null;
      const row = await client.query<PortalRow>("SELECT * FROM broker_portal_users WHERE email=$1 AND broker_id=$2 AND disabled=false AND verified_at IS NOT NULL FOR UPDATE", [email, broker.id]);
      return row.rows[0] ? issueToken(client, row.rows[0].id, "magic", now()) : null;
    });
    if (token) await mail(email, token, "magic");
    return { message: GENERIC_MAIL_MESSAGE };
  }
  async function redeem(token: string, purpose: "verify" | "magic", suppliedPassword?: string) {
    if (!validToken(token)) throw new BrokerPortalError(400, "This link is invalid or has expired.");
    return brokerPortalTransaction(async client => {
      // Lock the account before token rows, matching registration's lock order.
      const lookup = await client.query<{ email: string }>("SELECT u.email FROM broker_portal_tokens t JOIN broker_portal_users u ON u.id=t.portal_user_id WHERE t.token_hash=$1", [tokenHash(token)]);
      if (!lookup.rows[0]) throw new BrokerPortalError(400, "This link is invalid or has expired.");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`broker-account/${lookup.rows[0].email}`]);
      const result = await client.query<PortalRow & { expires_at: Date; consumed_at: Date | null; purpose: string }>(
        `SELECT u.*,t.expires_at,t.consumed_at,t.purpose FROM broker_portal_tokens t JOIN broker_portal_users u ON u.id=t.portal_user_id
         WHERE t.token_hash=$1 FOR UPDATE OF u,t`, [tokenHash(token)]);
      const row = result.rows[0];
      if (!row || row.disabled || row.purpose !== purpose || row.consumed_at || +row.expires_at <= +now())
        throw new BrokerPortalError(400, "This link is invalid or has expired.");
      const broker = await eligibleBroker(client, row.email);
      if (!broker || broker.id !== row.broker_id) throw new BrokerPortalError(401, "Your broker contact must be verified by Trucking Pros Financial.");
      if (purpose === "verify" && (!row.password_hash || !suppliedPassword || !await bcrypt.compare(suppliedPassword, row.password_hash)))
        throw new BrokerPortalError(400, "Enter the password you used when registering.");
      if (purpose === "magic" && !row.verified_at) throw new BrokerPortalError(400, "Verify your email before signing in.");
      await client.query("UPDATE broker_portal_tokens SET consumed_at=$2 WHERE token_hash=$1", [tokenHash(token), now()]);
      await client.query("UPDATE broker_portal_users SET verified_at=coalesce(verified_at,$2) WHERE id=$1", [row.id, now()]);
      return issueSession(client, row.id, now());
    });
  }
  async function login(input: unknown) {
    const value = loginInput.parse(input);
    const found = await pool.query<PortalRow>("SELECT * FROM broker_portal_users WHERE email=$1", [value.email]);
    const row = found.rows[0];
    // Compare against a real-cost dummy hash for unknown emails too.
    const hash = row?.password_hash ?? "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxIv.UHrROG7PSUrD8W90mkH1ru";
    const correct = await bcrypt.compare(value.password, hash);
    if (!row || !correct || !row.verified_at || row.disabled) throw new BrokerPortalError(401, "Invalid credentials or email not yet verified.");
    return brokerPortalTransaction(async client => {
      const broker = await eligibleBroker(client, row.email);
      if (!broker || broker.id !== row.broker_id) throw new BrokerPortalError(401, "Your broker contact must be verified by Trucking Pros Financial.");
      return issueSession(client, row.id, now());
    });
  }
  return { register, magic, redeem, login };
}
export const brokerPortalAuth = createBrokerPortalAuth();
export async function brokerIdentity(token: string): Promise<BrokerIdentity> {
  if (!validToken(token)) throw new BrokerPortalError(401, "Please sign in to the Broker Portal.");
  const result = await pool.query(`SELECT u.id,u.broker_id AS "brokerId",u.company_name AS "companyName",u.contact_name AS "contactName",
    u.email,b.name AS "brokerName" FROM broker_portal_sessions s JOIN broker_portal_users u ON u.id=s.portal_user_id
    JOIN brokers b ON b.id=u.broker_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.verified_at IS NOT NULL AND NOT u.disabled
    AND b.status='active' AND lower(btrim(b.email))=u.email
    AND (SELECT count(*) FROM brokers b2 WHERE lower(btrim(b2.email))=u.email)=1`, [tokenHash(token)]);
  if (!result.rows[0]) throw new BrokerPortalError(401, "Please sign in to the Broker Portal.");
  return result.rows[0];
}
export async function revokeBrokerSession(token: string) {
  if (validToken(token)) await pool.query("DELETE FROM broker_portal_sessions WHERE token_hash=$1", [tokenHash(token)]);
}
