import { useQuery } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, ExternalLink, Pencil } from "lucide-react";

export default function FuelAdvanceDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/fuel-advances", id],
    queryFn: async () => {
      const r = await fetch(`/api/fuel-advances/${id}`, { credentials: "include" });
      if (!r.ok) throw new Error("Fuel advance not found");
      return r.json();
    },
  });
  if (isLoading) return <div className="p-8">Loading fuel advance…</div>;
  if (!data) return <div className="p-8">Fuel advance not found.</div>;
  const money = (v: any) => v === null || v === undefined || v === ""
    ? "—"
    : `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  const metrics = [
    ["Created", data.createdAt ? new Date(data.createdAt).toLocaleDateString() : "—"],
    ["Rate", money(data.rate)], ["Factored", money(data.advanceAmount)],
    ["Percentage", data.faPercent === null || data.faPercent === undefined || data.faPercent === "" ? "—" : `${Number(data.faPercent)}%`], ["Fees", money(data.fees)],
    ["Owed", money(data.owed)],
    ["Type", data.type], ["Delivery Date", data.deliveryDate ? new Date(data.deliveryDate).toLocaleDateString() : "—"],
    ["Authorized Inquirer", data.authorizedAgentName || data.processedByName || data.processedBy],
  ];
  return <div className="ff-fuel-advance-page flex min-h-screen bg-[#d4d0c8] text-[#263b44]"><Sidebar /><div className="flex min-w-0 flex-1 flex-col"><TopNav title="Fuel Advance Detail" subtitle={`Record #${id}`} group="Funding" /><main className="flex-1 overflow-auto p-3 md:p-5"><div className="mx-auto max-w-[1400px] space-y-3">
    <div className="ff-card ff-fuel-advance-surface flex flex-wrap justify-between gap-2 border border-[#718087] bg-white p-3"><Button variant="outline" size="sm" onClick={() => navigate("/fuel-advance")}><ArrowLeft className="mr-1 h-4 w-4" />Close</Button><Button size="sm" onClick={() => navigate(`/fuel-advance?edit=${id}`)}><Pencil className="mr-1 h-4 w-4" />Edit</Button></div>
    <div className="grid gap-3 lg:grid-cols-2"><Card className="ff-fuel-advance-surface border-[#9eabad]"><CardHeader><CardTitle className="text-base">Advance metrics</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-3 text-sm">{metrics.map(([key, value]) => <div key={key} className="border-b border-[#d4dcde] pb-2"><p className="text-[10px] uppercase text-[#718187]">{key}</p><p className="font-semibold">{value || "—"}</p></div>)}</CardContent></Card>
      <Card className="ff-fuel-advance-surface border-[#9eabad]"><CardHeader><CardTitle className="text-base">Rate confirmation</CardTitle></CardHeader><CardContent>{data.rateConS3Key ? <iframe title="Rate confirmation PDF" src={`/api/fuel-advances/${id}/rate-con/view`} className="ff-fuel-advance-surface h-[560px] w-full border" /> : <p className="text-sm text-[#63767d]">No rate confirmation PDF attached.</p>}<Button asChild variant="outline" size="sm" className="mt-3"><a href={`/api/fuel-advances/${id}/deposit-slip?download=1`}>Download deposit slip <ExternalLink className="ml-1 h-3 w-3" /></a></Button></CardContent></Card>
    </div></div></main></div></div>;
}