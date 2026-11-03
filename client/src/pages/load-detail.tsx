import { useParams, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, Package, FileText, FileCheck, Truck,
  MapPin, Calendar, DollarSign, ExternalLink,
  User, Clock, ReceiptText,
} from "lucide-react";
import DocumentIntakeZone from "@/components/documents/document-intake-zone";
import EntityNotes from "@/components/shared/EntityNotes";

// ─── Status helpers ───────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  pending:    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  in_transit: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  delivered:  "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  invoiced:   "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  paid:       "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-400",
};

function fmt(v: string | number | null | undefined, prefix = "") {
  if (v == null || v === "") return "—";
  return `${prefix}${v}`;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtCurrency(v: string | null | undefined) {
  if (!v) return "—";
  const n = parseFloat(v);
  return isNaN(n) ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function DataRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-50 py-2.5 last:border-0 dark:border-slate-800/60">
      <span className="shrink-0 text-xs text-slate-400">{label}</span>
      <span className={cn("text-right text-xs font-medium text-slate-700 dark:text-slate-200", mono && "font-mono")}>
        {value ?? "—"}
      </span>
    </div>
  );
}

function EmptyState({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-300 dark:text-slate-600">
      <div className="text-slate-200 dark:text-slate-700">{icon}</div>
      <p className="text-sm text-slate-400 dark:text-slate-500">{label}</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function LoadDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const loadId = parseInt(id ?? "0", 10);

  const { data: load, isLoading: loadLoading } = useQuery<any>({
    queryKey: ["/api/loads", loadId],
    queryFn: async () => {
      const r = await fetch(`/api/loads/${loadId}`, { credentials: "include" });
      if (!r.ok) throw new Error("Not found");
      return r.json();
    },
    enabled: !isNaN(loadId) && loadId > 0,
  });

  const { data: docs } = useQuery<any[]>({
    queryKey: ["/api/documents", { load: loadId }],
    queryFn: async () => {
      const r = await fetch(`/api/documents?load=${loadId}`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !isNaN(loadId) && loadId > 0,
  });

  if (isNaN(loadId) || loadId <= 0) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-slate-400">Invalid load ID.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[hsl(var(--background))]">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopNav
          title="Load Detail"
          subtitle="Load record, documents, and OCR extraction"
          group="Workspace"
        />

        <main className="flex-1 overflow-y-auto px-6 py-6">
          {/* Back */}
          <button
            onClick={() => navigate("/documents")}
            className="mb-4 flex items-center gap-1.5 text-xs text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-300"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Documents
          </button>

          {loadLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-32 w-full rounded-2xl" />
              <Skeleton className="h-64 w-full rounded-2xl" />
            </div>
          ) : !load ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Package className="mb-3 h-10 w-10 text-slate-200" />
              <p className="text-sm text-slate-400">Load #{loadId} not found.</p>
              <Button variant="outline" size="sm" className="mt-4 rounded-xl text-xs" onClick={() => navigate("/documents")}>
                Back
              </Button>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Header card */}
              <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-100 dark:bg-blue-950/40">
                      <Truck className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                        Load #{load.loadNumber}
                      </h1>
                      <p className="text-xs text-slate-400">
                        {load.clientName ?? `Client #${load.clientId}`}
                        {load.driverName ? ` · ${load.driverName}` : ""}
                      </p>
                    </div>
                  </div>
                  <Badge className={cn("rounded-full border px-3 py-1 text-xs font-semibold capitalize", STATUS_COLORS[load.status] ?? STATUS_COLORS.pending)}>
                    {(load.status ?? "pending").replace(/_/g, " ")}
                  </Badge>
                </div>

                {/* Metric strip */}
                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-50 pt-4 dark:border-slate-800 sm:grid-cols-4">
                  {[
                    { icon: <DollarSign className="h-3.5 w-3.5" />, label: "Rate",     value: fmtCurrency(load.rate),          color: "text-emerald-600" },
                    { icon: <MapPin className="h-3.5 w-3.5" />,     label: "Pickup",   value: load.pickupLocation ?? "—",       color: "text-slate-500"  },
                    { icon: <MapPin className="h-3.5 w-3.5" />,     label: "Delivery", value: load.deliveryLocation ?? "—",     color: "text-slate-500"  },
                    { icon: <FileText className="h-3.5 w-3.5" />,   label: "Docs",     value: String(docs?.length ?? 0),        color: "text-blue-500"   },
                  ].map(({ icon, label, value, color }) => (
                    <div key={label} className="flex flex-col gap-0.5">
                      <div className={cn("flex items-center gap-1 text-[11px]", color)}>
                        {icon}
                        <span className="font-medium uppercase tracking-wider text-slate-400">{label}</span>
                      </div>
                      <span className="text-sm font-semibold text-slate-800 dark:text-white">{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Two-column layout */}
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_280px]">
                {/* Main content — tabs */}
                <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
                  <Tabs defaultValue="documents">
                    <div className="border-b border-slate-100 px-5 pt-4 dark:border-slate-800">
                      <TabsList className="h-auto gap-1 rounded-none bg-transparent p-0">
                        {[
                          { value: "documents", label: "Documents", icon: <FileText className="h-3.5 w-3.5" />, count: docs?.length },
                          { value: "overview",  label: "Overview",  icon: <ReceiptText className="h-3.5 w-3.5" /> },
                        ].map(({ value, label, icon, count }: any) => (
                          <TabsTrigger
                            key={value}
                            value={value}
                            className="flex items-center gap-1.5 rounded-none border-b-2 border-transparent px-3 pb-3 pt-1 text-xs font-semibold text-slate-500 transition-colors data-[state=active]:border-blue-600 data-[state=active]:text-blue-700 dark:text-slate-400 dark:data-[state=active]:text-blue-300"
                          >
                            {icon}{label}
                            {count != null && count > 0 && (
                              <span className="ml-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{count}</span>
                            )}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </div>

                    {/* ── Documents tab ─────────────────────────── */}
                    <TabsContent value="documents" className="p-5">
                      <div className="space-y-6">
                        {/* Drag-and-drop intake */}
                        <div>
                          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                            Upload Documents
                          </h3>
                          <DocumentIntakeZone
                            entityType="load"
                            entityId={loadId}
                            onUploadComplete={() => {
                              qc.invalidateQueries({ queryKey: ["/api/documents", { load: loadId }] });
                            }}
                          />
                        </div>

                        {/* Existing docs list */}
                        {!!docs?.length && (
                          <div>
                            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                              Uploaded ({docs.length})
                            </h3>
                            <div className="space-y-2">
                              {docs.map((doc: any) => (
                                <div key={doc.id} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/40">
                                  <div className="flex items-center gap-3">
                                    <FileCheck className="h-4 w-4 shrink-0 text-blue-500" />
                                    <div>
                                      <p className="text-sm font-medium text-slate-800 dark:text-white">{doc.originalName}</p>
                                      <p className="text-xs text-slate-400">
                                        {doc.documentType.replace(/_/g, " ")} · {(doc.size / 1024).toFixed(1)} KB
                                      </p>
                                    </div>
                                  </div>
                                  <Badge className={cn(
                                    "rounded-full border px-2.5 py-0.5 text-[11px]",
                                    doc.status === "processed"
                                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                      : "border-amber-200 bg-amber-50 text-amber-700",
                                  )}>
                                    {doc.status}
                                  </Badge>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </TabsContent>

                    {/* ── Overview tab ──────────────────────────── */}
                    <TabsContent value="overview" className="p-5">
                      <div className="space-y-1">
                        <DataRow label="Load #"          value={load.loadNumber} mono />
                        <DataRow label="Client"          value={load.clientName ?? `#${load.clientId}`} />
                        <DataRow label="Driver"          value={load.driverName} />
                        <DataRow label="Pickup Location" value={load.pickupLocation} />
                        <DataRow label="Delivery Location" value={load.deliveryLocation} />
                        <DataRow label="Pickup Date"     value={fmtDate(load.pickupDate)} />
                        <DataRow label="Delivery Date"   value={fmtDate(load.deliveryDate)} />
                        <DataRow label="Rate"            value={fmtCurrency(load.rate)} />
                        <DataRow label="Status"          value={
                          <Badge className={cn("rounded-full border px-2 py-0 text-[11px] capitalize", STATUS_COLORS[load.status] ?? STATUS_COLORS.pending)}>
                            {(load.status ?? "—").replace(/_/g, " ")}
                          </Badge>
                        } />
                        <DataRow label="Created"         value={fmtDate(load.createdAt)} />
                      </div>
                      {load.invoiceId && (
                        <div className="mt-4 border-t border-slate-50 pt-4 dark:border-slate-800">
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 rounded-xl text-xs"
                            onClick={() => navigate(`/invoices/${load.invoiceId}`)}
                          >
                            <ReceiptText className="h-3.5 w-3.5" />
                            View Linked Invoice
                            <ExternalLink className="h-3 w-3 opacity-50" />
                          </Button>
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                </div>

                {/* Right rail */}
                <div className="space-y-4">
                  {/* Quick info card */}
                  <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
                    <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Load Info
                    </h3>
                    <div className="space-y-2.5">
                      {[
                        { icon: <User className="h-3.5 w-3.5" />,     label: "Driver",    value: load.driverName ?? "—" },
                        { icon: <Calendar className="h-3.5 w-3.5" />, label: "Pickup",    value: fmtDate(load.pickupDate) },
                        { icon: <Calendar className="h-3.5 w-3.5" />, label: "Delivery",  value: fmtDate(load.deliveryDate) },
                        { icon: <Clock className="h-3.5 w-3.5" />,    label: "Created",   value: fmtDate(load.createdAt) },
                      ].map(({ icon, label, value }) => (
                        <div key={label} className="flex items-start gap-2.5">
                          <div className="mt-0.5 text-slate-400">{icon}</div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] text-slate-400">{label}</p>
                            <p className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">{value}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Linked invoice */}
                  {load.invoiceId && (
                    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
                      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        Linked Invoice
                      </h3>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full gap-1.5 rounded-xl text-xs"
                        onClick={() => navigate(`/invoices/${load.invoiceId}`)}
                      >
                        <ReceiptText className="h-3.5 w-3.5" />
                        Invoice #{load.invoiceNumber ?? load.invoiceId}
                        <ExternalLink className="h-3 w-3 ml-auto opacity-40" />
                      </Button>
                    </div>
                  )}

                  {/* Doc count */}
                  <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-[hsl(var(--card))]">
                    <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Documents
                    </h3>
                    <p className="text-2xl font-bold text-slate-800 dark:text-white">{docs?.length ?? 0}</p>
                    <p className="text-xs text-slate-400">{docs?.filter((d: any) => d.status === "processed").length ?? 0} extracted</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3 w-full gap-1.5 rounded-xl text-xs"
                      onClick={() => navigate("/documents")}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      View all documents
                    </Button>
                  </div>
                </div>
              </div>
              <EntityNotes key={`load:${loadId}`} entityType="load" entityId={loadId} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
