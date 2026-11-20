import { useEffect, useRef, useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Download, FileText, LockKeyhole, LogOut, MessageSquareText, Paperclip, RefreshCw, Reply, Send, ShieldCheck, Upload } from "lucide-react";
import { TpfLogo } from "@/components/brand/tpf-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BrokerInvoiceStatus, BrokerPortalAccount, BrokerPortalDocument, BrokerPortalInvoice, BrokerPortalNote, BrokerPortalSession } from "../../../../shared/broker-portal";
import { brokerJson, brokerKeys, brokerRequest, BrokerPortalError, useBrokerDocuments, useBrokerInvoice, useBrokerInvoices, useBrokerNotes, useBrokerSession } from "./useBrokerPortal";
import "./broker-portal.css";

type Navigate = (path: string, replace?: boolean) => void;
type StatusTab = "all" | BrokerInvoiceStatus;

function usePortalLocation(): [string, Navigate] {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  const navigate: Navigate = (to, replace = false) => {
    if (replace) window.history.replaceState({}, "", to);
    else window.history.pushState({}, "", to);
    setPath(window.location.pathname);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  return [path, navigate];
}

function PortalButton({ children, className = "", ...props }: ComponentProps<typeof Button>) {
  return <Button {...props} className={`bp-button ${className}`}>{children}</Button>;
}

function PortalHeader({ account, onLogout, loggingOut }: { account?: BrokerPortalAccount; onLogout?: () => void; loggingOut?: boolean }) {
  return <header className="bp-topbar">
    <div className="bp-brand">
      <TpfLogo showWordmark={false} markClassName="bp-logo" />
      <div className="bp-brand-copy"><strong>Trucking Pros Financial</strong><span>Broker Portal</span></div>
    </div>
    <div className="bp-top-actions">
      {account && <span className="bp-account">{account.companyName}</span>}
      {account && onLogout && <PortalButton variant="ghost" className="quiet" onClick={onLogout} disabled={loggingOut} aria-label="Sign out"><LogOut /> <span className="hidden sm:inline">{loggingOut ? "Signing out" : "Sign out"}</span></PortalButton>}
    </div>
  </header>;
}

function PortalFrame({ children, account, onLogout, loggingOut }: { children: ReactNode; account?: BrokerPortalAccount; onLogout?: () => void; loggingOut?: boolean }) {
  return <div className="broker-portal"><div className="bp-shell">
    <PortalHeader account={account} onLogout={onLogout} loggingOut={loggingOut} />
    {children}
    <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-5 text-[10px] text-muted-foreground">
      <span>Private broker access · Trucking Pros Financial</span>
      <span className="inline-flex items-center gap-1.5"><LockKeyhole className="h-3 w-3" /> Secure document and invoice view</span>
    </footer>
  </div></div>;
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div role="alert" className="bp-error"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div className="flex-1">{message}</div>{onRetry && <button type="button" className="bp-link shrink-0" onClick={onRetry}>Try again</button>}</div>;
}

function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return <div aria-label="Loading" className="space-y-4 p-5">{Array.from({ length: rows }, (_, i) => <div key={i} className="flex gap-4"><div className="bp-skeleton h-10 w-10 shrink-0 rounded-xl" /><div className="flex-1 space-y-2"><div className="bp-skeleton w-2/5" /><div className="bp-skeleton w-4/5" /></div></div>)}</div>;
}

