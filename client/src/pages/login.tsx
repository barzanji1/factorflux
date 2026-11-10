import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useLocation } from "wouter";
import { playLoginSuccess, type LoginSuccessTransition } from "@/lib/login-ripple";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import "./login-glass.css";

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
  const transitionRef = useRef<LoginSuccessTransition | null>(null);
  const mounted = useRef(true);
  const lastRipple = useRef({ x: -999, y: -999, time: 0 });

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

  // Ambient fingertip ripple: one small ring per meaningful pointer movement over the card.
  const handleCardPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const card = event.currentTarget;
    const rect = card.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const last = lastRipple.current;
    const now = performance.now();
    if (Math.hypot(x - last.x, y - last.y) < 56 || now - last.time < 140) return;
    lastRipple.current = { x, y, time: now };
    const ripple = document.createElement("span");
    ripple.className = "ff-login-hover-ripple";
    ripple.setAttribute("aria-hidden", "true");
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
    card.appendChild(ripple);
  };

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    setError("");

    try {
      const success = await login(data.username, data.password);
      if (!mounted.current) return;
      if (success) {
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
        <Card
          className={`ff-login-card${shakeCount ? ` ff-login-card--shake-${shakeCount % 2}` : ""}`}
          aria-busy={isLoading}
          onPointerMove={handleCardPointerMove}
        >
          <svg className="ff-login-lens-light" viewBox="0 0 400 450" preserveAspectRatio="none" fill="none" aria-hidden="true" focusable="false">
            <defs>
              <linearGradient id="login-lens-cool" x1="0" y1="170" x2="120" y2="0" gradientUnits="userSpaceOnUse">
                <stop stopColor="#b0f4ff" stopOpacity="0" />
                <stop offset=".48" stopColor="#b0f4ff" stopOpacity=".2" />
                <stop offset=".7" stopColor="#fff" stopOpacity=".85" />
                <stop offset="1" stopColor="#b0f4ff" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="login-lens-warm" x1="280" y1="450" x2="400" y2="310" gradientUnits="userSpaceOnUse">
                <stop stopColor="#a4f5ff" stopOpacity="0" />
                <stop offset=".55" stopColor="#b9f6ff" stopOpacity=".6" />
                <stop offset=".8" stopColor="#ffe1b7" stopOpacity=".7" />
                <stop offset="1" stopColor="#fff" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d="M 2 180 C 0 88 9 73 50 58 C 84 46 83 13 120 1" stroke="url(#login-lens-cool)" strokeWidth="7" opacity=".2" />
            <path d="M 2 180 C 0 88 9 73 50 58 C 84 46 83 13 120 1" stroke="url(#login-lens-cool)" strokeWidth="1.2" />
            <path d="M 280 449 C 328 432 367 449 383 411 C 395 383 390 349 399 310" stroke="url(#login-lens-warm)" strokeWidth="8" opacity=".18" />
            <path d="M 280 449 C 328 432 367 449 383 411 C 395 383 390 349 399 310" stroke="url(#login-lens-warm)" strokeWidth="1.2" />
          </svg>
          <CardHeader className="ff-login-brand">
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
          </CardHeader>
          <CardContent className="ff-login-content">
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
                          <Input
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
                          <Input
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

                <Button
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
                </Button>
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
          </CardContent>
        </Card>
      </div>
      <div className="ff-login-status" role="status" aria-live="polite" aria-atomic="true">
        {isLoading ? "Signing in…" : ""}
      </div>
    </main>
  );
}