import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { PlusCircle, FileText, Clock, CheckCircle, XCircle, DollarSign, Loader2, AlertCircle } from "lucide-react";
import PortalLayout from "@/components/layout/portal-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface PortalUser {
  id: number; email: string; companyName: string; mcNumber?: string; dotNumber?: string; status: string;
}
interface Submission {
  id: number; invoiceNumber?: string; loadNumber?: string; brokerName?: string;
  amount?: string; status: string; submittedAt?: string;
}

const STATUS_BADGE: Record<string, JSX.Element> = {
  submitted:    <Badge className="bg-blue-100 text-blue-700">Submitted</Badge>,
  under_review: <Badge className="bg-amber-100 text-amber-700">Under Review</Badge>,
  approved:     <Badge className="bg-emerald-100 text-emerald-700">Approved</Badge>,
  funded:       <Badge className="bg-purple-100 text-purple-700">Funded</Badge>,
  rejected:     <Badge className="bg-red-100 text-red-700">Rejected</Badge>,
};

function agingBucket(dateStr?: string) {
  if (!dateStr) return "0-30";
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export default function PortalDashboard() {
  const [, setLocation] = useLocation();

  const { data: me, isLoading: meLoading } = useQuery<PortalUser>({
    queryKey: ["/api/portal/me"],
    retry: false,
  });

  const { data: submissions = [], isLoading: subsLoading } = useQuery<Submission[]>({
    queryKey: ["/api/portal/submissions"],
    enabled: !!me,
  });

  useEffect(() => {
    if (!meLoading && !me) setLocation("/portal/login");
  }, [me, meLoading, setLocation]);

  if (meLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (me?.status === "pending") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <Card className="max-w-md w-full text-center">
          <CardContent className="pt-8 pb-8">
            <AlertCircle className="h-10 w-10 text-amber-500 mx-auto mb-3" />
            <h2 className="font-bold text-slate-900 text-lg mb-2">Account Pending Approval</h2>
            <p className="text-slate-500 text-sm">Your account is under review by the TPF team. You'll be notified once approved.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (me?.status === "suspended") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <Card className="max-w-md w-full text-center">
          <CardContent className="pt-8 pb-8">
            <XCircle className="h-10 w-10 text-red-500 mx-auto mb-3" />
            <h2 className="font-bold text-slate-900 text-lg mb-2">Account Suspended</h2>
            <p className="text-slate-500 text-sm">Please contact TPF support for assistance.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const aging = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  submissions.filter((s) => ["submitted", "under_review"].includes(s.status)).forEach((s) => {
    aging[agingBucket(s.submittedAt)]++;
  });

  const recent = [...submissions].sort((a, b) =>
    new Date(b.submittedAt || 0).getTime() - new Date(a.submittedAt || 0).getTime()
  ).slice(0, 5);

  const totalFunded = submissions.filter((s) => s.status === "funded").reduce((sum, s) => sum + parseFloat(s.amount || "0"), 0);
  const pending = submissions.filter((s) => ["submitted", "under_review"].includes(s.status)).length;

  return (
    <PortalLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Welcome, {me?.companyName}</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {me?.mcNumber && `MC# ${me.mcNumber}`}{me?.mcNumber && me?.dotNumber && " · "}{me?.dotNumber && `DOT# ${me.dotNumber}`}
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Submissions", value: submissions.length, icon: FileText, color: "text-blue-600", bg: "bg-blue-50" },
            { label: "Pending Review", value: pending, icon: Clock, color: "text-amber-600", bg: "bg-amber-50" },
            { label: "Funded", value: submissions.filter(s => s.status === "funded").length, icon: CheckCircle, color: "text-emerald-600", bg: "bg-emerald-50" },
            { label: "Total Funded", value: `$${totalFunded.toLocaleString()}`, icon: DollarSign, color: "text-purple-600", bg: "bg-purple-50" },
          ].map((s) => (
            <Card key={s.label} className="rounded-2xl">
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0 ${s.bg}`}>
                  <s.icon className={`h-4 w-4 ${s.color}`} />
                </div>
                <div>
                  <p className="text-xs text-slate-500">{s.label}</p>
                  <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Invoice Aging */}
        <Card className="rounded-2xl">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-slate-700">Invoice Aging (open submissions)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-3">
              {(["0-30", "31-60", "61-90", "90+"] as const).map((b) => (
                <div key={b} className="text-center">
                  <p className="text-2xl font-bold text-slate-900">{aging[b]}</p>
                  <p className="text-xs text-slate-500">{b} days</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Link href="/portal/submit">
            <Button className="w-full gap-2 h-12 bg-blue-600 hover:bg-blue-700">
              <PlusCircle className="h-4 w-4" />
              Submit Invoice
            </Button>
          </Link>
          <Link href="/portal/submissions">
            <Button variant="outline" className="w-full gap-2 h-12">
              <FileText className="h-4 w-4" />
              View All Submissions
            </Button>
          </Link>
        </div>

        {/* Recent */}
        {recent.length > 0 && (
          <Card className="rounded-2xl">
            <CardHeader className="border-b border-slate-100 pb-3">
              <CardTitle className="text-sm font-semibold text-slate-700">Recent Submissions</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {subsLoading ? (
                <div className="p-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-blue-500" /></div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {recent.map((s) => (
                    <Link key={s.id} href={`/portal/submissions`}>
                      <div className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 cursor-pointer">
                        <div>
                          <p className="font-medium text-sm text-slate-900">
                            {s.invoiceNumber || s.loadNumber || `Submission #${s.id}`}
                          </p>
                          <p className="text-xs text-slate-400">
                            {s.brokerName && `${s.brokerName} · `}
                            {s.submittedAt ? new Date(s.submittedAt).toLocaleDateString() : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          {s.amount && <span className="text-sm font-semibold text-slate-700">${parseFloat(s.amount).toLocaleString()}</span>}
                          {STATUS_BADGE[s.status]}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </PortalLayout>
  );
}
