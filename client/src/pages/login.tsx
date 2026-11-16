import { startTransition, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { loadPage } from "@/lib/lazy-page";
import { loadStaffRoute } from "@/lib/staff-entry";
import { LiquidGlassPanel } from "@/components/liquid-glass/LiquidGlassPanel";
import { useStaffLoginRipples } from "@/hooks/use-staff-login-ripples";
import { Loader2, Lock, Mail, Eye, EyeOff } from "lucide-react";
import { FactorFluxLogo } from "@/components/brand/factorflux-logo";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useAuth } from "@/hooks/useAuth";
import { NeuNotice } from "@/components/shared/NeuNotice";
import { staffLoginSchema } from "@shared/staff-auth";
import "./login.css";
import "./staff-login-ripples.css";

const loginSchema = staffLoginSchema;

type LoginFormData = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const warmDestination = () => {
    // Download code on form intent; protected data still requires authentication.
    void Promise.all([loadPage("/"), loadStaffRoute()]).catch(() => undefined);
  };
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [shakeCount, setShakeCount] = useState(0);
  const mainRef = useRef<HTMLElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const transitionBusy = useRef(false);
  const authenticationBusy = useRef(false);
  authenticationBusy.current = isLoading;
  useStaffLoginRipples(cardRef, false, transitionBusy, authenticationBusy);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    performance.mark("staff-login:mounted");
    return () => {
      mounted.current = false;
      performance.mark("staff-login:unmounted");
    };
  }, []);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  const onSubmit = async (data: LoginFormData) => {
    authenticationBusy.current = true;
    setIsLoading(true);
    setError("");

    try {
      performance.mark("staff-login:submit");
      // Download public application code during authentication, not afterwards.
      // Observe failures immediately, but report them only if login succeeds.
      const destination = Promise.all([loadPage("/"), loadStaffRoute()])
        .then(() => ({ error: null }), error => ({ error }));
      const success = await login(data.username, data.password);
      performance.mark("staff-login:authentication-finished");
      if (!mounted.current) performance.mark("staff-login:abandoned");
      if (!mounted.current) return;
      if (success) {
        // Keep the real form steady while the destination loads. No copied
        // glass panel, fullscreen overlay, or expanding success ripples.
        const prepared = await destination;
        performance.mark("staff-login:destination-ready");
        if (prepared.error) throw prepared.error;
        if (!mounted.current) return;
        startTransition(() => setLocation("/"));
      } else {
        setError("Invalid email or password. Please try again.");
        setShakeCount((count) => count + 1);
        setIsLoading(false);
      }
    } catch {
      setError("Login failed. Please check your connection and try again.");
      setShakeCount((count) => count + 1);
      setIsLoading(false);
    }
  };

  return (
    <main ref={mainRef} className="ff-login-page">
      <div className="ff-login-stage">
        <LiquidGlassPanel
          ref={cardRef}
          enableRipples={false}
          className={`ff-login-card${shakeCount ? ` ff-login-card--shake-${shakeCount % 2}` : ""}`}
          aria-busy={isLoading}
          scene={{
            src: "/assets/tpf-building-refined.jpg",
            position: "center 46%",
            size: "cover",
            filter: "brightness(0.62) saturate(0.76) contrast(1.05)",
            overlay: "linear-gradient(135deg, rgba(19, 45, 63, 0.15), rgba(25, 51, 72, 0.3))",
            containerRef: mainRef,
          }}
        >
          <header className="ff-login-brand">
            <div className="flex justify-center">
              <FactorFluxLogo
                linkToDashboard={false}
                showWordmark={false}
                markSrc="/images/ff-login-two-tone.webp"
                className="flex-col gap-1"
                markClassName="h-14 w-14"
              />
            </div>
            <p className="ff-login-product">FactorFlux</p>
            <p className="ff-login-tagline">Freight Factoring OS</p>
            <p className="ff-login-company">Trucking Pros Financial</p>
          </header>
          <section className="ff-login-content">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} onFocusCapture={warmDestination} className="ff-login-form">
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor="ff-login-email" className="ff-login-label">Email address</FormLabel>
                        <div className="ff-login-input-wrap">
                          <Mail className="ff-login-input-icon" aria-hidden="true" />
                          <FormControl>
                          <input
                            {...field}
                            id="ff-login-email"
                            type="email"
                            placeholder="Email Address"
                            className="ff-login-input ff-login-email-input"
                            autoComplete="email"
                            disabled={isLoading}
                          />
                          </FormControl>
                        </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel htmlFor="ff-login-password" className="ff-login-label">Password</FormLabel>
                        <div className="ff-login-input-wrap">
                          <Lock className="ff-login-input-icon" aria-hidden="true" />
                          <FormControl>
                          <input
                            {...field}
                            id="ff-login-password"
                            type={showPassword ? "text" : "password"}
                            placeholder="Password"
                            className="ff-login-input ff-login-password-input"
                            autoComplete="current-password"
                            disabled={isLoading}
                          />
                          </FormControl>
                          <button
                            type="button"
                            className="ff-login-toggle"
                            onClick={() => setShowPassword(!showPassword)}
                            aria-label={showPassword ? "Hide password" : "Show password"}
                            aria-pressed={showPassword}
                            disabled={isLoading}
                          >
                            {showPassword ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <button
                  type="submit"
                  className="ff-login-submit"
                  disabled={isLoading}
                  data-testid="button-login"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                      Signing in...
                    </>
                  ) : (
                    "SIGN IN"
                  )}
                </button>
              </form>
            </Form>

            <div className="ff-login-error" role="alert" aria-live="assertive" aria-atomic="true">
              {error && <NeuNotice severity="block">{error}</NeuNotice>}
            </div>
            <div className="ff-login-support-wrap">
              <a className="ff-login-support" href="mailto:dosh@truckingprosfinancial.com">
                Contact IT support for credential issues
              </a>
            </div>
          </section>
        </LiquidGlassPanel>
      </div>
      <div className="ff-login-status" role="status" aria-live="polite" aria-atomic="true">
        {isLoading ? "Signing in…" : ""}
      </div>
    </main>
  );
}