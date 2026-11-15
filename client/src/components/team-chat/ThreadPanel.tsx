import type { MessageMention } from "./MessageBody";

export type ChatMessage = {
  id: string | number;
  channelId: string | number;
  senderId: string | number;
  senderName: string;
  senderProfileImageUrl?: string | null;
  body: string;
  createdAt: string;
  parentMessageId: number | null;
  mentions: MessageMention[];
  replyCount: number;
  editedAt?: string | null;
  latestReply?: { id: string | number; body: string; senderName: string; senderProfileImageUrl?: string | null; createdAt: string } | null;
};
