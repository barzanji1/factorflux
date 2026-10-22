import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmailTemplatePicker } from "@/components/client-email/email-template-picker";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { personalizeEmail, type EmailTemplate } from "../../../../shared/email-templates";
import { z } from "zod";

export interface EmailClient {
  id: number;
  name: string;
  email: string | null;
}

const isValidEmail = (value?: string | null) => !!value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const parseCc = (value: string) => {
  const entries = value.split(/[;,]/).map((address) => address.trim()).filter(Boolean);
  const addresses = [...new Map(entries.map((address) => [address.toLowerCase(), address])).values()];
  const invalidAddresses = addresses.filter((address) => !z.string().email().max(254).safeParse(address).success);
  return { addresses, invalidAddresses, tooMany: addresses.length > 20 };
};
const getRequestId = () => crypto.randomUUID();

export function ClientEmailComposer({
  open,
  onOpenChange,
  initialClient,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialClient?: EmailClient;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const [clientId, setClientId] = useState(initialClient ? String(initialClient.id) : "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [cc, setCc] = useState("");
  const [template, setTemplate] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const requestId = useRef(getRequestId());
  const draftSignature = useRef("");
  const sendGuard = useRef(false);

  const { data: emailConfig, error: configError, refetch: refetchConfig } = useQuery<{ from: string; replyTo: string }>({
    queryKey: ["/api/client-email/config"],
    enabled: open,
    queryFn: async () => {
      const response = await fetch("/api/client-email/config", { credentials: "include" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Could not load sender settings");
      if (typeof result.from !== "string" || typeof result.replyTo !== "string") throw new Error("Sender settings response was invalid");
      return result;
    },
  });

  const { data: clients = [], isLoading: clientsLoading, error: clientsError, refetch } = useQuery<EmailClient[]>({
    queryKey: ["/api/client-email/clients", user?.id],
    enabled: open && !initialClient,
    queryFn: async () => {
      const response = await fetch("/api/client-email/clients", { credentials: "include" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Could not load clients");
      if (!Array.isArray(result)) throw new Error("Client list response was invalid");
      return result;
    },
  });
  const selectedClient = useMemo(() => initialClient ?? clients.find((client) => String(client.id) === clientId), [initialClient, clients, clientId]);

  useEffect(() => {
    if (open) {
      setClientId(initialClient ? String(initialClient.id) : "");
      setSubject("");
      setBody("");
      setCc("");
      setTemplate("");
      setSelectedTemplate(null);
      draftSignature.current = "";
      requestId.current = getRequestId();
    }
  }, [open, initialClient?.id]);

  const noteDraftChanged = (nextClientId: string, nextSubject: string, nextBody: string, nextCc: string) => {
    const signature = JSON.stringify([nextClientId, nextSubject, nextBody, nextCc]);
    if (signature !== draftSignature.current) {
      draftSignature.current = signature;
      requestId.current = getRequestId();
    }
  };
  const changeClient = (value: string) => {
    setClientId(value);
    setTemplate("");
    setSelectedTemplate(null);
    noteDraftChanged(value, subject, body, cc);
  };
  const changeSubject = (value: string) => {
    setSubject(value);
    noteDraftChanged(clientId, value, body, cc);
  };
  const changeBody = (value: string) => {
    setBody(value);
    noteDraftChanged(clientId, subject, value, cc);
  };
  const changeCc = (value: string) => {
    setCc(value);
    noteDraftChanged(clientId, subject, body, value);
  };
  const parsedCc = useMemo(() => parseCc(cc), [cc]);
  const ccIsInvalid = parsedCc.invalidAddresses.length > 0 || parsedCc.tooMany;
  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!emailConfig || configError) throw new Error("Sender settings are unavailable. Reload them before sending.");
      if (!selectedClient || !isValidEmail(selectedClient.email)) throw new Error("This client needs a valid profile email before you can send.");
      if (ccIsInvalid) throw new Error("Check the CC addresses before sending.");
      const response = await fetch("/api/client-email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ clientId: selectedClient.id, subject: subject.trim(), body: body.trim(), cc: parsedCc.addresses, requestId: requestId.current }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || `Email could not be sent (HTTP ${response.status}).`);
      if (result.status !== "sent") throw new Error("The send was not confirmed. Your draft is preserved; retry to safely check again.");
      return result;
    },
    onSuccess: () => {
      if (selectedClient) queryClient.invalidateQueries({ queryKey: ["/api/clients", selectedClient.id, "email-log"] });
      setSubject("");
      setBody("");
      setCc("");
      setTemplate("");
      setSelectedTemplate(null);
      draftSignature.current = "";
      requestId.current = getRequestId();
      toast({ title: "Email sent", description: `Message sent to ${selectedClient?.email}.` });
    },
    onSettled: () => {
      if (selectedClient) queryClient.invalidateQueries({ queryKey: ["/api/clients", selectedClient.id, "email-log"] });
    },
  });
  const canSend = !!emailConfig && !configError && !!selectedClient && isValidEmail(selectedClient.email) && !ccIsInvalid && !!subject.trim() && !!body.trim() && !sendMutation.isPending;

  const applyTemplate = (chosen: EmailTemplate | null) => {
    setTemplate(chosen?.id || "");
    setSelectedTemplate(chosen);
    if (chosen) {
      setSubject(chosen.subject);
      setBody(chosen.body);
      noteDraftChanged(clientId, chosen.subject, chosen.body, cc);
    }
  };
  const resolvedTemplateBody = selectedTemplate && selectedClient
    ? personalizeEmail(body, selectedClient.name)
    : "";
  return <Dialog open={open} onOpenChange={value => { if (!sendMutation.isPending) onOpenChange(value); }}>
    <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto rounded-sm border-2 border-[#7c8582] bg-[#e8eeeb] p-0 shadow-[4px_4px_0_rgba(39,54,56,.25)]">
      <DialogHeader className="border-b border-[#b8c3bf] bg-[#d6e2de] px-5 py-4">
        <DialogTitle className="flex items-center gap-2 text-base text-[#203a46]"><Mail className="h-4 w-4 text-[#087f8e]" />Email client</DialogTitle>
        <DialogDescription className="text-xs text-[#596d70]">Send-only communication to the assigned client, with optional CC recipients.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 px-5 py-4">
        {initialClient ? <div className="space-y-1"><Label>Client</Label><div className="border border-[#bcc8c5] bg-[#f4f7f5] px-3 py-2 text-sm font-semibold">{initialClient.name}</div></div>
          : <div className="space-y-1"><Label htmlFor="client-email-recipient">Client</Label>
            {clientsLoading ? <div className="h-10 animate-pulse border border-[#c4cfcc] bg-[#dce4e1]" />
              : clientsError ? <div role="alert" className="flex items-center justify-between border border-[#d2a6a0] bg-[#fff1ee] p-2 text-xs text-[#8d3f36]"><span>Client list could not be loaded.</span><Button variant="outline" size="sm" onClick={() => void refetch()}>Retry</Button></div>
                  : clients.length === 0 ? <div className="border border-[#c4cfcc] bg-[#f4f7f5] p-3 text-sm text-[#596d70]">{user?.role === "employee" ? <><p className="font-semibold text-[#334c50]">No clients assigned to you</p><p className="mt-1">Ask an administrator to assign a client before sending email.</p></> : "No clients available for email."}</div>
                 : <Select value={clientId} onValueChange={changeClient} disabled={sendMutation.isPending}><SelectTrigger id="client-email-recipient" className="rounded-sm bg-white"><SelectValue placeholder="Choose a client…" /></SelectTrigger><SelectContent>{clients.map((client) => <SelectItem key={client.id} value={String(client.id)}>{client.name}</SelectItem>)}</SelectContent></Select>}
          </div>}
        {selectedClient && <div className={`flex items-start gap-2 border p-2.5 text-xs ${isValidEmail(selectedClient.email) ? "border-[#b7cfca] bg-[#f1f7f4] text-[#345c54]" : "border-[#d6b076] bg-[#fff8e9] text-[#805f26]"}`}>
          {isValidEmail(selectedClient.email) ? <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          <span>{isValidEmail(selectedClient.email) ? <>To <strong>{selectedClient.email}</strong></> : <>No valid email is on this client profile. Sending is disabled; edit the client profile to add a valid email address.</>}</span>
        </div>}
        <div className="space-y-1"><Label>From</Label><div className="break-all border border-[#c6d0cd] bg-[#f3f6f4] px-3 py-2 text-xs text-[#465b60]">{emailConfig?.from ?? (configError ? "Sender unavailable" : "Loading sender settings…")}</div></div>
        <div className="space-y-1"><Label>Reply-to</Label><div className="break-all border border-[#c6d0cd] bg-[#f3f6f4] px-3 py-2 text-xs text-[#465b60]">{emailConfig?.replyTo ?? (configError ? "Reply-to unavailable" : "Loading sender settings…")}</div></div>
         <div className="space-y-1">
           <Label htmlFor="client-email-cc">CC <span className="font-normal text-[#71817e]">(optional, up to 20)</span></Label>
           <Input id="client-email-cc" value={cc} disabled={sendMutation.isPending} onChange={(event) => changeCc(event.target.value)} className={`rounded-sm bg-white ${ccIsInvalid ? "border-[#b75c50] focus-visible:ring-[#b75c50]" : ""}`} placeholder="name@example.com, another@example.com" aria-invalid={ccIsInvalid} aria-describedby="client-email-cc-help" />
           <p id="client-email-cc-help" className={`text-[11px] ${ccIsInvalid ? "text-[#8d3f36]" : "text-[#596d70]"}`}>
             {parsedCc.tooMany
               ? "A maximum of 20 unique CC addresses is allowed."
               : parsedCc.invalidAddresses.length
                 ? `Enter bare email addresses only. Invalid: ${parsedCc.invalidAddresses.join(", ")}`
                 : "Separate addresses with commas or semicolons. Duplicate addresses are removed."}
           </p>
         </div>
        {configError && <div role="alert" className="flex items-center justify-between gap-2 border border-[#d2a6a0] bg-[#fff1ee] p-2 text-xs text-[#8d3f36]"><span>Sender settings could not be loaded. Sending is disabled.</span><Button variant="outline" size="sm" onClick={() => void refetchConfig()}>Retry</Button></div>}
        <div className="rounded-sm border border-[#d6b076] bg-[#fff8e9] px-3 py-2 text-[11px] leading-relaxed text-[#725927]">Replies are monitored outside this app. This is a send-only tool; there is no inbox reader here.</div>
         <EmailTemplatePicker id="email-template" value={template} onChange={applyTemplate} disabled={sendMutation.isPending} />
          <p className="border border-[#d6b076] bg-[#fff8e9] px-3 py-2 text-[11px] leading-relaxed text-[#725927]">Templates are starting text only. [Company] resolves to the selected client name; when unavailable, it falls back to “Valued Client.” Review observed closure dates and hours before sending.</p>
         <div className="space-y-1"><Label htmlFor="client-email-subject">Subject</Label><Input id="client-email-subject" value={subject} maxLength={200} disabled={sendMutation.isPending} onChange={(event) => changeSubject(event.target.value)} className="rounded-sm bg-white" placeholder="A clear, specific subject" /></div>
         <div className="space-y-1"><Label htmlFor="client-email-body">Message</Label><Textarea id="client-email-body" value={body} maxLength={20000} disabled={sendMutation.isPending} rows={8} onChange={(event) => changeBody(event.target.value)} className="resize-y rounded-sm bg-white leading-relaxed" placeholder="Write your message…" /></div>
         {selectedTemplate && selectedClient && <div className="border border-[#c6d0cd] bg-[#f4f7f5] p-2.5">
           <p className="mb-1 text-[9px] font-bold uppercase tracking-wide text-[#657977]">Resolved [Company] preview · {selectedClient.name || "Valued Client"}</p>
           <p className="whitespace-pre-wrap break-words text-[10px] leading-relaxed text-[#34494c]">{resolvedTemplateBody}</p>
         </div>}
        {sendMutation.error && <div role="alert" className="border border-[#d2a6a0] bg-[#fff1ee] px-3 py-2 text-xs text-[#8d3f36]"><strong>Draft retained.</strong> {(sendMutation.error as Error).message} Retry uses the same request ID while the client and message remain unchanged.</div>}
      </div>
      <DialogFooter className="border-t border-[#c5cfcc] bg-[#e1e8e5] px-5 py-3">
         <Button type="button" variant="outline" className="rounded-sm" disabled={sendMutation.isPending} onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button type="button" className="rounded-sm bg-[#087f8e] text-white hover:bg-[#076c78]" disabled={!canSend} onClick={() => {
          if (sendGuard.current) return;
          sendGuard.current = true;
          sendMutation.mutate(undefined, { onSettled: () => { sendGuard.current = false; } });
        }}><Send className="mr-2 h-3.5 w-3.5" />{sendMutation.isPending ? "Sending…" : "Send email"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}