import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { FactorFluxLogo } from "@/components/brand/factorflux-logo";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

const schema = z.object({
  email: z.string().email("Valid email required"),
  password: z.string().min(1, "Password required"),
});
type LoginForm = z.infer<typeof schema>;

export default function PortalLogin() {
  const [, setLocation] = useLocation();
  const [showPw, setShowPw] = useState(false);
  const queryClient = useQueryClient();

  const form = useForm<LoginForm>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const mutation = useMutation({
    mutationFn: async (data: LoginForm) => {
      const res = await fetch("/api/portal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Login failed");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal/me"] });
      setLocation("/portal/dashboard");
    },
  });

  return (
    <div className="ff-auth-page ff-portal-shell min-h-screen bg-[#d4d0c8] flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl border border-slate-200 p-8 max-w-sm w-full shadow-sm">
        <div className="flex items-center gap-2.5 mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white border border-slate-200 shadow-sm">
            <FactorFluxLogo showWordmark={false} markSrc="/images/ff-logo-emboss.png" markClassName="h-9 w-9" />
          </div>
          <div>
            <p className="font-bold text-slate-900 text-sm leading-tight tracking-tight">FactorFlux</p>
            <p className="text-slate-400 text-[10px] leading-tight">Trucking Pros Financial</p>
          </div>
        </div>

        <h1 className="text-xl font-bold text-slate-900 mb-1">Sign in</h1>
        <p className="text-sm text-slate-500 mb-6">Access your carrier account to submit and track invoices.</p>

        {mutation.error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {(mutation.error as Error).message}
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem>
                <FormLabel>Email Address</FormLabel>
                <FormControl><Input {...field} type="email" placeholder="you@company.com" autoComplete="email" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="password" render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Input {...field} type={showPw ? "text" : "password"} placeholder="Your password" autoComplete="current-password" className="pr-14" />
                    <button type="button" onClick={() => setShowPw(!showPw)} className="absolute bottom-[2px] right-[2px] top-[2px] flex w-10 items-center justify-center border-l-2 border-[#808080] bg-[#d4d0c8] text-[#555] hover:bg-[#c8e7e9] hover:text-[#098b9f] focus-visible:z-10" aria-label={showPw ? "Hide password" : "Show password"} aria-pressed={showPw}>
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <Button type="submit" className="w-full" disabled={mutation.isPending}>
              {mutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in…</> : "Sign In"}
            </Button>
          </form>
        </Form>

        <p className="text-center text-sm text-slate-500 mt-4">
          New carrier?{" "}
          <Link href="/portal/register" className="text-blue-600 hover:underline font-medium">Create account</Link>
        </p>
      </div>
    </div>
  );
}
