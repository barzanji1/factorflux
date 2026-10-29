import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, Lock, User, Eye, EyeOff } from "lucide-react";
import { FactorFluxLogo } from "@/components/brand/factorflux-logo";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { useAuth } from "@/hooks/useAuth";
import { staffLoginSchema } from "@shared/staff-auth";
import "./login.css";

const loginSchema = staffLoginSchema;

type LoginFormData = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [shakeCount, setShakeCount] = useState(0);
  const [isRotating, setIsRotating] = useState(false);
  const rotationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didNavigate = useRef(false);

  useEffect(() => () => {
    if (rotationTimer.current) clearTimeout(rotationTimer.current);
    if (navigationTimer.current) clearTimeout(navigationTimer.current);
  }, []);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    setError("");

    try {
      const success = await login(data.username, data.password);
      if (success) {
        setIsRotating(true);
        // Keep a fallback so reduced motion or a cancelled animation never blocks navigation.
        navigationTimer.current = setTimeout(() => {
          if (!didNavigate.current) {
            didNavigate.current = true;
            setLocation("/");
          }
        }, 1400);
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

  const finishRotation = () => {
    if (didNavigate.current) return;
    didNavigate.current = true;
    if (navigationTimer.current) clearTimeout(navigationTimer.current);
    rotationTimer.current = setTimeout(() => setLocation("/"), 0);
  };

  return (
    <main className="ff-login-page">
      <Card
        className={`ff-login-card${isRotating ? " ff-login-card--rotating" : shakeCount ? ` ff-login-card--shake-${shakeCount % 2}` : ""}`}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget && event.animationName === "ff-login-rotate") finishRotation();
        }}
        aria-busy={isLoading}
      >
          <CardHeader className="ff-login-brand">
            <div className="flex justify-center">
              <FactorFluxLogo
                linkToDashboard={false}
                showWordmark={false}
                className="flex-col gap-1.5"
                markClassName="h-10 w-10"
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
                      <FormControl>
                        <div className="ff-login-input-wrap">
                          <User className="ff-login-input-icon" aria-hidden="true" />
                          <Input
                            {...field}
                            type="email"
                            placeholder="Email Address"
                            className="ff-login-input ff-login-email-input"
                            aria-label="Email address"
                            autoComplete="email"
                            disabled={isLoading}
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <div className="ff-login-input-wrap">
                          <Lock className="ff-login-input-icon" aria-hidden="true" />
                          <Input
                            {...field}
                            type={showPassword ? "text" : "password"}
                            placeholder="Password"
                            className="ff-login-input ff-login-password-input"
                            aria-label="Password"
                            autoComplete="current-password"
                            disabled={isLoading}
                          />
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
                      </FormControl>
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
                    "Sign In"
                  )}
                </Button>
              </form>
            </Form>

            <div className="ff-login-error" role="alert" aria-live="assertive" aria-atomic="true">
              {error}
            </div>
            <div className="ff-login-support-wrap">
              <a className="ff-login-support" href="mailto:dosh@truckingprosfinancial.com">
                Contact IT support for credential issues
              </a>
            </div>
          </CardContent>
      </Card>
      <div className="ff-login-status" role="status" aria-live="polite" aria-atomic="true">
        {isLoading ? "Signing in…" : ""}
      </div>
    </main>
  );
}