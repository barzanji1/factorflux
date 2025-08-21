import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormFieldWithValidation } from "@/components/ui/form-field-with-validation";
import { AnimatedButton } from "@/components/ui/animated-button";
import { useFormValidation, commonValidations, asyncValidators } from "@/hooks/useFormValidation";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle, AlertCircle, Sparkles } from "lucide-react";
import { z } from "zod";

export default function FormDemo() {
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // Enhanced validation rules with async validators
  const {
    values,
    setValue,
    validationStates,
    handleBlur,
    handleSubmit,
    reset,
    isSubmitting,
    isFormValid,
    submitAttempted
  } = useFormValidation(
    { 
      email: "", 
      username: "",
      password: "", 
      confirmPassword: "",
      phone: "",
      website: ""
    },
    {
      email: {
        schema: commonValidations.email,
        asyncValidator: asyncValidators.emailExists,
        asyncMessage: "This email is already taken",
        debounceMs: 500
      },
      username: {
        schema: z.string().min(3, "Username must be at least 3 characters").max(20, "Username must be less than 20 characters"),
        asyncValidator: asyncValidators.usernameAvailable,
        asyncMessage: "Username is not available",
        debounceMs: 300
      },
      password: {
        schema: z.string()
          .min(8, "Password must be at least 8 characters")
          .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
          .regex(/[a-z]/, "Password must contain at least one lowercase letter")
          .regex(/\d/, "Password must contain at least one number")
      },
      confirmPassword: {
        schema: z.string().min(1, "Please confirm your password"),
        asyncValidator: async (value: string) => value === values.password,
        asyncMessage: "Passwords do not match"
      },
      phone: {
        schema: commonValidations.phone
      },
      website: {
        schema: commonValidations.url.optional().or(z.literal(""))
      }
    },
    { validateOnChange: true, validateOnBlur: true, debounceMs: 300 }
  );

  const onSubmit = async () => {
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 2000));
    setSubmitSuccess(true);
    
    // Auto-reset after success
    setTimeout(() => {
      reset();
      setSubmitSuccess(false);
    }, 3000);
  };

  const handleReset = () => {
    reset();
    setSubmitSuccess(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-100 p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center space-x-3 mb-4">
            <Sparkles className="w-8 h-8 text-purple-600" />
            <h1 className="text-4xl font-bold bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
              Form Validation Micro-Interactions
            </h1>
          </div>
          <p className="text-lg text-gray-600">
            Real-time validation with smooth animations and user feedback
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Form */}
          <div className="lg:col-span-2">
            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <CheckCircle className="w-5 h-5 text-green-500" />
                  <span>Advanced Registration Form</span>
                </CardTitle>
                <CardDescription>
                  Experience real-time validation with animated feedback as you type
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={(e) => { e.preventDefault(); handleSubmit(onSubmit); }} className="space-y-6">
                  {/* Email Field */}
                  <FormFieldWithValidation
                    label="Email Address"
                    name="email"
                    type="email"
                    placeholder="user@example.com"
                    value={values.email}
                    onChange={(value) => setValue("email", value)}
                    onBlur={() => handleBlur("email")}
                    validation={validationStates.email}
                    required
                  />

                  {/* Username Field */}
                  <FormFieldWithValidation
                    label="Username"
                    name="username"
                    placeholder="Choose a unique username"
                    value={values.username}
                    onChange={(value) => setValue("username", value)}
                    onBlur={() => handleBlur("username")}
                    validation={validationStates.username}
                    required
                  />

                  {/* Password Fields */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormFieldWithValidation
                      label="Password"
                      name="password"
                      type="password"
                      placeholder="Create a strong password"
                      value={values.password}
                      onChange={(value) => setValue("password", value)}
                      onBlur={() => handleBlur("password")}
                      validation={validationStates.password}
                      required
                    />

                    <FormFieldWithValidation
                      label="Confirm Password"
                      name="confirmPassword"
                      type="password"
                      placeholder="Confirm your password"
                      value={values.confirmPassword}
                      onChange={(value) => setValue("confirmPassword", value)}
                      onBlur={() => handleBlur("confirmPassword")}
                      validation={validationStates.confirmPassword}
                      required
                    />
                  </div>

                  {/* Optional Fields */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormFieldWithValidation
                      label="Phone Number"
                      name="phone"
                      type="tel"
                      placeholder="+1234567890"
                      value={values.phone}
                      onChange={(value) => setValue("phone", value)}
                      onBlur={() => handleBlur("phone")}
                      validation={validationStates.phone}
                    />

                    <FormFieldWithValidation
                      label="Website"
                      name="website"
                      type="url"
                      placeholder="https://yourwebsite.com"
                      value={values.website}
                      onChange={(value) => setValue("website", value)}
                      onBlur={() => handleBlur("website")}
                      validation={validationStates.website}
                    />
                  </div>

                  {/* Action Buttons */}
                  <div className="flex space-x-4 pt-4">
                    <AnimatedButton
                      type="submit"
                      className="flex-1"
                      loading={isSubmitting}
                      success={submitSuccess}
                      loadingText="Creating Account..."
                      successText="Account Created!"
                      disabled={!isFormValid && submitAttempted}
                    >
                      Create Account
                    </AnimatedButton>

                    <AnimatedButton
                      type="button"
                      variant="outline"
                      onClick={handleReset}
                      disabled={isSubmitting}
                    >
                      Reset Form
                    </AnimatedButton>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>

          {/* Features Sidebar */}
          <div className="space-y-6">
            {/* Feature Overview */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">✨ Features Showcase</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <Badge variant="secondary" className="w-fit">Real-time</Badge>
                    <span className="text-sm">Live validation as you type</span>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <Badge variant="secondary" className="w-fit">Async</Badge>
                    <span className="text-sm">Server-side validation checks</span>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <Badge variant="secondary" className="w-fit">Animated</Badge>
                    <span className="text-sm">Smooth visual feedback</span>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Badge variant="secondary" className="w-fit">Debounced</Badge>
                    <span className="text-sm">Optimized performance</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Validation Status */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">🔍 Validation Status</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {Object.entries(validationStates).map(([field, state]) => (
                    <div key={field} className="flex items-center justify-between">
                      <span className="text-sm font-medium capitalize">{field}:</span>
                      <div className="flex items-center space-x-2">
                        {state.isValidating ? (
                          <Badge variant="outline" className="animate-pulse">Checking...</Badge>
                        ) : state.isValid ? (
                          <Badge variant="default" className="bg-green-500">Valid</Badge>
                        ) : (
                          <Badge variant="destructive">Invalid</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                  
                  <Separator />
                  
                  <div className="flex items-center justify-between font-medium">
                    <span>Form Status:</span>
                    {isFormValid ? (
                      <Badge variant="default" className="bg-green-500">
                        <CheckCircle className="w-3 h-3 mr-1" />
                        Ready to Submit
                      </Badge>
                    ) : (
                      <Badge variant="outline">
                        <AlertCircle className="w-3 h-3 mr-1" />
                        Incomplete
                      </Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Tips */}
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                <strong>Try these interactions:</strong>
                <ul className="mt-2 space-y-1 text-xs">
                  <li>• Type "taken" in email to see async validation</li>
                  <li>• Try usernames: "admin", "root", "test"</li>
                  <li>• Watch password strength requirements</li>
                  <li>• Notice the smooth animations</li>
                </ul>
              </AlertDescription>
            </Alert>
          </div>
        </div>
      </div>
    </div>
  );
}