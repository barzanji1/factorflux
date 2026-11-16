import { and, count, desc, eq, gt, isNull, or, type SQL } from "drizzle-orm";
import {
  ANNOUNCEMENT_LIFETIME_MS, ANNOUNCEMENT_PAGE_SIZE, announcementEdit, announcementInput,
  announcementReview, announcementVersion, announcementHeadline, type Announcement, type AnnouncementPage, type AnnouncementView,
} from "../../shared/announcements";
import { announcementDismissals, announcements, notifications, users } from "../../shared/schema";
import { db } from "../db";

export type AnnouncementStore = Pick<typeof db, "select" | "insert" | "update" | "delete" | "transaction">;
type Row = typeof announcements.$inferSelect;
type Actor = { id: string; role: string; name: string };
export class AnnouncementError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}
const reviewer = (actor: Actor) => actor.role === "admin" || actor.role === "manager";

async function getActor(userId: string, store: Pick<AnnouncementStore, "select">): Promise<Actor> {
  // Use current database role/status, not a possibly outdated session role.
  const [user] = await store.select({
    id: users.id, role: users.role, status: users.status, firstName: users.firstName, lastName: users.lastName,
  }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.status !== "active") throw new AnnouncementError(403, "An active staff account is required.");
  return { id: user.id, role: user.role, name: `${user.firstName || ""} ${user.lastName || ""}`.trim() || "Staff member" };
}

function present(row: Row, actor: Actor): Announcement {
  return {
    ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    headline: row.headline || announcementHeadline(row.message),
    postedAt: row.postedAt?.toISOString() ?? null, expiresAt: row.expiresAt?.toISOString() ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    canEdit: row.authorId === actor.id,
    canDelete: row.authorId === actor.id || actor.role === "admin",
    canManage: row.authorId === actor.id || actor.role === "admin",
  };
}

function contentOf(value: ReturnType<typeof announcementInput.parse>) {
  return {
    ...value,
    headline: value.headline || announcementHeadline(value.message),
    message: value.message || value.headline!,
  };
}

export async function getAnnouncement(userId: string, id: number, store: AnnouncementStore = db): Promise<Announcement> {
  const actor = await getActor(userId, store);
  const [row] = await store.select().from(announcements).where(eq(announcements.id, id)).limit(1);
  if (!row) throw new AnnouncementError(404, "This announcement was removed or does not exist.");
  if (row.authorId !== actor.id && !reviewer(actor) &&
      (row.status !== "approved" || (row.expiresAt && row.expiresAt <= new Date()))) {
    throw new AnnouncementError(410, "This announcement is no longer active.");
  }
  return present(row, actor);
}

function active(at: Date) {
  return and(eq(announcements.status, "approved"), or(isNull(announcements.expiresAt), gt(announcements.expiresAt, at)));
}

export async function listAnnouncements(
  userId: string, view: AnnouncementView, offset = 0, limit = ANNOUNCEMENT_PAGE_SIZE, store: AnnouncementStore = db,
): Promise<AnnouncementPage> {
  const actor = await getActor(userId, store);
  if ((view === "pending" || view === "all") && !reviewer(actor)) throw new AnnouncementError(403, "Only admins and managers can review announcements.");
  const conditions: (SQL | undefined)[] = [];
  if (view === "mine") conditions.push(eq(announcements.authorId, actor.id));
  if (view === "pending") conditions.push(eq(announcements.status, "pending"));
  // Team Announcements remain visible for everyone while active. Preserve old
  // dismissal rows for history, but do not personalize the shared banner feed.
  if (view === "active") conditions.push(active(new Date()));
  const where = and(...conditions);
  const [{ total }] = await store.select({ total: count() }).from(announcements).where(where);
  const rows = await store.select().from(announcements).where(where)
    .orderBy(
      desc(view === "active" ? announcements.postedAt : announcements.createdAt), desc(announcements.id),
    ).limit(limit).offset(offset);
  return {
    items: rows.map(row => present(row, actor)), total,
    nextOffset: offset + rows.length < total ? offset + rows.length : null, canReview: reviewer(actor),
  };
}

