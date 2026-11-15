import { z } from "zod";

export const ANNOUNCEMENT_MAX_WORDS = 100;
export const ANNOUNCEMENT_PAGE_SIZE = 15;
export const ANNOUNCEMENT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
export const announcementSeverities = ["green", "amber", "red"] as const;
export type AnnouncementSeverity = typeof announcementSeverities[number];
export type AnnouncementView = "active" | "mine" | "pending" | "all";

export function announcementWordCount(message: string) {
  return message.trim() ? message.trim().split(/\s+/u).length : 0;
}

export const announcementInput = z.object({
  message: z.string().trim().min(1, "Enter an announcement.").max(10000, "Message is too long.")
    .refine(message => announcementWordCount(message) <= ANNOUNCEMENT_MAX_WORDS, "Announcements can contain up to 100 words."),
  severity: z.enum(announcementSeverities),
  persistent: z.boolean(),
}).strict();
export type AnnouncementInput = z.infer<typeof announcementInput>;
export const announcementVersion = z.object({ version: z.number().int().positive() }).strict();
export const announcementEdit = announcementInput.extend({ version: announcementVersion.shape.version });
export const announcementReview = announcementVersion.extend({ reason: z.string().trim().max(500).optional() });

export interface Announcement {
  id: number;
  authorId: string | null;
  authorName: string;
  message: string;
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
}

export interface AnnouncementPage {
  items: Announcement[];
  total: number;
  nextOffset: number | null;
  canReview: boolean;
}
