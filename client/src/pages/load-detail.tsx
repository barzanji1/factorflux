import { useParams, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Badge, Button, Card, Tabs, TabsContent, TabsList, TabsTrigger, AdminPageShell } from "@/components/admin-neu/adapters";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, Package, FileText, FileCheck, Truck,
  MapPin, Calendar, DollarSign, ExternalLink,
  User, Clock, ReceiptText,
} from "lucide-react";
import DocumentIntakeZone from "@/components/documents/document-intake-zone";
import EntityNotes from "@/components/shared/EntityNotes";
import { PageInsights } from "@/components/PageInsights";
import "@/components/admin-neu/admin-neu-page.css";

// ─── Status helpers ───────────────────────────────────────────────────────────

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
    <div className="flex items-start justify-between gap-4 border-b border-[#d0d0d0] py-2.5 last:border-0">
      <span className="shrink-0 text-xs text-[#888]">{label}</span>
      <span className={cn("text-right text-xs font-medium text-[#444]", mono && "font-mono")}>
        {value ?? "—"}
      </span>
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
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#e0e0e0]">
        <p className="text-[#777]">Invalid load ID.</p>
      </div>
    );
  }

  return (
    <div className="ff-admin-page flex min-h-[100dvh] bg-[#e0e0e0]">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopNav
          title="Load Detail"
          subtitle="Load record, documents, and OCR extraction"
          group="Workspace"
        />

        <AdminPageShell className="flex-1 overflow-y-auto !min-h-0 px-6 py-6">
          {/* Back */}
          <Button
            type="button"
            onClick={() => navigate("/documents")}
            variant="ghost"
            className="mb-4 flex items-center gap-1.5 text-xs text-[#666]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Documents
          </Button>

          {loadLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-32 w-full rounded-2xl" />
              <Skeleton className="h-64 w-full rounded-2xl" />
            </div>
          ) : !load ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Package className="mb-3 h-10 w-10 text-[#c5c5c5]" />
              <p className="text-sm text-[#777]">Load #{loadId} not found.</p>
              <Button variant="outline" size="sm" className="mt-4 rounded-xl text-xs" onClick={() => navigate("/documents")}>
                Back
              </Button>
            </div>
          ) : (
            <div className="space-y-5">
              <PageInsights entity="loads" entityId={loadId} title="Load activity" />
              {/* Header card */}
              <Card className="rounded-2xl p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#e0e0e0] shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff]">
                      <Truck className="h-6 w-6 text-[#168d99]" />
                    </div>
                    <div>
                      <h1 className="text-lg font-bold tracking-tight text-[#333]">
                        Load #{load.loadNumber}
                      </h1>
                      <p className="text-xs text-[#777]">
                        {load.clientName ?? `Client #${load.clientId}`}
                        {load.driverName ? ` · ${load.driverName}` : ""}
                      </p>
                    </div>
                  </div>
                  <Badge tone={load.status === "delivered" || load.status === "paid" ? "success" : load.status === "pending" ? "warning" : "accent"} className="capitalize">
                    {(load.status ?? "pending").replace(/_/g, " ")}
                  </Badge>
                </div>

                {/* Metric strip */}
                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[#c9c9c9] pt-4 sm:grid-cols-4">
                  {[
                    { icon: <DollarSign className="h-3.5 w-3.5" />, label: "Rate",     value: fmtCurrency(load.rate),          color: "text-[#168d99]" },
                    { icon: <MapPin className="h-3.5 w-3.5" />,     label: "Pickup",   value: load.pickupLocation ?? "—",       color: "text-[#666]" },
                    { icon: <MapPin className="h-3.5 w-3.5" />,     label: "Delivery", value: load.deliveryLocation ?? "—",     color: "text-[#666]" },
                    { icon: <FileText className="h-3.5 w-3.5" />,   label: "Docs",     value: String(docs?.length ?? 0),        color: "text-[#168d99]"   },
                  ].map(({ icon, label, value, color }) => (
                    <div key={label} className="flex flex-col gap-0.5">
                      <div className={cn("flex items-center gap-1 text-[11px]", color)}>
                        {icon}
                        <span className="font-medium uppercase tracking-wider text-[#888]">{label}</span>
                      </div>
                      <span className="text-sm font-semibold text-[#333]">{value}</span>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Two-column layout */}
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_280px]">
                {/* Main content — tabs */}
                <Card className="rounded-2xl">
                  <Tabs defaultValue="documents">
                    <div className="border-b border-[#c9c9c9] px-5 pt-4">
                      <TabsList className="h-auto gap-1 rounded-none bg-transparent p-0">
                        {[
                          { value: "documents", label: "Documents", icon: <FileText className="h-3.5 w-3.5" />, count: docs?.length },
                          { value: "overview",  label: "Overview",  icon: <ReceiptText className="h-3.5 w-3.5" /> },
                        ].map(({ value, label, icon, count }: any) => (
                          <TabsTrigger
                            key={value}
                            value={value}
                            className="flex items-center gap-1.5 px-3 text-xs font-semibold"
                          >
                            {icon}{label}
                            {count != null && count > 0 && (
                              <span className="ml-1 rounded-full bg-[#e0e0e0] px-1.5 py-0.5 text-[10px] font-bold text-[#555] shadow-[inset_2px_2px_4px_#b8b8b8,inset_-2px_-2px_4px_#fff]">{count}</span>
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
                          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#888]">
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
                            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#888]">
                              Uploaded ({docs.length})
                            </h3>
                            <div className="space-y-2">
                              {docs.map((doc: any) => (
                                <div key={doc.id} className="flex items-center justify-between rounded-xl bg-[#e0e0e0] px-4 py-3 shadow-[-3px_-3px_7px_#fff,3px_3px_7px_#c1c1c1]">
                                  <div className="flex items-center gap-3">
                                    <FileCheck className="h-4 w-4 shrink-0 text-[#168d99]" />
                                    <div>
                                      <p className="text-sm font-medium text-[#333]">{doc.originalName}</p>
                                      <p className="text-xs text-[#777]">
                                        {doc.documentType.replace(/_/g, " ")} · {(doc.size / 1024).toFixed(1)} KB
                                      </p>
                                    </div>
                                  </div>
                          <Badge tone={doc.status === "processed" ? "success" : "warning"} className="px-2.5 py-0.5 text-[11px]">
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
                          <Badge tone={load.status === "delivered" || load.status === "paid" ? "success" : load.status === "pending" ? "warning" : "accent"} className="capitalize">
                            {(load.status ?? "—").replace(/_/g, " ")}
                          </Badge>
                        } />
                        <DataRow label="Created"         value={fmtDate(load.createdAt)} />
                      </div>
                      {load.invoiceId && (
                        <div className="mt-4 border-t border-[#c9c9c9] pt-4">
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
                </Card>

                {/* Right rail */}
                <div className="space-y-4">
                  {/* Quick info card */}
                  <Card className="rounded-2xl p-4">
                    <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#888]">
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
                          <div className="mt-0.5 text-[#888]">{icon}</div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] text-[#888]">{label}</p>
                            <p className="truncate text-xs font-medium text-[#444]">{value}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>

                  {/* Linked invoice */}
                  {load.invoiceId && (
                    <Card className="rounded-2xl p-4">
                      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#888]">
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
                    </Card>
                  )}

                  {/* Doc count */}
                  <Card className="rounded-2xl p-4">
                    <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#888]">
                      Documents
                    </h3>
                    <p className="text-2xl font-bold text-[#333]">{docs?.length ?? 0}</p>
                    <p className="text-xs text-[#777]">{docs?.filter((d: any) => d.status === "processed").length ?? 0} extracted</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3 w-full gap-1.5 rounded-xl text-xs"
                      onClick={() => navigate("/documents")}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      View all documents
                    </Button>
                  </Card>
                </div>
              </div>
              <EntityNotes key={`load:${loadId}`} entityType="load" entityId={loadId} />
            </div>
          )}
        </AdminPageShell>
      </div>
    </div>
  );
}