export type AnnouncementOperation = "create" | "edit" | "delete" | "dismiss" | "approve" | "reject";
export async function mutateAnnouncement(
  action: AnnouncementOperation, userId: string, input: unknown, id?: number, store: AnnouncementStore = db,
) {
  const value = action === "create" ? announcementInput.parse(input)
    : action === "edit" ? announcementEdit.parse(input)
    : action === "approve" || action === "reject" ? announcementReview.parse(input)
    : announcementVersion.parse(input);
  return store.transaction(async tx => {
    const actor = await getActor(userId, tx);
    const now = new Date();
    if (action === "create") {
      const content = contentOf(announcementInput.parse(value));
      const [row] = await tx.insert(announcements).values({
        ...content, authorId: actor.id, authorName: actor.name,
        status: "approved", postedAt: now,
        reviewedAt: null, reviewedBy: null,
        createdAt: now, updatedAt: now,
        expiresAt: content.persistent ? null : new Date(now.getTime() + ANNOUNCEMENT_LIFETIME_MS),
      }).returning();
      return present(row, actor);
    }
    const [row] = await tx.select().from(announcements).where(eq(announcements.id, id!)).for("update");
    if (!row) throw new AnnouncementError(404, "Announcement not found.");
    if (row.version !== (value as { version: number }).version) {
      throw new AnnouncementError(409, "This announcement changed. Refresh and try again.");
    }
    if (action === "dismiss") {
      if (row.status !== "approved" || (row.expiresAt && row.expiresAt <= now)) {
        throw new AnnouncementError(409, "This announcement is no longer live.");
      }
      await tx.insert(announcementDismissals).values({ announcementId: row.id, userId: actor.id })
        .onConflictDoNothing();
      return { success: true as const };
    }
    if (action === "approve" || action === "reject") {
      if (!reviewer(actor)) throw new AnnouncementError(403, "Only admins and managers can review announcements.");
      if (row.status !== "pending") throw new AnnouncementError(409, "This announcement has already been reviewed.");
      const approved = action === "approve";
      const reason = (value as { reason?: string }).reason || null;
      const [updated] = await tx.update(announcements).set({
        status: approved ? "approved" : "rejected", reviewedBy: actor.id, reviewedAt: now, updatedAt: now,
        postedAt: approved ? now : null, rejectionReason: approved ? null : reason, version: row.version + 1,
        expiresAt: row.persistent ? null : new Date(now.getTime() + ANNOUNCEMENT_LIFETIME_MS),
      }).where(eq(announcements.id, row.id)).returning();
      if (!approved && row.authorId) await tx.insert(notifications).values({
        userId: row.authorId, title: "Announcement rejected",
        message: `${actor.name} rejected your announcement.${reason ? ` Reason: ${reason}` : " You can edit and resubmit it from My submissions on your dashboard."}`,
        type: "warning", entityType: "announcement", entityId: row.id, actionUrl: "/?announcements=mine",
      });
      return present(updated, actor);
    }
    if (action === "delete") {
      if (row.authorId !== actor.id && actor.role !== "admin") {
        throw new AnnouncementError(403, "Only the author or an admin can remove this announcement.");
      }
      await tx.delete(announcements).where(eq(announcements.id, row.id));
      return { success: true as const };
    }
    if (row.authorId !== actor.id) throw new AnnouncementError(403, "Only the author can edit this announcement.");
    const { version: _version, ...parsed } = announcementEdit.parse(value);
    const content = contentOf(parsed);
    const firstPublication = row.status !== "approved" || !row.postedAt;
    const [updated] = await tx.update(announcements).set({
      ...content, status: "approved", updatedAt: now,
      postedAt: firstPublication ? now : row.postedAt, reviewedBy: null, reviewedAt: null,
      rejectionReason: null, version: row.version + 1,
      expiresAt: content.persistent ? null : firstPublication || row.persistent
        ? new Date(now.getTime() + ANNOUNCEMENT_LIFETIME_MS) : row.expiresAt,
    }).where(eq(announcements.id, row.id)).returning();
    // Keep legacy dismissal history; shared active banners do not use it.
    return present(updated, actor);
  });
}
