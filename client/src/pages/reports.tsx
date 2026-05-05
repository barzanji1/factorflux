import TopNav from "@/components/layout/top-nav";
import Sidebar from "@/components/layout/sidebar";
import { Link } from "wouter";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  BarChart3,
  CreditCard,
  LifeBuoy,
  Mail,
  Phone,
  ShieldCheck,
  FileText,
} from "lucide-react";

export default function Reports() {
  const [paymentData, setPaymentData] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    fetch("https://secure.truckingprosfinancial.com/wp-json/frm/v2/views/82676?return=html")
      .then((response) => response.json())
      .then((data) => {
        if (data && data.renderedHtml) {
          setPaymentData(data.renderedHtml);
        } else {
          setError("No payment data available");
        }
      })
      .catch((err) => {
        setError("Failed to load payment data: " + err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return (
    <div className="flex h-screen bg-[hsl(var(--background))]">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav
          title="Reports"
          subtitle="Funding performance, portfolio views, and financial reporting"
          group="Recovery"
        />

        <main className="custom-scrollbar flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1680px] p-6 xl:p-8 space-y-8">
            {/* Top row */}
            <section className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:w-[70%]">
                <div className="rounded-[22px] border border-[hsl(var(--border))] bg-white p-5 shadow-md dark:bg-[hsl(var(--card))]">
                  <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400">
                    <BarChart3 className="h-5 w-5" />
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Report Source</p>
                  <p className="mt-2 text-lg font-bold text-slate-900 dark:text-white">
                    TPF Payments
                  </p>
                </div>

                <div className="rounded-[22px] border border-[hsl(var(--border))] bg-white p-5 shadow-md dark:bg-[hsl(var(--card))]">
                  <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">
                    <CreditCard className="h-5 w-5" />
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Data Feed</p>
                  <p className="mt-2 text-lg font-bold text-slate-900 dark:text-white">
                    Live View
                  </p>
                </div>

                <div className="rounded-[22px] border border-[hsl(var(--border))] bg-white p-5 shadow-md dark:bg-[hsl(var(--card))]">
                  <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Access</p>
                  <p className="mt-2 text-lg font-bold text-slate-900 dark:text-white">
                    Internal Only
                  </p>
                </div>
              </div>

              <div>
                <Link href="/">
                  <Button className="h-12 rounded-2xl bg-blue-600 px-5 text-white hover:bg-blue-700">
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Home
                  </Button>
                </Link>
              </div>
            </section>

            {/* Main report card */}
            <section>
              <Card className="rounded-[24px] border border-[hsl(var(--border))] bg-white shadow-md dark:bg-[hsl(var(--card))]">
                <CardHeader className="border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400">
                      <FileText className="h-6 w-6" />
                    </div>

                    <div>
                      <CardTitle className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
                        TPF Payment Details
                      </CardTitle>
                      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                        View payment information and account details from Trucking Pros Financial.
                      </p>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-6">
                  {loading && (
                    <div className="flex items-center justify-center py-16">
                      <div className="h-10 w-10 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />
                      <span className="ml-4 text-sm font-medium text-slate-600 dark:text-slate-300">
                        Loading payment details...
                      </span>
                    </div>
                  )}

                  {error && (
                    <div className="rounded-[20px] border border-red-200 bg-red-50 p-5 dark:border-red-900/40 dark:bg-red-950/20">
                      <p className="text-sm font-medium text-red-700 dark:text-red-300">
                        {error}
                      </p>
                    </div>
                  )}

                  {paymentData && (
                    <div className="custom-scrollbar overflow-x-auto rounded-[20px] border border-slate-200 dark:border-slate-800">
                      <div
                        className="
                          min-w-full
                          [&_table]:w-full
                          [&_table]:border-collapse
                          [&_table]:bg-white
                          [&_table]:dark:bg-slate-900
                          [&_thead]:bg-slate-50
                          [&_thead]:dark:bg-slate-800
                          [&_th]:px-6
                          [&_th]:py-4
                          [&_th]:text-left
                          [&_th]:text-xs
                          [&_th]:font-semibold
                          [&_th]:uppercase
                          [&_th]:tracking-[0.12em]
                          [&_th]:text-slate-500
                          [&_th]:border-b
                          [&_th]:border-slate-200
                          [&_th]:dark:border-slate-700
                          [&_td]:px-6
                          [&_td]:py-4
                          [&_td]:text-sm
                          [&_td]:text-slate-700
                          [&_td]:dark:text-slate-200
                          [&_tbody_tr]:border-b
                          [&_tbody_tr]:border-slate-100
                          [&_tbody_tr]:dark:border-slate-800
                          [&_tbody_tr:hover]:bg-slate-50/80
                          [&_tbody_tr:hover]:dark:bg-slate-800/40
                          [&_.to_right]:text-right
                          [&_.to_right]:font-semibold
                        "
                        dangerouslySetInnerHTML={{ __html: paymentData }}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>

            {/* Support */}
            <section>
              <Card className="rounded-[24px] border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white shadow-md dark:border-emerald-900/40 dark:from-emerald-950/20 dark:to-slate-950/30">
                <CardHeader className="border-b border-emerald-100 dark:border-emerald-900/30">
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                      <LifeBuoy className="h-6 w-6" />
                    </div>

                    <div>
                      <CardTitle className="text-xl font-semibold text-slate-900 dark:text-white">
                        Need Assistance?
                      </CardTitle>
                      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                        Our support team can help with forms, applications, and Trucking Pros Financial services.
                      </p>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-6">
                  <div className="flex flex-col gap-4 sm:flex-row">
                    <a href="mailto:support@truckingprosfinancial.com" className="flex-1">
                      <Button className="h-12 w-full rounded-2xl bg-emerald-600 text-white hover:bg-emerald-700">
                        <Mail className="mr-2 h-4 w-4" />
                        Email Support
                      </Button>
                    </a>

                    <a href="tel:+1-800-TPF-HELP" className="flex-1">
                      <Button className="h-12 w-full rounded-2xl bg-emerald-600 text-white hover:bg-emerald-700">
                        <Phone className="mr-2 h-4 w-4" />
                        Call Support
                      </Button>
                    </a>
                  </div>
                </CardContent>
              </Card>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}