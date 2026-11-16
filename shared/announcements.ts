import { z } from "zod";

export const ANNOUNCEMENT_MAX_WORDS = 50;
export const ANNOUNCEMENT_HEADLINE_MAX_WORDS = 25;
export const ANNOUNCEMENT_PAGE_SIZE = 15;
export const ANNOUNCEMENT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const announcementSeverities = ["green", "amber", "red"] as const;
export type AnnouncementSeverity = typeof announcementSeverities[number];
export const announcementHighlights = ["teal", "green", "amber", "red", "blue", "purple"] as const;
export type AnnouncementHighlight = typeof announcementHighlights[number];
export type AnnouncementView = "active" | "mine" | "pending" | "all";

export function announcementWordCount(message: string) {
  return message.trim() ? message.trim().split(/\s+/u).length : 0;
}

export function announcementHeadline(message: string) {
  return message.trim().split(/\s+/u).slice(0, ANNOUNCEMENT_HEADLINE_MAX_WORDS).join(" ");
}
const fields = z.object({
  headline: z.string().trim().min(1, "Enter a headline.").max(1000)
    .refine(value => announcementWordCount(value) <= ANNOUNCEMENT_HEADLINE_MAX_WORDS, "Headlines can contain up to 25 words.").optional(),
  message: z.string().trim().max(10000, "Message is too long.")
    .refine(message => announcementWordCount(message) <= ANNOUNCEMENT_MAX_WORDS, "Announcements can contain up to 50 words.").default(""),
  severity: z.enum(announcementSeverities).default("green"),
  highlightColor: z.enum(announcementHighlights).nullable().default(null),
  persistent: z.boolean().default(true),
}).strict();
const hasContent = (value: { headline?: string; message: string }) => !!(value.headline || value.message);
const withinTotalLimit = (value: { headline?: string; message: string }) => {
  const body = value.message.trim().split(/\s+/u).filter(Boolean);
  const title = value.headline?.trim().split(/\s+/u).filter(Boolean) ?? [];
  // A banner excerpt is not additional content; a distinct custom title is.
  const excerpt = title.every((word, index) => body[index] === word);
  return body.length + (excerpt ? 0 : title.length) <= ANNOUNCEMENT_MAX_WORDS;
};
export const announcementInput = fields.refine(hasContent, "Enter an announcement.")
  .refine(withinTotalLimit, "Announcements can contain up to 50 words.");
export type AnnouncementInput = z.input<typeof announcementInput>;
export const announcementVersion = z.object({ version: z.number().int().positive() }).strict();
export const announcementEdit = fields.extend({ version: announcementVersion.shape.version })
  .refine(hasContent, "Enter an announcement.").refine(withinTotalLimit, "Announcements can contain up to 50 words.");
export const announcementReview = announcementVersion.extend({ reason: z.string().trim().max(500).optional() });

export interface Announcement {
  id: number;
  authorId: string | null;
  authorName: string;
  message: string;
  headline: string;
  highlightColor: AnnouncementHighlight | null;
  severity: AnnouncementSeverity;
  status: "pending" | "approved" | "rejected";
  persistent: boolean;
  createdAt: string;
  updatedAt: string;
  postedAt: string | null;
  expiresAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  rejectionReason: string | null;
  version: number;
  canManage: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export interface AnnouncementPage {
  items: Announcement[];
  total: number;
  nextOffset: number | null;
  canReview: boolean;
}
