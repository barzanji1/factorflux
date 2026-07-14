import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2, Eye, Download, FileText, Search, X, ChevronDown, ChevronUp } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/skeleton-rows";

interface Doc { id: number; documentType: string; originalName: string; mimeType?: string; size?: number; }
interface Submission {
  id: number; portalUserId: number; companyName?: string;
  invoiceNumber?: string; loadNumber?: string; brokerName?: string;
  amount?: string; paymentType?: string; status: string; notes?: string;
  submittedAt?: string; documents?: Doc[];
}

const STATUS_OPTS = ["submitted", "under_review", "approved", "funded", "rejected"];
const STATUS_BADGE: Record<string, JSX.Element> = {
  submitted:    <Badge className="bg-blue-100 text-blue-700 border-0">Submitted</Badge>,
  under_review: <Badge className="bg-amber-100 text-amber-700 border-0">Under Review</Badge>,
  approved:     <Badge className="bg-emerald-100 text-emerald-700 border-0">Approved</Badge>,
  funded:       <Badge className="bg-purple-100 text-purple-700 border-0">Funded</Badge>,
  rejected:     <Badge className="bg-red-100 text-red-700 border-0">Rejected</Badge>,
};
const DOC_LABEL: Record<string, string> = {
  rate_confirmation: "Rate Conf.", bol: "BOL", lumper_receipt: "Lumper", other: "Other",
};

export default function PortalSubmissionsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [detail, setDetail] = useState<Submission | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [editStatus, setEditStatus] = useState("");

  const { data: submissions = [], isLoading } = useQuery<Submission[]>({
    queryKey: ["/api/carrier-portal/submissions"],
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status, notes }: { id: number; status: string; notes: string }) => {
      const res = await fetch(`/api/carrier-portal/submissions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status, notes }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Update failed");
      return json;
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/carrier-portal/submissions"] });
      setDetail((prev) => prev ? { ...prev, ...updated } : prev);
      toast({ title: "Submission updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = submissions.filter((s) => {
    const matchStatus = filterStatus === "all" || s.status === filterStatus;
    const q = search.toLowerCase();
    const matchSearch = !q || [s.companyName, s.invoiceNumber, s.loadNumber, s.brokerName]
      .some((v) => v?.toLowerCase().includes(q));
    return matchStatus && matchSearch;
  }).sort((a, b) => new Date(b.submittedAt || 0).getTime() - new Date(a.submittedAt || 0).getTime());

  function openDetail(s: Submission) {
    setDetail(s);
    setEditNotes(s.notes || "");
    setEditStatus(s.status);
  }

  return (
    <div className="flex h-screen bg-[hsl(var(--background))]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title="Portal Submissions" subtitle="Invoice submissions from the carrier portal" group="Workspace" />
        <main className="custom-scrollbar flex-1 overflow-auto p-6">
          <div className="max-w-7xl mx-auto space-y-6">

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search by company, invoice, load, or broker…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
                {search && (
                  <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2">
                    <X className="h-4 w-4 text-slate-400 hover:text-slate-600" />
                  </button>
                )}
              </div>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-full sm:w-44">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {STATUS_OPTS.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Table */}
            <Card className="rounded-[24px] border border-[hsl(var(--border))]">
              <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Carrier Submissions
                </CardTitle>
                <CardDescription>{filtered.length} submission{filtered.length !== 1 ? "s" : ""}</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {isLoading ? (
                  <SkeletonRows rows={6} cols={6} />
                ) : filtered.length === 0 ? (
                  <EmptyState icon={FileText} title="No submissions" description="Submissions from carriers will appear here." />
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Carrier</TableHead>
                          <TableHead>Load / Invoice</TableHead>
                          <TableHead>Broker</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Submitted</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filtered.map((s) => (
                          <TableRow key={s.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => openDetail(s)}>
                            <TableCell className="font-medium">{s.companyName || `Portal User #${s.portalUserId}`}</TableCell>
                            <TableCell>
                              <p className="text-sm">{s.loadNumber || "—"}</p>
                              {s.invoiceNumber && <p className="text-xs text-slate-400">{s.invoiceNumber}</p>}
                            </TableCell>
                            <TableCell className="text-sm">{s.brokerName || "—"}</TableCell>
                            <TableCell className="text-right font-mono text-sm">
                              {s.amount ? `$${parseFloat(s.amount).toLocaleString()}` : "—"}
                            </TableCell>
                            <TableCell>{STATUS_BADGE[s.status]}</TableCell>
                            <TableCell className="text-xs text-slate-500">
                              {s.submittedAt ? new Date(s.submittedAt).toLocaleDateString() : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openDetail(s); }}>
                                Review
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </main>
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Submission #{detail?.id} — {detail?.companyName || `Portal User #${detail?.portalUserId}`}
            </DialogTitle>
            <DialogDescription>Review documents and update submission status.</DialogDescription>
          </DialogHeader>

          {detail && (
            <div className="space-y-5">
              {/* Load Info */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  ["Load #", detail.loadNumber],
                  ["Invoice #", detail.invoiceNumber],
                  ["Broker", detail.brokerName],
                  ["Amount", detail.amount ? `$${parseFloat(detail.amount).toLocaleString()}` : "—"],
                  ["Payment", detail.paymentType],
                  ["Submitted", detail.submittedAt ? new Date(detail.submittedAt).toLocaleString() : "—"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <p className="text-xs text-slate-400">{k}</p>
                    <p className="font-medium text-slate-800 dark:text-slate-200">{v || "—"}</p>
                  </div>
                ))}
              </div>

              {/* Documents */}
              {detail.documents && detail.documents.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 mb-2">Documents ({detail.documents.length})</p>
                  <div className="space-y-1.5">
                    {detail.documents.map((doc) => (
                      <div key={doc.id} className="flex items-center gap-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-3 py-2">
                        <FileText className="h-4 w-4 text-blue-500 flex-shrink-0" />
                        <span className="text-sm flex-1 truncate">{doc.originalName}</span>
                        <Badge variant="outline" className="text-[10px] px-1.5">{DOC_LABEL[doc.documentType] || doc.documentType}</Badge>
                        <a href={`/api/portal/submissions/${detail.id}/documents/${doc.id}/view`} target="_blank" rel="noreferrer"
                          className="p-1 text-slate-400 hover:text-blue-600" title="View">
                          <Eye className="h-4 w-4" />
                        </a>
                        <a href={`/api/portal/submissions/${detail.id}/documents/${doc.id}/download`}
                          className="p-1 text-slate-400 hover:text-blue-600" title="Download">
                          <Download className="h-4 w-4" />
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Status + Notes Update */}
              <div className="space-y-3 border-t border-slate-100 dark:border-slate-800 pt-4">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Update Submission</p>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Status</label>
                  <Select value={editStatus} onValueChange={setEditStatus}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTS.map((s) => (
                        <SelectItem key={s} value={s} className="capitalize">{s.replace("_", " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Notes (visible to carrier)</label>
                  <Textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    rows={3}
                    placeholder="Add notes for the carrier…"
                    className="resize-none"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setDetail(null)}>Close</Button>
                  <Button
                    onClick={() => updateMutation.mutate({ id: detail.id, status: editStatus, notes: editNotes })}
                    disabled={updateMutation.isPending}
                  >
                    {updateMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…</> : "Save Changes"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
