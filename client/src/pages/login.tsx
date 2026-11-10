import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { playLoginSuccess, type LoginSuccessTransition } from "@/lib/login-ripple";
import { preloadPage } from "@/lib/lazy-page";
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
  const transitionRef = useRef<LoginSuccessTransition | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const transition = transitionRef.current;
      if (transition && !transition.hasNavigated) transition.cancel();
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
      const success = await login(data.username, data.password);
      if (!mounted.current) return;
      if (success) {
        preloadPage("/");
        transitionBusy.current = true;
        const card = mainRef.current?.querySelector<HTMLElement>(".ff-login-card") ?? null;
        const button = mainRef.current?.querySelector<HTMLElement>(".ff-login-submit") ?? null;
        transitionRef.current = playLoginSuccess(card, () => setLocation("/"), button);
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
            src: "/assets/tpf-building.jpg",
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
              <form onSubmit={form.handleSubmit(onSubmit)} className="ff-login-form">
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