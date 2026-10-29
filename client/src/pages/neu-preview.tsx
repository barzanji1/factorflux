import React, { useState } from "react";
import { ArrowDownRight, ArrowUpRight, CheckCircle2, CircleDollarSign, Truck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import AccessDenied from "@/pages/access-denied";
import {
  NeuBadge,
  NeuButton,
  NeuCard,
  NeuInput,
  NeuPageShell,
  NeuSelect,
  NeuStatCard,
  NeuTab,
  NeuTabList,
  NeuTabPanel,
  NeuTable,
  NeuTableBody,
  NeuTableCell,
  NeuTableHead,
  NeuTableHeader,
  NeuTableRow,
  NeuTabs,
} from "@/styles/neu";

const sampleInvoices = [
  { id: "TPF-2841", carrier: "Redwood Hauling", amount: "$8,420.00", status: "Ready" },
  { id: "TPF-2838", carrier: "Northline Freight", amount: "$5,975.50", status: "Review" },
  { id: "TPF-2834", carrier: "Summit Ridge Transport", amount: "$12,160.00", status: "Funded" },
];

function PreviewContent() {
  const [activeTab, setActiveTab] = useState("overview");
  const [carrier, setCarrier] = useState("Redwood Hauling");
  const [invoiceAmount, setInvoiceAmount] = useState("8420");
  const [queueFilter, setQueueFilter] = useState("all");
  const [lane, setLane] = useState("midwest");
  const [reviewNote, setReviewNote] = useState("Rate confirmation and POD attached.");
  const [notice, setNotice] = useState("");

  const formattedAmount = Number(invoiceAmount || 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
  const visibleInvoices = sampleInvoices.filter((invoice) => {
    if (queueFilter === "all") return true;
    return invoice.status.toLowerCase() === queueFilter;
  });

  return (
    <NeuPageShell className="px-4 py-8 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <header className="mb-10 flex flex-col gap-6 border-b border-[#c9c9c9] pb-8 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-[#27aab8]">Trucking Pros Financial</p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">FactorFlux component preview</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#777777]">
              A review-only neumorphic system for freight factoring operations. Every record below is sample data.
            </p>
          </div>
          <div className="flex items-center gap-3 self-start rounded-full bg-[#e0e0e0] px-4 py-2 text-xs font-semibold text-[#777777] shadow-[inset_3px_3px_7px_#b8b8b8,inset_-3px_-3px_7px_#ffffff] md:self-auto">
            <span className="h-2 w-2 rounded-full bg-[#27aab8]" />
            UI review mode
          </div>
        </header>

        <section aria-labelledby="stats-heading">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#888888]">01 / Surface language</p>
              <h2 id="stats-heading" className="mt-1 text-xl font-semibold">Operational snapshot</h2>
            </div>
            <span className="hidden text-xs text-[#888888] sm:block">Sample figures · not live</span>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <NeuStatCard label="Ready to fund" value="$26,555" detail="3 sample invoices" icon={<CircleDollarSign size={19} />} />
            <NeuStatCard label="In review" value="08" detail="2 awaiting documents" icon={<ArrowUpRight size={19} />} />
            <NeuStatCard label="Carriers active" value="142" detail="Across 6 sample lanes" icon={<Truck size={19} />} />
            <NeuStatCard label="Avg. turnaround" value="3.4h" detail="↓ 18 min vs. prior week" icon={<ArrowDownRight size={19} />} />
          </div>
        </section>

        <section className="mt-12 grid gap-8 lg:grid-cols-[1.1fr_0.9fr]" aria-label="Component samples">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#888888]">02 / Raised and pressed</p>
            <h2 className="mb-5 mt-1 text-xl font-semibold">Surfaces & actions</h2>
            <div className="grid gap-5 sm:grid-cols-2">
              <NeuCard className="p-5">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#888888]">Convex card</p>
                <p className="mt-3 text-lg font-semibold">A raised work surface</p>
                <p className="mt-2 text-sm leading-6 text-[#777777]">Soft light from above-left; a grounded lower-right edge.</p>
              </NeuCard>
              <NeuCard pressed className="p-5">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#888888]">Concave card</p>
                <p className="mt-3 text-lg font-semibold">An inset work surface</p>
                <p className="mt-2 text-sm leading-6 text-[#777777]">Useful for contained values and quiet groupings.</p>
              </NeuCard>
              <NeuCard className="p-5 sm:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-5">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#888888]">Button states</p>
                    <p className="mt-2 text-sm text-[#777777]">Press to show the tactile active state. Focus with Tab.</p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <NeuButton onClick={() => setNotice("Standard action pressed.")}>Standard action</NeuButton>
                    <NeuButton variant="accent" onClick={() => setNotice("Review action selected.")}>Review invoice</NeuButton>
                    <NeuButton disabled>Unavailable</NeuButton>
                  </div>
                </div>
                {notice && <p role="status" className="mt-4 text-sm font-medium text-[#27aab8]">{notice}</p>}
              </NeuCard>
            </div>
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#888888]">03 / Status language</p>
            <h2 className="mb-5 mt-1 text-xl font-semibold">Badges & form controls</h2>
            <NeuCard className="space-y-6 p-5">
              <div>
                <p className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-[#888888]">Status badges</p>
                <div className="flex flex-wrap gap-3">
                  <NeuBadge>Pending review</NeuBadge>
                  <NeuBadge tone="accent"><span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-[#27aab8]" />Ready to fund</NeuBadge>
                  <NeuBadge tone="success">Funded</NeuBadge>
                  <NeuBadge tone="warning">Needs documents</NeuBadge>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-semibold">
                  Carrier name
                  <NeuInput className="mt-2" value={carrier} onChange={(event) => setCarrier(event.target.value)} placeholder="Enter carrier" />
                </label>
                <label className="block text-sm font-semibold">
                  Invoice amount
                  <NeuInput className="mt-2" inputMode="decimal" type="number" min="0" step="0.01" value={invoiceAmount} onChange={(event) => setInvoiceAmount(event.target.value)} />
                </label>
                <label className="block text-sm font-semibold">
                  Review queue
                  <NeuSelect className="mt-2" value={queueFilter} onChange={(event) => setQueueFilter(event.target.value)}>
                    <option value="all">All sample invoices</option>
                    <option value="ready">Ready</option>
                    <option value="review">Review</option>
                    <option value="funded">Funded</option>
                  </NeuSelect>
                </label>
                <label className="block text-sm font-semibold">
                  Service lane
                  <NeuSelect
                    className="mt-2"
                    value={lane}
                    onChange={(event) => setLane(event.target.value)}
                    options={[
                      { value: "midwest", label: "Midwest" },
                      { value: "south", label: "South" },
                      { value: "west", label: "West" },
                    ]}
                  />
                </label>
                <label className="block text-sm font-semibold sm:col-span-2">
                  Review note
                  <NeuInput className="mt-2" value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} />
                </label>
              </div>
              <div className="rounded-xl bg-[#e0e0e0] p-4 text-sm text-[#777777] shadow-[inset_4px_4px_9px_#b8b8b8,inset_-4px_-4px_9px_#ffffff]">
                <span className="font-semibold text-[#333333]">Live form preview: </span>
                {carrier || "No carrier"} · {formattedAmount} · {lane} lane · {reviewNote || "No note"}
              </div>
            </NeuCard>
          </div>
        </section>

        <section className="mt-12" aria-labelledby="tabs-heading">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#888888]">04 / Navigation pattern</p>
          <h2 id="tabs-heading" className="mb-5 mt-1 text-xl font-semibold">Accessible tabs & semantic table</h2>
          <NeuTabs value={activeTab} onValueChange={setActiveTab}>
            <NeuTabList aria-label="Sample invoice views">
              <NeuTab value="overview">Overview</NeuTab>
              <NeuTab value="documents">Documents</NeuTab>
              <NeuTab value="history">Activity</NeuTab>
            </NeuTabList>
            <NeuTabPanel value="overview">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold">Invoice review queue</h3>
                  <p className="mt-1 text-sm text-[#888888]">Filtered by: {queueFilter === "all" ? "all statuses" : queueFilter}</p>
                </div>
                <NeuBadge tone="accent">{visibleInvoices.length} sample records</NeuBadge>
              </div>
              <NeuTable>
                <NeuTableHeader>
                  <tr>
                    <NeuTableHead>Reference</NeuTableHead>
                    <NeuTableHead>Carrier</NeuTableHead>
                    <NeuTableHead>Invoice</NeuTableHead>
                    <NeuTableHead>Status</NeuTableHead>
                  </tr>
                </NeuTableHeader>
                <NeuTableBody>
                  {visibleInvoices.length > 0 ? visibleInvoices.map((invoice) => (
                    <NeuTableRow key={invoice.id}>
                      <NeuTableCell className="font-semibold">{invoice.id}</NeuTableCell>
                      <NeuTableCell>{invoice.carrier}</NeuTableCell>
                      <NeuTableCell>{invoice.amount}</NeuTableCell>
                      <NeuTableCell><NeuBadge tone={invoice.status === "Funded" ? "success" : invoice.status === "Review" ? "warning" : "accent"}>{invoice.status}</NeuBadge></NeuTableCell>
                    </NeuTableRow>
                  )) : (
                    <NeuTableRow><NeuTableCell colSpan={4} className="py-8 text-center text-[#888888]">No sample invoices match this status.</NeuTableCell></NeuTableRow>
                  )}
                </NeuTableBody>
              </NeuTable>
            </NeuTabPanel>
            <NeuTabPanel value="documents">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 shrink-0 text-[#27aab8]" size={19} />
                <div>
                  <h3 className="font-semibold">Documents received</h3>
                  <p className="mt-1 text-sm leading-6 text-[#777777]">Rate confirmation and proof of delivery are present in this sample record.</p>
                </div>
              </div>
            </NeuTabPanel>
            <NeuTabPanel value="history">
              <h3 className="font-semibold">Sample activity</h3>
              <ol className="mt-4 space-y-3 text-sm text-[#777777]">
                <li><span className="mr-2 font-mono text-xs text-[#27aab8]">09:42</span>Invoice packet received</li>
                <li><span className="mr-2 font-mono text-xs text-[#27aab8]">10:16</span>Verification moved to review</li>
              </ol>
            </NeuTabPanel>
          </NeuTabs>
          <p className="mt-3 text-xs text-[#888888]">Keyboard: arrows move between tabs; Home and End jump to the first and last tabs.</p>
        </section>

        <footer className="mt-12 flex flex-col gap-4 border-t border-[#c9c9c9] py-6 text-xs text-[#888888] sm:flex-row sm:items-center sm:justify-between">
          <span>FactorFlux · neumorphic library review</span>
          <span>Demonstration only. No live operations or API mutations.</span>
        </footer>
      </div>
    </NeuPageShell>
  );
}

export default function NeuPreviewPage() {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return (
      <NeuPageShell className="grid place-items-center p-8">
        <div aria-label="Loading access" className="w-full max-w-xl space-y-4">
          <div className="h-8 w-48 animate-pulse rounded-lg bg-[#d6d6d6]" />
          <div className="h-28 animate-pulse rounded-2xl bg-[#d6d6d6]" />
          <div className="h-44 animate-pulse rounded-2xl bg-[#d6d6d6]" />
        </div>
      </NeuPageShell>
    );
  }
  if (user?.role !== "admin") return <AccessDenied />;
  return <PreviewContent />;
}
