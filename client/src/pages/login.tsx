import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Lock, User, Eye, EyeOff } from "lucide-react";
import { FactorFluxLogo } from "@/components/brand/factorflux-logo";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useAuth } from "@/hooks/useAuth";
import { staffLoginSchema } from "@shared/staff-auth";

const loginSchema = staffLoginSchema;

type LoginFormData = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
      console.log("Attempting login with:", data.username);
      const success = await login(data.username, data.password);
      console.log("Login result:", success);
      
      if (success) {
        console.log("Login successful, redirecting to dashboard");
        // Use window.location for hard refresh to ensure state is properly updated
        window.location.href = "/";
      } else {
        console.log("Login failed - invalid credentials");
        setError("Invalid username or password. Please try again.");
      }
    } catch (error) {
      console.error("Login error:", error);
      setError("Login failed. Please check your connection and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="ff-auth-page min-h-screen bg-[#d4d0c8] flex items-center justify-center p-4">
      <div className="w-full max-w-[420px]">
        <Card className="ff-login-card shadow-none">
          <CardHeader className="ff-login-brand text-center">
            <div className="flex justify-center">
              <FactorFluxLogo
                linkToDashboard={false}
                inverted
                className="flex-col gap-1.5"
                markSrc="/images/ff-logo-emboss.png"
                markClassName="h-9 w-9"
              />
            </div>
            <p className="ff-login-tagline">Freight Factoring OS</p>
            <hr className="ff-login-divider" />
            <p className="ff-login-company">Trucking Pros Financial</p>
          </CardHeader>
          <CardContent className="ff-login-content">
            <div className="mb-4 space-y-2 text-center">
              <CardTitle className="ff-login-title">Agent Login</CardTitle>
              <CardDescription className="ff-login-description">Enter your credentials</CardDescription>
            </div>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email Address</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <User className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                          <Input
                            {...field}
                            type="email"
                            placeholder="you@company.com"
                            className="pl-10"
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
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                          <Input
                            {...field}
                            type={showPassword ? "text" : "password"}
                            placeholder="Enter your password"
                            className="pl-10 pr-14"
                            autoComplete="current-password"
                            disabled={isLoading}
                          />
                          <button
                            type="button"
                            className="absolute bottom-[2px] right-[2px] top-[2px] flex w-10 items-center justify-center border-l-2 border-[#808080] bg-[#d4d0c8] text-[#555] hover:bg-[#c8e7e9] hover:text-[#098b9f] focus-visible:z-10"
                            onClick={() => setShowPassword(!showPassword)}
                            aria-label={showPassword ? "Hide password" : "Show password"}
                            aria-pressed={showPassword}
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

                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <Button 
                  type="submit" 
                  className="w-full" 
                  disabled={isLoading}
                  data-testid="button-login"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    "Sign In"
                  )}
                </Button>
              </form>
            </Form>

            <div className="mt-5 text-center">
              <a className="ff-login-support" href="mailto:dosh@truckingprosfinancial.com">
                Contact IT support
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}