import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

export interface EmailClient {
  id: number;
  name: string;
  email: string | null;
}

const FROM_LINE = "TruckingPros Financial <clients@tpfactoring.com>";
const REPLY_TO = "dosh@truckingprosfinancial.com";
const isValidEmail = (value?: string | null) => !!value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const getRequestId = () => crypto.randomUUID();

type TemplateSet = { document: { subject: string; body: string }; deadline: { subject: string; body: string } };
const defaultTemplates: TemplateSet = {
  document: { subject: "Documents needed", body: "Hello,\n\nCould you please send the following documents when you have a chance?\n\n[Add document names]\n\nThank you,\nTruckingPros Financial" },
  deadline: { subject: "Deadline reminder", body: "Hello,\n\nThis is a reminder to send the outstanding [documents/items] by [agreed deadline]. If you need more time, please reply so we can help.\n\nThank you,\nTruckingPros Financial" },
};

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
  const [clientId, setClientId] = useState(initialClient ? String(initialClient.id) : "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [template, setTemplate] = useState("");
  const requestId = useRef(getRequestId());
  const draftSignature = useRef("");
  const sendGuard = useRef(false);

  const { data: clients = [], isLoading: clientsLoading, error: clientsError, refetch } = useQuery<EmailClient[]>({
    queryKey: ["/api/client-email/clients"],
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
      setTemplate("");
      draftSignature.current = "";
      requestId.current = getRequestId();
    }
  }, [open, initialClient?.id]);

  const noteDraftChanged = (nextClientId: string, nextSubject: string, nextBody: string) => {
    const signature = JSON.stringify([nextClientId, nextSubject, nextBody]);
    if (signature !== draftSignature.current) {
      draftSignature.current = signature;
      requestId.current = getRequestId();
    }
  };
  const changeClient = (value: string) => {
    setClientId(value);
    setTemplate("");
    noteDraftChanged(value, subject, body);
  };
  const changeSubject = (value: string) => {
    setSubject(value);
    noteDraftChanged(clientId, value, body);
  };
  const changeBody = (value: string) => {
    setBody(value);
    noteDraftChanged(clientId, subject, value);
  };
  const sendMutation = useMutation({
    mutationFn: async () => {
      if (!selectedClient || !isValidEmail(selectedClient.email)) throw new Error("This client needs a valid profile email before you can send.");
      const response = await fetch("/api/client-email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ clientId: selectedClient.id, subject: subject.trim(), body: body.trim(), requestId: requestId.current }),
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
      setTemplate("");
      draftSignature.current = "";
      requestId.current = getRequestId();
      toast({ title: "Email sent", description: `Message sent to ${selectedClient?.email}.` });
    },
    onSettled: () => {
      if (selectedClient) queryClient.invalidateQueries({ queryKey: ["/api/clients", selectedClient.id, "email-log"] });
    },
  });
  const canSend = !!selectedClient && isValidEmail(selectedClient.email) && !!subject.trim() && !!body.trim() && !sendMutation.isPending;

  const applyTemplate = (value: string) => {
    setTemplate(value);
    if (value === "document" || value === "deadline") {
      const chosen = defaultTemplates[value];
      setSubject(chosen.subject);
      setBody(chosen.body);
      noteDraftChanged(clientId, chosen.subject, chosen.body);
    }
  };
  return <Dialog open={open} onOpenChange={value => { if (!sendMutation.isPending) onOpenChange(value); }}>
    <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto rounded-sm border-2 border-[#7c8582] bg-[#e8eeeb] p-0 shadow-[4px_4px_0_rgba(39,54,56,.25)]">
      <DialogHeader className="border-b border-[#b8c3bf] bg-[#d6e2de] px-5 py-4">
        <DialogTitle className="flex items-center gap-2 text-base text-[#203a46]"><Mail className="h-4 w-4 text-[#087f8e]" />Email client</DialogTitle>
        <DialogDescription className="text-xs text-[#596d70]">Send-only communication. Recipients always come from the client profile.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 px-5 py-4">
        {initialClient ? <div className="space-y-1"><Label>Client</Label><div className="border border-[#bcc8c5] bg-[#f4f7f5] px-3 py-2 text-sm font-semibold">{initialClient.name}</div></div>
          : <div className="space-y-1"><Label htmlFor="client-email-recipient">Client</Label>
            {clientsLoading ? <div className="h-10 animate-pulse border border-[#c4cfcc] bg-[#dce4e1]" />
              : clientsError ? <div role="alert" className="flex items-center justify-between border border-[#d2a6a0] bg-[#fff1ee] p-2 text-xs text-[#8d3f36]"><span>Client list could not be loaded.</span><Button variant="outline" size="sm" onClick={() => void refetch()}>Retry</Button></div>
                 : clients.length === 0 ? <p className="border bg-white p-3 text-sm">No accessible clients. Ask a manager to assign a client to you.</p>
                 : <Select value={clientId} onValueChange={changeClient} disabled={sendMutation.isPending}><SelectTrigger id="client-email-recipient" className="rounded-sm bg-white"><SelectValue placeholder="Choose a client…" /></SelectTrigger><SelectContent>{clients.map((client) => <SelectItem key={client.id} value={String(client.id)}>{client.name}</SelectItem>)}</SelectContent></Select>}
          </div>}
        {selectedClient && <div className={`flex items-start gap-2 border p-2.5 text-xs ${isValidEmail(selectedClient.email) ? "border-[#b7cfca] bg-[#f1f7f4] text-[#345c54]" : "border-[#d6b076] bg-[#fff8e9] text-[#805f26]"}`}>
          {isValidEmail(selectedClient.email) ? <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          <span>{isValidEmail(selectedClient.email) ? <>To <strong>{selectedClient.email}</strong></> : <>No valid email is on this client profile. Sending is disabled; edit the client profile to add a valid email address.</>}</span>
        </div>}
        <div className="space-y-1"><Label>From</Label><div className="border border-[#c6d0cd] bg-[#f3f6f4] px-3 py-2 text-xs text-[#465b60]">{FROM_LINE}</div></div>
        <div className="space-y-1"><Label>Reply-to</Label><div className="border border-[#c6d0cd] bg-[#f3f6f4] px-3 py-2 text-xs text-[#465b60]">{REPLY_TO}</div></div>
        <div className="rounded-sm border border-[#d6b076] bg-[#fff8e9] px-3 py-2 text-[11px] leading-relaxed text-[#725927]">Replies are monitored outside this app. This is a send-only tool; there is no inbox reader here.</div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor="email-template">Optional template</Label>
           <div className="flex items-center gap-2"><Select value={template} onValueChange={applyTemplate} disabled={sendMutation.isPending}><SelectTrigger id="email-template" className="h-8 w-52 rounded-sm bg-white text-xs"><SelectValue placeholder="Start from a template…" /></SelectTrigger><SelectContent><SelectItem value="document">Document request</SelectItem><SelectItem value="deadline">Deadline reminder</SelectItem></SelectContent></Select></div>
        </div>
         <p className="text-[11px] text-[#596d70]">Templates are starting text only. Review and replace bracketed items or dates before sending.</p>
         <div className="space-y-1"><Label htmlFor="client-email-subject">Subject</Label><Input id="client-email-subject" value={subject} maxLength={200} disabled={sendMutation.isPending} onChange={(event) => changeSubject(event.target.value)} className="rounded-sm bg-white" placeholder="A clear, specific subject" /></div>
         <div className="space-y-1"><Label htmlFor="client-email-body">Message</Label><Textarea id="client-email-body" value={body} maxLength={20000} disabled={sendMutation.isPending} rows={8} onChange={(event) => changeBody(event.target.value)} className="resize-y rounded-sm bg-white leading-relaxed" placeholder="Write your message…" /></div>
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