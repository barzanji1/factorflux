import { useState } from "react";
import { useLocation, Link } from "wouter";
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
      <div className="w-full max-w-md">
        <Card className="shadow-none">
          <CardHeader className="space-y-2 text-center">
            <div className="flex justify-center">
              <FactorFluxLogo linkToDashboard={false} className="flex-col" markSrc="/images/ff-logo-emboss.png" markClassName="h-9 w-9" />
            </div>
            <p className="text-[#444]">Freight Factoring OS</p>
            <hr className="w-full border-0 border-t border-[#b0ada6]" />
            <p className="text-lg font-semibold text-[#1a1a1a]">Trucking Pros Financial</p>
          </CardHeader>
          <CardContent>
            <div className="mb-4 space-y-2 text-center">
              <CardTitle className="text-2xl font-bold">Agent Login</CardTitle>
              <CardDescription>
                Enter your credentials to access the system
              </CardDescription>
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

            <div className="mt-6 text-center text-sm text-gray-600 dark:text-gray-300">
              <p className="text-xs">Contact IT support for credential issues</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}