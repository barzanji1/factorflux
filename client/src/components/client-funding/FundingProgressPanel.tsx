import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowDown, Check, Clock3, MessageSquareText, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { NeuBadge, NeuButton, NeuCard, NeuInput, NeuTextarea } from "@/styles/neu/components";
import type { ClientFundingProgress, ClientPage, ClientSubmissionNote, FundingStep } from "@shared/client-funding";

export interface FundingProgressPanelProps {
  submissionId?: number;
  invoiceId?: number;
}

const STEP_ORDER: FundingStep[] = ["received", "under_review", "funded"];
const STEP_DETAILS: Record<FundingStep, { label: string; description: string }> = {
  received: { label: "Received", description: "Paperwork received" },
  under_review: { label: "Under Review", description: "Paperwork is being verified" },
  funded: { label: "Funded", description: "Funding progress verified" },
};

function formatDate(value?: string | null) {
  if (!value) return "Not yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not yet"
    : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function errorText(error: unknown) {
  if (error instanceof Error) {
    const status = "status" in error ? Number((error as Error & { status?: number }).status) : 0;
    if (status === 409) return "This progress changed elsewhere. Refresh to load the latest status before trying again.";
    return error.message || "The request could not be completed. Please try again.";
  }
  return "The request could not be completed. Please try again.";
}

async function readProgress(path: string) {
  const response = await apiRequest("GET", path);
  return (await response.json()) as { progress: ClientFundingProgress | null };
}

async function readNotes(submissionId: number, page: number) {
  const response = await apiRequest("GET", `/api/internal/submissions/${submissionId}/notes?page=${page}`);
  return (await response.json()) as ClientPage<ClientSubmissionNote>;
}

function StepTimeline({ progress }: { progress: ClientFundingProgress }) {
  const currentIndex = STEP_ORDER.indexOf(progress.fundingStatus);
  const timestamps: Record<FundingStep, string | null> = {
    received: progress.step1ReceivedAt,
    under_review: progress.step2ReviewedAt,
    funded: progress.step3FundedAt,
  };

  return (
    <ol aria-label="Client funding progress" className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-0">
      {STEP_ORDER.map((step, index) => {
        const complete = index <= currentIndex;
        const tone = step === "received" ? "border-[#b95454] bg-[#f5e5e5] text-[#963f3f]"
          : step === "under_review" ? "border-[#c79b42] bg-[#f4eddb] text-[#80621f]"
          : "border-[#57927b] bg-[#e2eee8] text-[#326c56]";
        return (
          <li key={step} className="relative min-w-0 sm:px-3 first:sm:pl-0 last:sm:pr-0">
            {index < STEP_ORDER.length - 1 && (
              <span aria-hidden="true" className={`absolute left-[1.15rem] top-6 hidden h-px w-[calc(100%-1rem)] sm:block ${index < currentIndex ? "bg-[#8aa99a]" : "bg-[#c7c7c7]"}`} />
            )}
            <div className="relative flex items-start gap-3 sm:flex-col sm:gap-2">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-bold ${complete ? tone : "border-[#c8c8c8] bg-[#e0e0e0] text-[#888]"}`}>
                {complete ? <Check className="h-4 w-4" aria-hidden="true" /> : index + 1}
              </span>
              <span className="min-w-0 pt-0.5 sm:pt-0">
                <span className={`block text-sm font-semibold ${complete ? "text-[#333]" : "text-[#777]"}`}>{STEP_DETAILS[step].label}</span>
                <span className="mt-0.5 block text-xs text-[#777]">
                  {timestamps[step] ? formatDate(timestamps[step]) : `Not yet · ${STEP_DETAILS[step].description}`}
                </span>
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function FundingNotes({ submissionId, canUpdate }: { submissionId: number; canUpdate: boolean }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState("");
  const notesKey = ["/api/internal/submissions", submissionId, "notes", page] as const;
  const notesQuery = useQuery({
    queryKey: notesKey,
    queryFn: () => readNotes(submissionId, page),
    staleTime: 10000,
    refetchInterval: 15000,
  });
  const sendNote = useMutation({
    mutationFn: async (text: string) => {
      const response = await apiRequest("POST", `/api/internal/submissions/${submissionId}/notes`, { message: text });
      return response.json() as Promise<ClientSubmissionNote>;
    },
    onSuccess: async () => {
      setMessage("");
      setPage(1);
      await queryClient.invalidateQueries({ queryKey: ["/api/internal/submissions", submissionId, "notes"] });
    },
  });
  const notes = notesQuery.data;
  const pageCount = notes ? Math.max(1, Math.ceil(notes.total / notes.pageSize)) : 1;
  const trimmedMessage = message.trim();

  return (
    <section aria-labelledby={`funding-notes-heading-${submissionId}`} className="space-y-4 border-t border-[#c9c9c9] pt-5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id={`funding-notes-heading-${submissionId}`} className="flex items-center gap-2 text-base font-semibold text-[#333]">
            <MessageSquareText className="h-4 w-4 text-[#168d99]" aria-hidden="true" />
            Notes shared with client
          </h3>
          <p className="mt-1 text-xs text-[#777]">These notes are visible to the carrier. Private staff notes are kept separate.</p>
        </div>
        {notes && <span className="text-xs text-[#777]">{notes.total} {notes.total === 1 ? "message" : "messages"}</span>}
      </header>

      {notesQuery.isLoading ? (
        <div aria-label="Loading client-visible notes" className="space-y-3">
          <div className="h-14 animate-pulse motion-reduce:animate-none rounded-xl bg-[#d4d4d4]" />
          <div className="h-14 w-4/5 animate-pulse motion-reduce:animate-none rounded-xl bg-[#d4d4d4]" />
        </div>
      ) : notesQuery.isError ? (
        <div role="alert" className="rounded-xl bg-[#f4e5e2] p-3 text-sm text-[#8b4e4e]">
          <p>{errorText(notesQuery.error)}</p>
          <NeuButton type="button" onClick={() => void notesQuery.refetch()} className="mt-2 min-h-9 px-3 py-1.5 text-xs">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry
          </NeuButton>
        </div>
      ) : (
        <>
          {notes?.items.length ? (
            <ol className="max-h-80 space-y-3 overflow-y-auto pr-1" aria-label="Client-visible note history">
              {notes.items.map((note) => (
                <li key={note.id} className={`rounded-xl p-3 ${note.senderType === "staff" ? "ml-0 bg-[#dcebed] sm:ml-8" : "mr-0 bg-[#e9e5dc] sm:mr-8"}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="text-xs font-semibold text-[#444]">{note.authorName}{note.senderType === "staff" ? " · TPF staff" : " · Carrier"}</span>
                    <time dateTime={note.createdAt} className="text-[11px] text-[#777]">{formatDate(note.createdAt)}</time>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-[#444]">{note.message}</p>
                </li>
              ))}
            </ol>
          ) : (
            <div className="rounded-xl bg-[#dedede] px-4 py-5 text-center text-sm text-[#777]">
              No client-visible notes yet. Use this thread for funding updates the carrier should see.
            </div>
          )}

          {pageCount > 1 && (
            <div className="flex items-center justify-between gap-3 text-xs text-[#666]">
              <span>Page {page} of {pageCount}</span>
              <div className="flex gap-2">
                <NeuButton type="button" size="sm" disabled={page <= 1 || notesQuery.isFetching} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</NeuButton>
                <NeuButton type="button" size="sm" disabled={page >= pageCount || notesQuery.isFetching} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next</NeuButton>
              </div>
            </div>
          )}
        </>
      )}

      {canUpdate ? (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (trimmedMessage.length > 0 && trimmedMessage.length <= 2000 && !sendNote.isPending) sendNote.mutate(trimmedMessage);
          }}
        >
          <label htmlFor={`funding-note-message-${submissionId}`} className="text-xs font-semibold text-[#555]">Reply as TPF staff</label>
          <NeuTextarea
            id={`funding-note-message-${submissionId}`}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="Write an update visible to the carrier…"
            disabled={sendNote.isPending}
            className="min-h-20"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-[#777]">{message.length}/2000 characters</span>
            <NeuButton type="submit" variant="accent" size="sm" disabled={!trimmedMessage || trimmedMessage.length > 2000 || sendNote.isPending} className="min-h-9">
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
              {sendNote.isPending ? "Sending…" : "Send client-visible note"}
            </NeuButton>
          </div>
          {sendNote.isError && <p role="alert" className="text-xs text-[#963f3f]">{errorText(sendNote.error)}</p>}
        </form>
      ) : (
        <p className="rounded-lg bg-[#e0e0e0] px-3 py-2 text-xs text-[#777]">You have view-only access to this client-visible thread.</p>
      )}
    </section>
  );
}

