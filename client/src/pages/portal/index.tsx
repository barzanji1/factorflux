import { Link } from "wouter";
import { CheckCircle, Shield, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TpfLogo } from "@/components/brand/tpf-logo";

export default function PortalLanding() {
  return (
    <div className="ff-portal-shell min-h-screen bg-[#d4d0c8] flex flex-col">
      <header className="px-6 py-4 flex items-center justify-between max-w-5xl mx-auto w-full">
         <TpfLogo markClassName="h-9 w-9" />
        <div className="flex items-center gap-2">
          <Link href="/portal/login">
            <Button variant="ghost" size="sm">
               Sign in
            </Button>
          </Link>
          <Link href="/portal/register">
            <Button size="sm">
               Get started
            </Button>
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center">
        <div className="max-w-2xl">
          <div className="ff-btn-secondary inline-flex items-center gap-2 px-4 py-1.5 text-xs text-[#444] mb-6">
            <Zap className="h-3 w-3" />
            Faster funding starts here
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-[#1a1a1a] mb-4 leading-tight">
            Submit invoices.<br />
            <span className="text-[#098b9f]">Get funded fast.</span>
          </h1>
          <p className="text-[#444] text-lg mb-8 max-w-xl mx-auto">
            Upload your rate confirmations, BOLs, and invoices directly from your phone or desktop. Track every submission in real time.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-12">
            <Link href="/portal/register">
              <Button size="lg" className="px-8 w-full sm:w-auto">
                Register as a Carrier
              </Button>
            </Link>
            <Link href="/portal/login">
              <Button size="lg" className="px-8 w-full sm:w-auto">
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
              <div key={f.title} className="ff-card p-4">
                <f.icon className="h-5 w-5 text-[#098b9f] mb-2" />
                <p className="font-semibold text-[#1a1a1a] text-sm mb-1">{f.title}</p>
                <p className="text-[#444] text-xs">{f.desc}</p>
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