function EmptyState({ title, description, icon = <FileText className="h-5 w-5" /> }: { title: string; description: string; icon?: ReactNode }) {
  return <div className="bp-empty"><div className="bp-empty-icon">{icon}</div><h3>{title}</h3><p>{description}</p></div>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="bp-field"><label>{label}{children}</label></div>;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatMoney(value: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(amount);
}

function AuthPage({ mode, navigate }: { mode: "login" | "register" | "verify"; navigate: Navigate }) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(() => {
    if (mode !== "login") return "";
    const reason = new URLSearchParams(window.location.search).get("error");
    if (reason === "invalid-link") return "That sign-in link is invalid, expired, or has already been used. Request a new secure sign-in link.";
    if (reason === "session-expired") return "Your secure session expired. Sign in again to continue.";
    return "";
  });
  const [magicMode, setMagicMode] = useState(false);
  const [verificationToken, setVerificationToken] = useState("");
  const [verificationChecked, setVerificationChecked] = useState(false);
  const tokenRead = useRef(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== "verify" || tokenRead.current) return;
    tokenRead.current = true;
    const params = new URLSearchParams(window.location.search);
    const hash = window.location.hash.replace(/^#/, "");
    const hashParams = new URLSearchParams(hash);
    const token = params.get("token") || hashParams.get("token") || (hash && !hash.includes("=") ? decodeURIComponent(hash) : "");
    setVerificationToken(token || "");
    setVerificationChecked(true);
    if (params.has("token") || hashParams.has("token") || hash) {
      const clean = `${window.location.pathname}${params.toString() ? `?${[...params.entries()].filter(([key]) => key !== "token").map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&")}` : ""}`;
      window.history.replaceState({}, "", clean);
    }
  }, [mode]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const values = Object.fromEntries(form.entries());
    try {
      if (mode === "register") {
        const password = String(values.password || "");
        if (Array.from(password).length < 12) throw new Error("Use at least 12 characters for your registration password.");
        if (new TextEncoder().encode(password).length > 72) throw new Error("Your password must be no more than 72 UTF-8 bytes.");
        const result = await brokerRequest<{ message: string }>("/api/broker/register", brokerJson("POST", {
          companyName: values.companyName,
          contactName: values.contactName,
          email: values.email,
          phone: values.phone,
          password: values.password,
        }));
        setNotice(result.message || "If the contact details match an eligible broker account, a verification email will arrive shortly.");
      } else if (mode === "verify") {
        if (!verificationToken) throw new Error("This verification link is missing or has expired. Request a new registration link or contact your Trucking Pros Financial representative.");
        if (!String(values.password || "").length || String(values.password).length > 200) throw new Error("Enter the password you used when registering.");
        const session = await brokerRequest<BrokerPortalSession>("/api/broker/verify", brokerJson("POST", { token: verificationToken, password: values.password }));
        await queryClient.cancelQueries({ queryKey: brokerKeys.session });
        queryClient.setQueryData(brokerKeys.session, session);
        navigate("/broker/dashboard", true);
        return;
      } else if (magicMode) {
        const result = await brokerRequest<{ message: string }>("/api/broker/magic-link", brokerJson("POST", { email: values.email }));
        setNotice(result.message || "If the address is eligible, a secure sign-in link will arrive shortly.");
      } else {
        const session = await brokerRequest<BrokerPortalSession>("/api/broker/login", brokerJson("POST", { email: values.email, password: values.password }));
        await queryClient.cancelQueries({ queryKey: brokerKeys.session });
        queryClient.setQueryData(brokerKeys.session, session);
        navigate("/broker/dashboard", true);
        return;
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn't complete that request. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const isRegister = mode === "register";
  const isVerify = mode === "verify";
  const title = isRegister ? "Create portal access" : isVerify ? "Verify your email" : magicMode ? "Get a sign-in link" : "Welcome back";
  const intro = isRegister ? "Set up a private view for your invoices and paperwork." : isVerify ? "Confirm your email address and enter the password you used when registering to finish setting up access." : magicMode ? "We’ll email a one-time sign-in link if this address has portal access." : "Sign in to review invoices, documents, and conversations.";

  return <PortalFrame>
    <main className="bp-auth-layout">
      <section className="bp-auth-story">
        <div className="bp-eyebrow">Your business, in view</div>
        <h1>Clear paperwork.<br />On your terms.</h1>
        <p>A private place for your freight invoices, supporting documents, and direct communication with Trucking Pros Financial.</p>
        <div className="bp-trust-note"><ShieldCheck className="h-4 w-4 text-primary" /> Only verified broker contacts can access company records.</div>
      </section>
      <section className="bp-card bp-auth-card" aria-labelledby="auth-title">
        <div className="bp-eyebrow">{isRegister ? "Broker access" : isVerify ? "Email verification" : "Private sign in"}</div>
        <h2 id="auth-title" className="mt-2">{title}</h2>
        <p>{intro}</p>
        {error && <ErrorBanner message={error} />}
        {notice && <div role="status" className="bp-success mt-4"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</div>}
        {isVerify && verificationChecked && !verificationToken && <div className="bp-notice mt-4"><Clock3 className="mt-0.5 h-4 w-4 shrink-0" /><span>The verification token is missing or expired. Register again to request a fresh email link, or contact your account representative.</span></div>}
        {(!notice || isVerify) && <form onSubmit={submit} noValidate={false}>
          {isRegister && <>
            <Field label="Company name"><Input name="companyName" autoComplete="organization" required maxLength={200} placeholder="Company legal name" className="bp-input" /></Field>
            <Field label="Contact name"><Input name="contactName" autoComplete="name" required maxLength={150} placeholder="Name on your broker account" className="bp-input" /></Field>
          </>}
          {(isRegister || mode === "login" && !magicMode) && <Field label="Email address"><Input name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@company.com" className="bp-input" /></Field>}
          {mode === "login" && magicMode && <Field label="Email address"><Input name="email" type="email" autoComplete="email" required maxLength={254} placeholder="you@company.com" className="bp-input" /></Field>}
          {isRegister && <Field label="Phone"><Input name="phone" type="tel" autoComplete="tel" required minLength={5} maxLength={40} placeholder="Best number to reach you" className="bp-input" /></Field>}
          {(isRegister || isVerify || mode === "login" && !magicMode) && <Field label={isRegister ? "Create password" : isVerify ? "Registration password" : "Password"}><Input name="password" type="password" autoComplete={mode === "login" || isVerify ? "current-password" : "new-password"} required minLength={isRegister ? 12 : 1} maxLength={isRegister ? 72 : 200} placeholder={isRegister ? "At least 12 characters" : isVerify ? "Password used when registering" : "Your password"} className="bp-input" /></Field>}
          <div className="bp-form-actions">
            <PortalButton type="submit" className="primary w-full" disabled={busy || isVerify && verificationChecked && !verificationToken}>
              {busy ? "Please wait…" : isRegister ? "Request verification email" : isVerify ? "Verify and continue" : magicMode ? "Email me a sign-in link" : "Sign in"} <ArrowRight className="h-4 w-4" />
            </PortalButton>
          </div>
        </form>}
        {mode === "login" && <div className="bp-inline-links">
          <button type="button" className="bp-link" onClick={() => { setMagicMode(!magicMode); setError(""); setNotice(""); }}>{magicMode ? "Use password instead" : "Email me a secure sign-in link"}</button>
        </div>}
        {mode === "login" && <div className="bp-auth-switch">New to the portal? <button type="button" className="bp-link" onClick={() => navigate("/broker/register")}>Register</button></div>}
        {mode === "register" && <div className="bp-auth-switch">Already have access? <button type="button" className="bp-link" onClick={() => navigate("/broker/login")}>Sign in</button></div>}
        {isRegister && <div className="bp-notice mt-5"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" /><span>Registration is available only to a contact already listed on a broker account. We’ll respond with the same confirmation either way to protect account privacy.</span></div>}
        {isVerify && <div className="bp-auth-switch"><button type="button" className="bp-link" onClick={() => navigate("/broker/login")}>Return to sign in</button></div>}
      </section>
    </main>
  </PortalFrame>;
}

function InvoiceStatus({ status }: { status: BrokerInvoiceStatus }) {
  return <span className={`bp-status ${status}`}>{status}</span>;
}

function InvoiceTable({ invoices, onOpen }: { invoices: BrokerPortalInvoice[]; onOpen: (id: number) => void }) {
  return <div className="bp-table-wrap"><table className="bp-table">
    <thead><tr><th>Invoice #</th><th>Client name</th><th>Amount</th><th>Status</th><th>Submitted date</th><th>Acted date</th><th><span className="sr-only">Open</span></th></tr></thead>
    <tbody>{invoices.map(invoice => <tr key={invoice.id} onClick={() => onOpen(invoice.id)} onKeyDown={event => { if (event.key === "Enter") onOpen(invoice.id); }} tabIndex={0} aria-label={`Open invoice ${invoice.invoiceNumber}`}>
      <td className="bp-invoice-id">{invoice.invoiceNumber}</td><td>{invoice.clientName}</td><td>{formatMoney(invoice.amount)}</td><td><InvoiceStatus status={invoice.status} /></td><td>{formatDate(invoice.submittedAt)}</td><td>{formatDate(invoice.actedAt)}</td><td><ArrowRight className="h-4 w-4 text-muted-foreground" /></td>
    </tr>)}</tbody>
  </table></div>;
}

function Dashboard({ account, navigate, onLogout, loggingOut }: { account: BrokerPortalAccount; navigate: Navigate; onLogout: () => void; loggingOut: boolean }) {
  const [status, setStatus] = useState<StatusTab>("all");
  const [page, setPage] = useState(1);
  const invoices = useBrokerInvoices(status, page, true);
  const pageCount = invoices.data ? Math.max(1, Math.ceil(invoices.data.total / invoices.data.pageSize)) : 1;
  const goInvoice = (id: number) => navigate(`/broker/invoices/${id}`);
  return <PortalFrame account={account} onLogout={onLogout} loggingOut={loggingOut}>
    <main className="bp-page">
      <div className="bp-heading-row">
        <div><div className="bp-eyebrow">Broker workspace</div><h1 className="bp-title">Good to see you, {account.contactName.split(" ")[0]}.</h1><p className="bp-lede">Your invoices and the documents attached to them, all in one private place.</p></div>
        <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/45 px-3 py-2 text-[11px] text-muted-foreground"><ShieldCheck className="h-4 w-4 text-primary" /> Verified broker access</div>
      </div>
      <section className="bp-card bp-panel">
        <div className="bp-toolbar">
          <div><h2 className="m-0 text-[17px] font-bold tracking-tight">Invoices</h2><p className="mt-1 mb-0 text-xs text-muted-foreground">{invoices.data ? `${invoices.data.total} record${invoices.data.total === 1 ? "" : "s"} available` : "Your submitted invoice activity"}</p></div>
          <div className="bp-tabs" role="tablist" aria-label="Filter invoices">
            {(["all", "pending", "confirmed", "disputed"] as StatusTab[]).map(tab => <button key={tab} type="button" role="tab" aria-selected={status === tab} className="bp-tab" onClick={() => { setStatus(tab); setPage(1); }}>{tab === "all" ? "All" : tab[0].toUpperCase() + tab.slice(1)}</button>)}
          </div>
        </div>
        {invoices.isError && <ErrorBanner message={invoices.error instanceof Error ? invoices.error.message : "Invoices could not be loaded."} onRetry={() => void invoices.refetch()} />}
        {invoices.isLoading ? <LoadingBlock rows={5} /> : invoices.data && (invoices.data.invoices.length ? <>
          <InvoiceTable invoices={invoices.data.invoices} onOpen={goInvoice} />
          <div className="bp-pagination"><span>Page {invoices.data.page} of {pageCount}</span><div className="bp-pager-actions">
            <PortalButton variant="outline" className="quiet" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}><ChevronLeft /> Previous</PortalButton>
            <PortalButton variant="outline" className="quiet" disabled={page >= pageCount} onClick={() => setPage(value => Math.min(pageCount, value + 1))}>Next <ChevronRight /></PortalButton>
          </div></div>
        </> : <EmptyState title={status === "all" ? "No invoices yet" : `No ${status} invoices`} description={status === "all" ? "When invoices are shared with your broker account, they’ll appear here." : "There are no invoices in this status right now."} />)}
      </section>
      <div className="mt-5 flex items-start gap-3 rounded-xl border border-border/60 bg-muted/25 p-4 text-xs leading-relaxed text-muted-foreground"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p className="m-0">This portal shows only records associated with your verified broker account. For help with an invoice, open its detail page to reach our team.</p></div>
    </main>
  </PortalFrame>;
}

function InvoiceDetail({ id, account, navigate, onLogout, loggingOut }: { id: string; account: BrokerPortalAccount; navigate: Navigate; onLogout: () => void; loggingOut: boolean }) {
  const queryClient = useQueryClient();
  const detail = useBrokerInvoice(id, true);
  const docs = useBrokerDocuments(id, true);
  const [notePage, setNotePage] = useState(1);
  const notes = useBrokerNotes(id, notePage, true);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [uploadType, setUploadType] = useState("other");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const session = queryClient.getQueryData<BrokerPortalSession>(brokerKeys.session);
  const invalidateInvoiceData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: brokerKeys.detail(id) }),
      queryClient.invalidateQueries({ queryKey: brokerKeys.documents(id) }),
      queryClient.invalidateQueries({ queryKey: ["broker-portal", "invoices"] }),
      queryClient.invalidateQueries({ queryKey: ["broker-portal", "notes", id] }),
    ]);
  };
  const responseMutation = useMutation({
    mutationFn: async ({ action, reason }: { action: "confirm" | "dispute"; reason?: string }) => {
      if (!session?.csrfToken) throw new Error("Your secure session has expired. Sign in again to respond.");
      return brokerRequest<{ message: string }>(`/api/broker/invoices/${encodeURIComponent(id)}/${action}`, brokerJson("POST", action === "dispute" ? { reason } : {}, session.csrfToken));
    },
    onSuccess: async result => { setActionMessage(result.message || "Your response has been recorded."); setDisputeOpen(false); setDisputeReason(""); await invalidateInvoiceData(); },
    onError: async error => {
      if (error instanceof BrokerPortalError && error.status === 409) {
        setActionMessage("This invoice was already answered. The latest status is shown below.");
        await invalidateInvoiceData();
      }
    },
  });
  const noteMutation = useMutation({
    mutationFn: async () => {
      if (!session?.csrfToken) throw new Error("Your secure session has expired. Sign in again to send a message.");
      return brokerRequest<{ message: string }>(`/api/broker/invoices/${encodeURIComponent(id)}/notes`, brokerJson("POST", { message: message.trim(), ...(replyTo === null ? {} : { parentId: replyTo }) }, session.csrfToken));
    },
    onSuccess: async () => { setMessage(""); setReplyTo(null); setNotePage(1); await queryClient.invalidateQueries({ queryKey: ["broker-portal", "notes", id] }); },
  });
  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!uploadFile) throw new Error("Choose a document to upload.");
      if (uploadFile.size > 15 * 1024 * 1024) throw new Error("Files must be 15 MB or smaller.");
      if (!["application/pdf", "image/jpeg", "image/png"].includes(uploadFile.type)) throw new Error("Choose a PDF, JPEG, or PNG file.");
      if (!session?.csrfToken) throw new Error("Your secure session has expired. Sign in again to upload a document.");
      const form = new FormData();
      form.append("file", uploadFile);
      form.append("documentType", uploadType);
      return brokerRequest<{ message: string }>(`/api/broker/invoices/${encodeURIComponent(id)}/documents`, { method: "POST", headers: { "X-Broker-CSRF": session.csrfToken }, body: form });
    },
    onSuccess: async () => { setUploadFile(null); const input = document.getElementById("bp-file-upload") as HTMLInputElement | null; if (input) input.value = ""; await queryClient.invalidateQueries({ queryKey: brokerKeys.documents(id) }); },
  });
  const noteCountPages = notes.data ? Math.max(1, Math.ceil(notes.data.total / notes.data.pageSize)) : 1;

  const submitDispute = (event: FormEvent) => {
    event.preventDefault();
    setActionMessage("");
    responseMutation.mutate({ action: "dispute", reason: disputeReason.trim() });
  };
  const submitNote = (event: FormEvent) => {
    event.preventDefault();
    noteMutation.mutate();
  };
  const submitUpload = (event: FormEvent) => {
    event.preventDefault();
    uploadMutation.mutate();
  };

  return <PortalFrame account={account} onLogout={onLogout} loggingOut={loggingOut}>
    <main className="bp-page">
      <div className="bp-breadcrumb"><button type="button" className="bp-link inline-flex items-center gap-1" onClick={() => navigate("/broker/dashboard")}><ArrowLeft className="h-3.5 w-3.5" /> Invoices</button><span>/</span><span>Invoice detail</span></div>
      {detail.isLoading && <div className="bp-card"><LoadingBlock rows={6} /></div>}
      {detail.isError && <ErrorBanner message={detail.error instanceof Error ? detail.error.message : "Invoice details could not be loaded."} onRetry={() => void detail.refetch()} />}
      {detail.data && <>
        <div className="bp-invoice-hero"><div><div className="bp-eyebrow">Invoice record</div><h1 className="bp-title">{detail.data.invoiceNumber}</h1><p className="bp-lede">{detail.data.clientName} · {formatMoney(detail.data.amount)}</p></div><InvoiceStatus status={detail.data.status} /></div>
        {actionMessage && <div className="bp-success mb-5" role="status"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{actionMessage}</div>}
        {responseMutation.isError && !(responseMutation.error instanceof BrokerPortalError && responseMutation.error.status === 409) && <ErrorBanner message={responseMutation.error instanceof Error ? responseMutation.error.message : "Your response could not be sent."} />}
        <div className="bp-detail-grid">
          <div className="space-y-5">
            <section className="bp-card bp-panel">
              <h2 className="bp-section-title">Shipment and invoice information</h2>
              <div className="bp-facts">
                <Fact label="Client" value={detail.data.clientName} />
                <Fact label="Amount" value={formatMoney(detail.data.amount)} />
                <Fact label="Invoice number" value={detail.data.invoiceNumber} />
                <Fact label="Carrier invoice" value={detail.data.carrierInvoiceNumber || "—"} />
                <Fact label="Load number" value={detail.data.loadNumber || "—"} />
                <Fact label="Submitted" value={formatDate(detail.data.submittedAt)} />
                <Fact label="Origin" value={detail.data.origin || "—"} />
                <Fact label="Destination" value={detail.data.destination || "—"} />
                <Fact label="Status" value={<InvoiceStatus status={detail.data.status} />} />
                <Fact label="Acted date" value={formatDate(detail.data.actedAt)} />
                {detail.data.actedBy && <Fact label="Action recorded by" value={detail.data.actedBy} />}
                {detail.data.disputeReason && <Fact label="Dispute reason" value={detail.data.disputeReason} />}
              </div>
            </section>
            <section className="bp-card bp-panel">
              <div className="flex items-start justify-between gap-3"><div><h2 className="bp-section-title mb-1">Documents</h2><p className="m-0 text-xs text-muted-foreground">Files shared for this invoice, plus paperwork you upload.</p></div><Paperclip className="h-4 w-4 text-primary" /></div>
              {docs.isError && <div className="mt-4"><ErrorBanner message={docs.error instanceof Error ? docs.error.message : "Documents could not be loaded."} onRetry={() => void docs.refetch()} /></div>}
              {docs.isLoading ? <LoadingBlock rows={2} /> : docs.data?.documents.length ? <div className="mt-3">{docs.data.documents.map(document => <DocumentRow key={document.id} document={document} />)}</div> : !docs.isError && <EmptyState title="No documents attached" description="Shared paperwork and uploads for this invoice will be listed here." icon={<Paperclip className="h-5 w-5" />} />}
              <form className="bp-upload" onSubmit={submitUpload}>
                <label htmlFor="bp-file-upload" className="bp-upload-label"><span className="inline-flex items-center gap-2"><Upload className="h-4 w-4" />{uploadFile ? uploadFile.name : "Choose PDF, JPEG, or PNG · up to 15 MB"}</span><input id="bp-file-upload" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={event => setUploadFile(event.currentTarget.files?.[0] || null)} /></label>
                <select aria-label="Document type" value={uploadType} onChange={event => setUploadType(event.target.value)}>
                  <option value="rate_confirmation">Rate confirmation</option><option value="bill_of_lading">Bill of lading</option><option value="proof_of_delivery">Proof of delivery</option><option value="other">Other</option>
                </select>
                <PortalButton type="submit" className="primary" disabled={!uploadFile || uploadMutation.isPending}><Upload />{uploadMutation.isPending ? "Uploading…" : "Upload document"}</PortalButton>
                {uploadMutation.isError && <div className="col-span-full"><ErrorBanner message={uploadMutation.error instanceof Error ? uploadMutation.error.message : "Upload failed."} /></div>}
                {uploadMutation.isSuccess && <div className="bp-success col-span-full"><Check className="h-4 w-4" />Document uploaded.</div>}
              </form>
            </section>
            <section className="bp-card bp-panel">
              <div className="flex items-start justify-between gap-3"><div><h2 className="bp-section-title mb-1">Conversation</h2><p className="m-0 text-xs text-muted-foreground">Messages about this invoice stay with its record.</p></div><PortalButton variant="ghost" className="quiet" onClick={() => void notes.refetch()} disabled={notes.isFetching}><RefreshCw className="h-3.5 w-3.5" />Refresh</PortalButton></div>
              {notes.isError && <div className="mt-4"><ErrorBanner message={notes.error instanceof Error ? notes.error.message : "Messages could not be loaded."} onRetry={() => void notes.refetch()} /></div>}
              {notes.isLoading ? <LoadingBlock rows={3} /> : notes.data?.notes.length ? <>
                <div className="bp-thread mt-5">{notes.data.notes.map(note => <NoteCard key={note.id} note={note} parentAvailable={note.parentId === null || notes.data!.notes.some(parent => parent.id === note.parentId)} onReply={() => { setReplyTo(note.id); document.getElementById("bp-message")?.focus(); }} />)}</div>
                <div className="bp-pagination"><span>Page {notes.data.page} of {noteCountPages}</span><div className="bp-pager-actions"><PortalButton variant="outline" className="quiet" disabled={notePage <= 1} onClick={() => setNotePage(value => value - 1)}><ChevronLeft />Newer</PortalButton><PortalButton variant="outline" className="quiet" disabled={notePage >= noteCountPages} onClick={() => setNotePage(value => value + 1)}>Older<ChevronRight /></PortalButton></div></div>
              </> : !notes.isError && <EmptyState title="Start a conversation" description="Send a note to the Trucking Pros Financial team about this invoice." icon={<MessageSquareText className="h-5 w-5" />} />}
              <form className="mt-5 border-t border-border/60 pt-4" onSubmit={submitNote}>
                {replyTo !== null && <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground"><span className="inline-flex items-center gap-1"><Reply className="h-3.5 w-3.5" />Replying to message #{replyTo}</span><button type="button" className="bp-link" onClick={() => setReplyTo(null)}>Cancel reply</button></div>}
                <Field label="Your message"><textarea id="bp-message" value={message} onChange={event => setMessage(event.target.value.slice(0, 2000))} maxLength={2000} required placeholder="Write a message to our team…" /></Field>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3"><span className="text-[10px] text-muted-foreground">{message.length}/2000</span><PortalButton type="submit" className="primary" disabled={!message.trim() || noteMutation.isPending}><Send />{noteMutation.isPending ? "Sending…" : "Send message"}</PortalButton></div>
                {noteMutation.isError && <div className="mt-3"><ErrorBanner message={noteMutation.error instanceof Error ? noteMutation.error.message : "Your message could not be sent."} /></div>}
              </form>
            </section>
          </div>
          <aside className="bp-card bp-panel bp-response">
            <div className="bp-eyebrow">Your response</div>
            <h2 className="mt-2">{detail.data.status === "pending" ? "Review this invoice" : detail.data.status === "confirmed" ? "Invoice confirmed" : "Invoice disputed"}</h2>
            <p>{detail.data.responseNotice || (detail.data.canRespond ? "Confirm the invoice or let our team know what needs attention." : "This invoice is not currently open for a response.")}</p>
            {detail.data.canRespond ? !disputeOpen ? <div className="bp-response-actions">
              <PortalButton className="primary flex-1" disabled={responseMutation.isPending} onClick={() => { setActionMessage(""); responseMutation.mutate({ action: "confirm" }); }}><CheckCircle2 />Confirm invoice</PortalButton>
              <PortalButton variant="outline" className="danger flex-1" disabled={responseMutation.isPending} onClick={() => { setDisputeOpen(true); setActionMessage(""); }}>Dispute</PortalButton>
            </div> : <form onSubmit={submitDispute}>
              <Field label="What needs attention?"><textarea value={disputeReason} onChange={event => setDisputeReason(event.target.value.slice(0, 2000))} required maxLength={2000} placeholder="Describe the issue so our team can review it." /></Field>
              <div className="mt-2 flex justify-between text-[10px] text-muted-foreground"><span>Required · up to 2,000 characters</span><span>{disputeReason.length}/2000</span></div>
              <div className="bp-response-actions"><PortalButton type="button" variant="outline" className="flex-1" onClick={() => setDisputeOpen(false)}>Cancel</PortalButton><PortalButton type="submit" className="primary flex-1" disabled={!disputeReason.trim() || responseMutation.isPending}>{responseMutation.isPending ? "Sending…" : "Submit dispute"}</PortalButton></div>
            </form> : <div className="bp-notice mt-4"><Clock3 className="mt-0.5 h-4 w-4 shrink-0" /><span>Responses are closed for this invoice. You can still message our team below.</span></div>}
            <div className="mt-6 border-t border-border/60 pt-5 text-[11px] leading-relaxed text-muted-foreground"><div className="mb-2 flex items-center gap-2 font-bold text-foreground"><ShieldCheck className="h-4 w-4 text-primary" />One broker response</div>Responses are recorded on the shared invoice. If another authorized contact has already responded, the latest status will appear here.</div>
          </aside>
        </div>
      </>}
    </main>
  </PortalFrame>;
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return <div><span className="bp-fact-label">{label}</span><span className="bp-fact-value">{value}</span></div>;
}