export function FundingProgressPanel({ submissionId, invoiceId }: FundingProgressPanelProps) {
  const queryClient = useQueryClient();
  const [reverseTarget, setReverseTarget] = useState<FundingStep | "">("");
  const [reason, setReason] = useState("");
  const hasSubmissionId = Number.isInteger(submissionId) && (submissionId ?? 0) > 0;
  const hasInvoiceId = Number.isInteger(invoiceId) && (invoiceId ?? 0) > 0;
  const endpoint = hasSubmissionId
    ? `/api/internal/submissions/${submissionId}/funding-progress`
    : hasInvoiceId
      ? `/api/internal/invoices/${invoiceId}/funding-progress`
      : "";
  const progressKey = [endpoint] as const;
  const progressQuery = useQuery({
    queryKey: progressKey,
    queryFn: () => readProgress(endpoint),
    enabled: !!endpoint,
    staleTime: 10000,
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });

  const updateStep = useMutation({
    mutationFn: async ({ target, expectedStatus, reason: changeReason }: { target: FundingStep; expectedStatus: FundingStep; reason?: string }) => {
      const id = progressQuery.data?.progress?.submissionId;
      if (!id) throw new Error("The linked submission could not be identified.");
      const response = await apiRequest("PUT", `/api/internal/submissions/${id}/step`, {
        fundingStatus: target,
        expectedStatus,
        ...(changeReason ? { reason: changeReason } : {}),
      });
      return response.json().catch(() => null);
    },
    onSuccess: async () => {
      setReason("");
      setReverseTarget("");
      const savedProgress = progressQuery.data?.progress;
      if (!savedProgress) {
        await queryClient.invalidateQueries({ queryKey: progressKey });
        return;
      }
      const submissionProgressPath = `/api/internal/submissions/${savedProgress.submissionId}/funding-progress`;
      const linkedInvoiceId = savedProgress.invoiceId ?? (hasInvoiceId ? invoiceId : null);
      const progressPaths = [
        submissionProgressPath,
        ...(linkedInvoiceId ? [`/api/internal/invoices/${linkedInvoiceId}/funding-progress`] : []),
      ];
      await Promise.all(progressPaths.map((path) => queryClient.invalidateQueries({ queryKey: [path] })));
    },
  });

  if (!endpoint) return null;
  if (progressQuery.isLoading) {
    return (
      <NeuCard aria-label="Loading funding progress" className="space-y-5 p-5 sm:p-6">
        <div className="h-5 w-52 animate-pulse motion-reduce:animate-none rounded bg-[#d1d1d1]" />
        <div className="grid gap-4 sm:grid-cols-3"><div className="h-14 animate-pulse motion-reduce:animate-none rounded-xl bg-[#d1d1d1]" /><div className="h-14 animate-pulse motion-reduce:animate-none rounded-xl bg-[#d1d1d1]" /><div className="h-14 animate-pulse motion-reduce:animate-none rounded-xl bg-[#d1d1d1]" /></div>
        <div className="h-24 animate-pulse motion-reduce:animate-none rounded-xl bg-[#d1d1d1]" />
      </NeuCard>
    );
  }
  if (progressQuery.isError) {
    return (
      <NeuCard className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <p role="alert" className="flex items-start gap-2 text-sm text-[#8b4e4e]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {errorText(progressQuery.error)}
        </p>
        <NeuButton type="button" onClick={() => void progressQuery.refetch()} size="sm"><RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry</NeuButton>
      </NeuCard>
    );
  }

  const progress = progressQuery.data?.progress;
  if (!progress) return null;
  const currentIndex = STEP_ORDER.indexOf(progress.fundingStatus);
  const nextStep = STEP_ORDER[currentIndex + 1];
  const earlierSteps = STEP_ORDER.slice(0, currentIndex);
  const reversalReason = reason.trim();
  const history = [...progress.history].sort((left, right) => new Date(right.changedAt).getTime() - new Date(left.changedAt).getTime());
  const lastChange = history[0];

  return (
    <NeuCard className="space-y-5 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#888]">Carrier funding update</p>
          <h2 className="mt-1 break-words text-lg font-semibold text-[#333]">Funding progress <span className="font-mono text-sm font-medium text-[#777]">· {progress.number}</span></h2>
          <p className="mt-1 text-xs text-[#777]">Shared progress for the carrier submission. This is not a payment action.</p>
        </div>
        <NeuBadge tone={progress.fundingStatus === "received" ? "neutral" : progress.fundingStatus === "under_review" ? "warning" : "success"} className="w-fit capitalize">
          {STEP_DETAILS[progress.fundingStatus].label}
        </NeuBadge>
      </header>

      <div className="rounded-2xl bg-[#e0e0e0] p-4 sm:p-5">
        <StepTimeline progress={progress} />
      </div>

      {lastChange && (
        <div className="flex flex-wrap items-start gap-2 rounded-xl bg-[#e0e0e0] px-3 py-2.5 text-xs text-[#666]">
          <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#168d99]" aria-hidden="true" />
          <p>Last changed by <span className="font-semibold text-[#444]">{lastChange.actorName}</span> on {formatDate(lastChange.changedAt)}.</p>
        </div>
      )}

      {progress.fundingStatus === "funded" && (
        <div role="note" className="flex items-start gap-2 rounded-xl bg-[#e2eee8] px-3 py-2.5 text-xs text-[#326c56]">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>Funded reflects verified funding progress only. This panel never initiates or reverses a payment.</p>
        </div>
      )}

      {progress.canUpdate && (
        <div className="space-y-4 border-t border-[#c9c9c9] pt-4">
          {nextStep && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-[#444]">Advance progress</p>
                <p className="mt-0.5 text-xs text-[#777]">Only the next sequential step can be selected.</p>
              </div>
              <NeuButton
                type="button"
                variant="accent"
                disabled={updateStep.isPending || (nextStep === "funded" && !progress.fundingVerified)}
                onClick={() => updateStep.mutate({ target: nextStep, expectedStatus: progress.fundingStatus })}
                className="sm:min-w-48"
              >
                {updateStep.isPending ? "Updating…" : `Mark ${STEP_DETAILS[nextStep].label}`}
              </NeuButton>
            </div>
          )}

          {nextStep === "funded" && !progress.fundingVerified && (
            <p className="text-xs text-[#80621f]">Funding cannot be marked complete until funding verification is confirmed.</p>
          )}

          {earlierSteps.length > 0 && (
            <div className="space-y-3 rounded-xl bg-[#e0e0e0] p-3">
              <label htmlFor={`funding-revert-step-${progress.submissionId}`} className="block text-sm font-semibold text-[#444]">Correct a previous step</label>
              <p className="text-xs text-[#777]">Reversing progress changes the client-visible status only; it does not reverse a payment.</p>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
                <select
                  id={`funding-revert-step-${progress.submissionId}`}
                  aria-label="Earlier funding step"
                  value={reverseTarget}
                  onChange={(event) => setReverseTarget(event.target.value as FundingStep | "")}
                  className="min-h-11 w-full rounded-xl border-0 bg-[#e0e0e0] px-3 text-sm text-[#333] shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#27aab8]"
                >
                  <option value="">Choose earlier step</option>
                  {earlierSteps.map((step) => <option key={step} value={step}>{STEP_DETAILS[step].label}</option>)}
                </select>
                <NeuInput
                  aria-label="Reason for reversing funding progress"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={1000}
                  placeholder="Required reason, at least 5 characters"
                />
                <NeuButton
                  type="button"
                  variant="destructive"
                  disabled={!reverseTarget || reversalReason.length < 5 || reversalReason.length > 1000 || updateStep.isPending}
                  onClick={() => reverseTarget && updateStep.mutate({ target: reverseTarget, expectedStatus: progress.fundingStatus, reason: reversalReason })}
                >
                  <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  {updateStep.isPending ? "Saving…" : "Revert Step"}
                </NeuButton>
              </div>
              <p className="text-right text-[11px] text-[#777]">{reason.length}/1000 characters</p>
            </div>
          )}
          {updateStep.isError && <p role="alert" className="flex items-start gap-2 text-sm text-[#963f3f]"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{errorText(updateStep.error)}</p>}
        </div>
      )}

      <section aria-labelledby={`funding-history-heading-${progress.submissionId}`} className="border-t border-[#c9c9c9] pt-4">
        <h3 id={`funding-history-heading-${progress.submissionId}`} className="text-sm font-semibold text-[#444]">Progress audit history</h3>
        {history.length ? (
          <ol className="mt-3 space-y-3">
            {history.map((entry) => (
              <li key={entry.id} className="flex gap-3 text-xs">
                <span aria-hidden="true" className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-[#168d99]" />
                <div className="min-w-0 flex-1">
                  <p className="text-[#444]"><span className="font-semibold">{STEP_DETAILS[entry.from].label}</span> → <span className="font-semibold">{STEP_DETAILS[entry.to].label}</span></p>
                  <p className="mt-1 text-[#777]">{entry.actorName} · {formatDate(entry.changedAt)}</p>
                  {entry.reason && <p className="mt-1 whitespace-pre-wrap break-words text-[#666]">Reason: {entry.reason}</p>}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-xs text-[#777]">No status changes have been recorded.</p>
        )}
      </section>

      {progress.canUpdate && <FundingNotes submissionId={progress.submissionId} canUpdate />}
    </NeuCard>
  );
}
