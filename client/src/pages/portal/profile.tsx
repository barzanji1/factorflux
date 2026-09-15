import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Loader2, Plus, Trash2, WalletCards } from "lucide-react";
import PortalLayout from "@/components/layout/portal-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface PortalUser { id: number; carrierId?: number | null; status: string; }
interface BankAccount {
  id: number;
  bankName: string;
  accountType: string;
  nickname: string;
  lastFour: string;
}

const EMPTY = { bankName: "", accountType: "checking", routingNumber: "", accountNumber: "", nickname: "" };

export default function PortalProfile() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [values, setValues] = useState(EMPTY);
  const [showNewAccount, setShowNewAccount] = useState(false);
  const [revealed, setRevealed] = useState<Record<number, { accountNumber: string; routingNumber: string }>>({});

  const { data: me } = useQuery<PortalUser>({ queryKey: ["/api/portal/me"], retry: false });
  const { data: accounts = [], isLoading } = useQuery<BankAccount[]>({
    queryKey: ["/api/portal/bank-accounts"],
    enabled: !!me,
  });

  useEffect(() => {
    if (!me) setLocation("/portal/login");
  }, [me, setLocation]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/portal/bank-accounts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Unable to add bank account");
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/bank-accounts"] });
      setValues(EMPTY);
      setShowNewAccount(false);
      toast({ title: "Bank account added", description: "It is now available for invoice submissions." });
    },
    onError: (error: Error) => toast({ title: "Unable to add account", description: error.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/portal/bank-accounts/${id}`, { method: "DELETE", credentials: "include" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Unable to remove bank account");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/bank-accounts"] });
      toast({ title: "Bank account removed" });
    },
  });

  async function toggleReveal(id: number) {
    if (revealed[id]) {
      setRevealed(current => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      return;
    }
    const response = await fetch(`/api/portal/bank-accounts/${id}/reveal`, { credentials: "include" });
    const body = await response.json();
    if (!response.ok) {
      toast({ title: "Unable to reveal account", description: body.message, variant: "destructive" });
      return;
    }
    setRevealed(current => ({ ...current, [id]: body }));
  }

  const valid = values.bankName.trim() && values.nickname.trim()
    && /^\d{9}$/.test(values.routingNumber) && /^\d{4,17}$/.test(values.accountNumber);

  return (
    <PortalLayout>
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Profile</h1>
            <p className="mt-1 text-sm text-slate-500">Manage payment accounts used for invoice funding.</p>
          </div>
          <Button onClick={() => setShowNewAccount(value => !value)} className="gap-2">
            <Plus className="h-4 w-4" /> Add account
          </Button>
        </div>

        {!me?.carrierId && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Your portal login is not linked to a carrier record yet. Contact TPF before adding bank accounts.
          </div>
        )}

        {showNewAccount && (
          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-800">New Bank Account</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Bank Name *</Label>
                <Input value={values.bankName} onChange={e => setValues(v => ({ ...v, bankName: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Account Nickname *</Label>
                <Input placeholder="Primary checking" value={values.nickname} onChange={e => setValues(v => ({ ...v, nickname: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Account Type *</Label>
                <Select value={values.accountType} onValueChange={accountType => setValues(v => ({ ...v, accountType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="checking">Checking</SelectItem>
                    <SelectItem value="savings">Savings</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Routing Number *</Label>
                <Input inputMode="numeric" maxLength={9} value={values.routingNumber} onChange={e => setValues(v => ({ ...v, routingNumber: e.target.value.replace(/\D/g, "") }))} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Account Number *</Label>
                <Input type="password" inputMode="numeric" maxLength={17} value={values.accountNumber} onChange={e => setValues(v => ({ ...v, accountNumber: e.target.value.replace(/\D/g, "") }))} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setShowNewAccount(false); setValues(EMPTY); }}>Cancel</Button>
              <Button disabled={!valid || createMutation.isPending || !me?.carrierId} onClick={() => createMutation.mutate()}>
                {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save Account
              </Button>
            </div>
          </section>
        )}

        <section className="space-y-3">
          <h2 className="font-semibold text-slate-800">Bank Accounts</h2>
          {isLoading ? (
            <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
          ) : accounts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-12 text-center">
              <WalletCards className="mx-auto mb-3 h-9 w-9 text-slate-300" />
              <p className="font-medium text-slate-700">No bank accounts on file</p>
              <p className="mt-1 text-sm text-slate-500">Add an account to submit invoices for funding.</p>
            </div>
          ) : accounts.map(account => (
            <div key={account.id} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4">
              <WalletCards className="h-8 w-8 text-blue-600" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-800">{account.nickname}</p>
                <p className="text-sm text-slate-500">{account.bankName} · <span className="capitalize">{account.accountType}</span></p>
                <p className="mt-1 font-mono text-sm text-slate-700">
                  {revealed[account.id] ? revealed[account.id].accountNumber : `•••• ${account.lastFour}`}
                </p>
              </div>
              <Button variant="ghost" size="icon" aria-label={revealed[account.id] ? "Hide account number" : "Reveal account number"} onClick={() => void toggleReveal(account.id)}>
                {revealed[account.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button variant="ghost" size="icon" aria-label="Remove bank account" onClick={() => removeMutation.mutate(account.id)}>
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            </div>
          ))}
        </section>
      </div>
    </PortalLayout>
  );
}