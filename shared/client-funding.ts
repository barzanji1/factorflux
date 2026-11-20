export const FUNDING_STEPS = ["received", "under_review", "funded"] as const;
export type FundingStep = typeof FUNDING_STEPS[number];
export interface ClientFundingProgress {
  submissionId: number;
  invoiceId: number | null;
  number: string;
  fundingStatus: FundingStep;
  step1ReceivedAt: string;
  step2ReviewedAt: string | null;
  step3FundedAt: string | null;
  stepChangedBy: string | null;
  fundingVerified: boolean;
  verifiedFundedAt: string | null;
  fundedAmount: string | null;
  canUpdate: boolean;
  history: Array<{ id: number; from: FundingStep; to: FundingStep; reason: string | null; actorName: string; changedAt: string }>;
}
export interface ClientSubmissionNote {
  id: number;
  message: string;
  senderType: "client" | "staff";
  authorName: string;
  createdAt: string;
}
export interface ClientPage<T> { items: T[]; total: number; page: number; pageSize: number }