function DocumentRow({ document }: { document: BrokerPortalDocument }) {
  const size = document.size > 1024 * 1024 ? `${(document.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(document.size / 1024))} KB`;
  return <div className="bp-doc-row"><div className="bp-file-icon"><FileText className="h-4 w-4" /></div><div className="bp-doc-meta"><strong>{document.name}</strong><span>{document.type.replaceAll("_", " ")} · {size} · {formatDate(document.createdAt)}</span></div><a className="bp-button quiet" href={document.downloadUrl} target="_blank" rel="noreferrer" aria-label={`Download ${document.name}`}><Download className="h-4 w-4" /></a></div>;
}

function NoteCard({ note, parentAvailable, onReply }: { note: BrokerPortalNote; parentAvailable: boolean; onReply: () => void }) {
  return <article className={`bp-message ${note.authorKind}`}>
    <div className="bp-message-head"><span className="bp-message-author">{note.authorKind === "staff" ? <ShieldCheck className="h-3.5 w-3.5 text-primary" /> : <span className="grid h-5 w-5 place-items-center rounded-full bg-primary/10 text-[9px] text-primary">{note.authorName.slice(0, 1).toUpperCase()}</span>}{note.authorName}{note.authorKind === "staff" && <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary">TPF team</span>}</span><time dateTime={note.createdAt}>{formatDate(note.createdAt)}</time></div>
    {note.parentId !== null && <div className="mb-2 text-[10px] text-muted-foreground">{parentAvailable ? `Reply to message #${note.parentId}` : `Reply to earlier note #${note.parentId}; it may be on another page.`}</div>}
    <p className="bp-message-body">{note.message}</p>
    <div className="mt-2 text-right"><button type="button" className="bp-link inline-flex items-center gap-1 text-[10px]" onClick={onReply}><Reply className="h-3 w-3" />Reply</button></div>
  </article>;
}

function AuthenticatedPortal({ path, navigate, account, session }: { path: string; navigate: Navigate; account: BrokerPortalAccount; session: BrokerPortalSession }) {
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: () => brokerRequest<void>("/api/broker/logout", brokerJson("POST", {}, session.csrfToken)),
    onSettled: () => { queryClient.clear(); navigate("/broker/login", true); },
  });
  const loggingOut = logout.isPending;
  const onLogout = () => logout.mutate();
  const match = path.match(/^\/broker\/invoices\/([^/]+)\/?$/);
  if (match) return <InvoiceDetail id={decodeURIComponent(match[1])} account={account} navigate={navigate} onLogout={onLogout} loggingOut={loggingOut} />;
  if (path === "/broker/login" || path === "/broker/register" || path === "/broker/verify") {
    navigate("/broker/dashboard", true);
    return <PortalFrame account={account}><div className="bp-page"><LoadingBlock /></div></PortalFrame>;
  }
  return <Dashboard account={account} navigate={navigate} onLogout={onLogout} loggingOut={loggingOut} />;
}

