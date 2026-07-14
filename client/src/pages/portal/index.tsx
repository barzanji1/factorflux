import { Link } from "wouter";
import { Truck, CheckCircle, Shield, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PortalLanding() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex flex-col">
      <header className="px-6 py-4 flex items-center justify-between max-w-5xl mx-auto w-full">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500">
            <Truck className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="font-bold text-white text-sm leading-none">Carrier Portal</p>
            <p className="text-blue-300 text-[10px]">Trucking Pros Financial</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/portal/login">
            <Button variant="ghost" size="sm" className="text-slate-300 hover:text-white hover:bg-white/10">
              Sign in
            </Button>
          </Link>
          <Link href="/portal/register">
            <Button size="sm" className="bg-blue-500 hover:bg-blue-400 text-white">
              Get started
            </Button>
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-4 py-1.5 text-xs text-blue-300 mb-6">
            <Zap className="h-3 w-3" />
            Faster funding starts here
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4 leading-tight">
            Submit invoices.<br />
            <span className="text-blue-400">Get funded fast.</span>
          </h1>
          <p className="text-slate-400 text-lg mb-8 max-w-xl mx-auto">
            Upload your rate confirmations, BOLs, and invoices directly from your phone or desktop. Track every submission in real time.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-12">
            <Link href="/portal/register">
              <Button size="lg" className="bg-blue-500 hover:bg-blue-400 text-white px-8 w-full sm:w-auto">
                Register as a Carrier
              </Button>
            </Link>
            <Link href="/portal/login">
              <Button size="lg" className="bg-blue-500 hover:bg-blue-400 text-white px-8 w-full sm:w-auto">
                Sign In
              </Button>
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
            {[
              { icon: Zap, title: "Quick submission", desc: "Upload docs from any device, even by camera on mobile" },
              { icon: CheckCircle, title: "Real-time status", desc: "Track every invoice from submitted to funded" },
              { icon: Shield, title: "Secure & encrypted", desc: "Your documents are stored safely and accessible only to you" },
            ].map((f) => (
              <div key={f.title} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <f.icon className="h-5 w-5 text-blue-400 mb-2" />
                <p className="font-semibold text-white text-sm mb-1">{f.title}</p>
                <p className="text-slate-400 text-xs">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </main>

      <footer className="px-6 py-4 text-center text-xs text-slate-600">
        © {new Date().getFullYear()} Trucking Pros Financial · Carrier Portal
      </footer>
    </div>
  );
}
