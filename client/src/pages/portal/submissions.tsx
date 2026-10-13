import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CompressionInfo } from "@/components/documents/compression-info";
import { Loader2, FileText, ChevronDown, ChevronUp, Download, Eye, ReceiptText } from "lucide-react";
import PortalLayout from "@/components/layout/portal-layout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

interface PortalUser { id: number; status: string; }
interface Doc { id: number; documentType: string; originalName: string; size?: number; mimeType?: string; originalSize?: number; compressedSize?: number; }
interface FundingReceipt { receiptNo: string; version: number; fundedAt?: string | null; createdAt?: string | null; paymentReference?: string | null; }
interface Submission {
  id: number; invoiceNumber?: string; loadNumber?: string; brokerName?: string;
  amount?: string; paymentType?: string; status: string; notes?: string;
  submittedAt?: string; documents?: Doc[]; receipts?: FundingReceipt[];
}

const STATUS_BADGE: Record<string, JSX.Element> = {
  submitted:    <Badge className="bg-blue-100 text-blue-700 border-0">Submitted</Badge>,
  under_review: <Badge className="bg-amber-100 text-amber-700 border-0">Under Review</Badge>,
  approved:     <Badge className="bg-emerald-100 text-emerald-700 border-0">Approved</Badge>,
  funded:       <Badge className="bg-purple-100 text-purple-700 border-0">Funded</Badge>,
  rejected:     <Badge className="bg-red-100 text-red-700 border-0">Rejected</Badge>,
};

const DOC_LABEL: Record<string, string> = {
  rate_confirmation: "Rate Conf.",
  bol: "BOL",
  lumper_receipt: "Lumper",
  other: "Other",
};

export default function PortalSubmissions() {
  const [, setLocation] = useLocation();
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data: me } = useQuery<PortalUser>({ queryKey: ["/api/portal/me"], retry: false });
  const { data: submissions = [], isLoading } = useQuery<Submission[]>({
    queryKey: ["/api/portal/submissions"],
    enabled: !!me,
  });

  useEffect(() => {
    if (!me) setLocation("/portal/login");
  }, [me, setLocation]);

  const sorted = [...submissions].sort((a, b) =>
    new Date(b.submittedAt || 0).getTime() - new Date(a.submittedAt || 0).getTime()
  );

  return (
    <PortalLayout>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My Submissions</h1>
          <p className="text-slate-500 text-sm mt-0.5">{submissions.length} total</p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-blue-500" /></div>
        ) : sorted.length === 0 ? (
          <Card className="rounded-2xl">
            <CardContent className="py-12 text-center">
              <FileText className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <p className="font-medium text-slate-600">No submissions yet</p>
              <p className="text-sm text-slate-400 mt-1">Submit your first invoice to get started.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {sorted.map((s) => (
              <Card key={s.id} className="rounded-2xl overflow-hidden">
                <div
                  className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
                  onClick={() => setExpanded(expanded === s.id ? null : s.id)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-8 w-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                      <FileText className="h-4 w-4 text-blue-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-slate-900 truncate">
                        {s.invoiceNumber ? `Invoice ${s.invoiceNumber}` : s.loadNumber ? `Load #${s.loadNumber}` : `Submission #${s.id}`}
                      </p>
                      <p className="text-xs text-slate-400">
                        {s.brokerName && `${s.brokerName} · `}
                        {s.submittedAt ? new Date(s.submittedAt).toLocaleDateString() : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {s.amount && (
                      <span className="text-sm font-bold text-slate-800">${parseFloat(s.amount).toLocaleString()}</span>
                    )}
                    {STATUS_BADGE[s.status]}
                    {expanded === s.id ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                  </div>
                </div>

                {expanded === s.id && (
                  <div className="border-t border-slate-100 px-4 py-4 bg-slate-50 space-y-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                      <div><p className="text-xs text-slate-400">Load #</p><p className="font-medium text-slate-700">{s.loadNumber || "—"}</p></div>
                      <div><p className="text-xs text-slate-400">Invoice #</p><p className="font-medium text-slate-700">{s.invoiceNumber || "—"}</p></div>
                      <div><p className="text-xs text-slate-400">Payment</p><p className="font-medium text-slate-700">{s.paymentType || "—"}</p></div>
                      <div><p className="text-xs text-slate-400">Submitted</p><p className="font-medium text-slate-700">{s.submittedAt ? new Date(s.submittedAt).toLocaleDateString() : "—"}</p></div>
                    </div>

                    {s.notes && (
                      <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
                        <span className="font-semibold">Note from TPF: </span>{s.notes}
                      </div>
                    )}

                    {s.documents && s.documents.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-slate-500 mb-2">Attached Documents</p>
                        <div className="space-y-1.5">
                          {s.documents.map((doc) => (
                            <div key={doc.id} className="flex items-center gap-2 rounded-lg bg-white border border-slate-200 px-3 py-2">
                              <FileText className="h-4 w-4 text-blue-500 flex-shrink-0" />
                              <div className="min-w-0 flex-1"><span className="text-sm text-slate-700 truncate">{doc.originalName}</span><CompressionInfo originalSize={doc.originalSize} compressedSize={doc.compressedSize} /></div>
                              <Badge variant="outline" className="text-[10px] px-1.5">{DOC_LABEL[doc.documentType] || doc.documentType}</Badge>
                              <a
                                href={`/api/portal/submissions/${s.id}/documents/${doc.id}/view`}
                                target="_blank"
                                rel="noreferrer"
                                className="p-1 hover:text-blue-600 text-slate-400"
                                title="View"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </a>
                              <a
                                href={`/api/portal/submissions/${s.id}/documents/${doc.id}/download`}
                                className="p-1 hover:text-blue-600 text-slate-400"
                                title="Download"
                              >
                                <Download className="h-3.5 w-3.5" />
                              </a>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                     {s.status === "funded" && (
                       <div>
                         <p className="text-xs font-semibold text-slate-500 mb-2">Funding Receipts</p>
                         {!s.receipts?.length ? (
                           <p className="rounded-lg bg-white px-3 py-2 text-xs text-slate-400 border border-slate-200">
                             No funding receipt available yet.
                           </p>
                         ) : (
                           <div className="space-y-1.5">
                             {s.receipts.map((receipt) => (
                               <div key={`${receipt.receiptNo}-${receipt.version}`} className="flex items-center gap-2 rounded-lg bg-white border border-slate-200 px-3 py-2">
                                 <ReceiptText className="h-4 w-4 text-violet-500 flex-shrink-0" />
                                 <div className="min-w-0 flex-1">
                                   <p className="truncate text-sm font-medium text-slate-700">{receipt.receiptNo} · Version {receipt.version}</p>
                                   <p className="text-xs text-slate-400">
                                     {receipt.createdAt || receipt.fundedAt ? new Date(receipt.createdAt || receipt.fundedAt || "").toLocaleDateString() : "Date unavailable"}
                                     {" · "}{receipt.paymentReference || "Payment reference pending"}
                                   </p>
                                 </div>
                                 <a
                                   href={`/api/portal/submissions/${s.id}/receipts/${encodeURIComponent(receipt.receiptNo)}/download?version=${receipt.version}`}
                                   target="_blank"
                                   rel="noreferrer"
                                   className="p-1 text-slate-400 hover:text-blue-600"
                                   title="Download funding receipt"
                                 >
                                   <Download className="h-3.5 w-3.5" />
                                 </a>
                               </div>
                             ))}
                           </div>
                         )}
                       </div>
                     )}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </PortalLayout>
  );
}
