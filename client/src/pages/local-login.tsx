import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Eye, EyeOff } from "lucide-react";
import factorFluxLogo from "@assets/FactorFlux-icon_1774282916669.png";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { FormFieldWithValidation } from "@/components/ui/form-field-with-validation";
import { AnimatedButton } from "@/components/ui/animated-button";
import { useFormValidation, commonValidations } from "@/hooks/useFormValidation";
import { z } from "zod";

export default function LocalLogin() {
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  // Form validation setup
  const {
    values,
    setValue,
    validationStates,
    handleBlur,
    handleSubmit,
    isFormValid,
  } = useFormValidation(
    { email: "", password: "" },
    {
      email: {
        schema: commonValidations.email,
        message: "Please enter a valid email address"
      },
      password: {
        schema: z.string().min(1, "Password is required"),
        message: "Password is required"
      }
    },
    { validateOnChange: true, validateOnBlur: true }
  );

  const onSubmit = async () => {
    setError("");
    setIsSubmitting(true);

    try {
      // Try production fix endpoint first
      let response = await fetch("/api/auth/production-fix", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ 
          email: values.email, 
          password: values.password 
        }),
      });

      // If production fix fails, try standard login
      if (!response.ok) {
        response = await fetch("/api/auth/local/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({ 
            email: values.email, 
            password: values.password 
          }),
        });
      }

      if (response.ok) {
        setSubmitSuccess(true);
        // Login successful, invalidate auth cache and redirect to dashboard
        await queryClient.invalidateQueries({ queryKey: ["/api/auth/local/check"] });
        // Force a refetch to update auth state
        await queryClient.refetchQueries({ queryKey: ["/api/auth/local/check"] });
        // Clear any existing error state
        setError("");
        // Small delay to show success animation
        setTimeout(() => {
          setLocation("/");
        }, 1000);
      } else {
        const data = await response.json();
        setError(data.message || "Login failed");
        setSubmitSuccess(false);
      }
    } catch (err) {
      console.error("Login error:", err);
      setError("Network error. Please try again.");
      setSubmitSuccess(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center space-x-3 mb-6">
            <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center shadow-md overflow-hidden">
              <img src={factorFluxLogo} alt="FactorFlux" className="w-10 h-10 object-contain" />
            </div>
            <h1 className="text-3xl font-bold text-secondary">FactorFlux</h1>
          </div>
          <p className="text-sm text-gray-500">
            Trucking Pros Financial - Agent Access
          </p>
        </div>

        {/* Login Form */}
        <Card>
          <CardHeader>
            <CardTitle>Sign In</CardTitle>
            <CardDescription>
              Enter your agent credentials to access the system
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => { e.preventDefault(); handleSubmit(onSubmit); }} className="space-y-6">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {/* Email Field with Validation */}
              <FormFieldWithValidation
                label="Email"
                name="email"
                type="email"
                placeholder="admin@example.com"
                value={values.email}
                onChange={(value) => setValue("email", value)}
                onBlur={() => handleBlur("email")}
                validation={validationStates.email}
                required
              />

              {/* Password Field with Validation */}
              <FormFieldWithValidation
                label="Password"
                name="password"
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                value={values.password}
                onChange={(value) => setValue("password", value)}
                onBlur={() => handleBlur("password")}
                validation={validationStates.password}
                required
              />

              {/* Animated Submit Button */}
              <AnimatedButton
                type="submit"
                className="w-full"
                loading={isSubmitting}
                success={submitSuccess}
                loadingText="Signing In..."
                successText="Login Successful!"
                disabled={!isFormValid && Object.keys(validationStates).length > 0}
              >
                Sign In
              </AnimatedButton>
            </form>


          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center mt-8 text-sm text-gray-500">
          <p>Secure local authentication for FactorFlux</p>
        </div>
      </div>
    </div>
  );
}