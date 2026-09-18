import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Truck, Eye, EyeOff, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { FactorFluxLogo } from "@/components/brand/factorflux-logo";

const schema = z.object({
  companyName: z.string().min(2, "Company name required"),
  mcNumber: z.string().optional(),
  dotNumber: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Valid email required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});
type RegisterForm = z.infer<typeof schema>;

export default function PortalRegister() {
  const [, setLocation] = useLocation();
  const [showPw, setShowPw] = useState(false);
  const [done, setDone] = useState(false);

  const form = useForm<RegisterForm>({
    resolver: zodResolver(schema),
    defaultValues: { companyName: "", mcNumber: "", dotNumber: "", phone: "", email: "", password: "", confirmPassword: "" },
  });

  const mutation = useMutation({
    mutationFn: async (data: RegisterForm) => {
      const res = await fetch("/api/portal/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName: data.companyName, mcNumber: data.mcNumber, dotNumber: data.dotNumber, phone: data.phone, email: data.email, password: data.password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Registration failed");
      return json;
    },
    onSuccess: () => setDone(true),
  });

  if (done) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-8 max-w-md w-full text-center shadow-sm">
          <div className="h-12 w-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
            <Truck className="h-6 w-6 text-emerald-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Registration submitted!</h2>
          <p className="text-slate-500 text-sm mb-6">Your account is pending approval by the TPF team. You'll be able to log in once approved.</p>
          <Link href="/portal/login">
            <Button className="w-full">Go to Sign In</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-8">
      <div className="bg-white rounded-2xl border border-slate-200 p-8 max-w-md w-full shadow-sm">
        <div className="flex items-center gap-2 mb-6">
          <FactorFluxLogo showWordmark={false} shine markClassName="h-9 w-9" />
          <div>
            <p className="font-bold text-slate-900 text-sm leading-none">Carrier Portal</p>
            <p className="text-slate-400 text-[10px]">Trucking Pros Financial</p>
          </div>
        </div>

        <h1 className="text-xl font-bold text-slate-900 mb-1">Create your account</h1>
        <p className="text-sm text-slate-500 mb-6">Register to start submitting invoices for factoring.</p>

        {mutation.error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {(mutation.error as Error).message}
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
            <FormField control={form.control} name="companyName" render={({ field }) => (
              <FormItem>
                <FormLabel>Company Name *</FormLabel>
                <FormControl><Input {...field} placeholder="ABC Trucking LLC" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="mcNumber" render={({ field }) => (
                <FormItem>
                  <FormLabel>MC Number</FormLabel>
                  <FormControl><Input {...field} placeholder="MC-123456" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="dotNumber" render={({ field }) => (
                <FormItem>
                  <FormLabel>DOT Number</FormLabel>
                  <FormControl><Input {...field} placeholder="DOT-123456" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="phone" render={({ field }) => (
              <FormItem>
                <FormLabel>Phone</FormLabel>
                <FormControl><Input {...field} type="tel" placeholder="(555) 123-4567" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem>
                <FormLabel>Email Address *</FormLabel>
                <FormControl><Input {...field} type="email" placeholder="you@company.com" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="password" render={({ field }) => (
              <FormItem>
                <FormLabel>Password *</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Input {...field} type={showPw ? "text" : "password"} placeholder="Min 8 characters" />
                    <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="confirmPassword" render={({ field }) => (
              <FormItem>
                <FormLabel>Confirm Password *</FormLabel>
                <FormControl><Input {...field} type="password" placeholder="Repeat password" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <Button type="submit" className="w-full" disabled={mutation.isPending}>
              {mutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating account…</> : "Create Account"}
            </Button>
          </form>
        </Form>

        <p className="text-center text-sm text-slate-500 mt-4">
          Already have an account?{" "}
          <Link href="/portal/login" className="text-blue-600 hover:underline font-medium">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