function PortalApp() {
  const [path, navigate] = usePortalLocation();
  const queryClient = useQueryClient();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const isMagicCallback = path === "/broker/magic";
  const isPublic = path === "/broker/login" || path === "/broker/register" || path === "/broker/verify" || isMagicCallback;
  const sessionQuery = useBrokerSession(!isPublic);
  const account = sessionQuery.data?.user;
  const session = sessionQuery.data;

  useEffect(() => {
    const onExpired = () => {
      navigateRef.current("/broker/login?error=session-expired", true);
      void queryClient.cancelQueries();
      queryClient.clear();
    };
    window.addEventListener("broker-session-expired", onExpired);
    return () => window.removeEventListener("broker-session-expired", onExpired);
  }, [queryClient]);

  if (isMagicCallback) return <MagicLinkCallback navigate={navigate} />;
  if (isPublic) return <AuthPage key={path} mode={path.endsWith("/register") ? "register" : path.endsWith("/verify") ? "verify" : "login"} navigate={navigate} />;
  if (sessionQuery.isLoading) return <PortalFrame><main className="bp-page"><div className="bp-card"><LoadingBlock rows={5} /></div></main></PortalFrame>;
  if (sessionQuery.isError || !account || !session) {
    const status = sessionQuery.error instanceof BrokerPortalError ? sessionQuery.error.status : 0;
    if (status === 401 || status === 0) return <AuthPage mode="login" navigate={navigate} />;
    return <PortalFrame><main className="bp-page"><ErrorBanner message={sessionQuery.error instanceof Error ? sessionQuery.error.message : "Your broker session could not be checked."} onRetry={() => void sessionQuery.refetch()} /></main></PortalFrame>;
  }
  return <AuthenticatedPortal path={path} navigate={navigate} account={account} session={session} />;
}

function MagicLinkCallback({ navigate }: { navigate: Navigate }) {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.search).get("token");
    window.history.replaceState({}, "", window.location.pathname);
    if (!token) {
      navigate("/broker/login?error=invalid-link", true);
      return;
    }
    window.location.replace(`/api/broker/magic-link/${encodeURIComponent(token)}`);
  }, [navigate]);
  return <PortalFrame><main className="bp-page"><div className="bp-card bp-panel"><div className="bp-eyebrow">Secure sign in</div><h1 className="bp-title mt-2 text-2xl">Opening your sign-in link</h1><p className="bp-lede">The one-time link is being checked securely. This page will continue automatically.</p><div className="mt-6"><LoadingBlock rows={1} /></div></div></main></PortalFrame>;
}

export function BrokerPortalRouter() {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { retry: (failureCount, error) => !(error instanceof BrokerPortalError && error.status === 401) && failureCount < 1, refetchOnWindowFocus: true },
      mutations: { retry: false },
    },
  }));
  return <QueryClientProvider client={queryClient}><PortalApp /></QueryClientProvider>;
}

export default BrokerPortalRouter;
