import { useState, useCallback, useEffect } from "react";
import { z } from "zod";

interface ValidationRule {
  schema: z.ZodSchema;
  message?: string;
  asyncValidator?: (value: string) => Promise<boolean>;
  asyncMessage?: string;
  debounceMs?: number;
}

interface ValidationState {
  isValid: boolean;
  message?: string;
  isValidating?: boolean;
}

interface UseFormValidationOptions {
  validateOnChange?: boolean;
  validateOnBlur?: boolean;
  debounceMs?: number;
}

export function useFormValidation(
  initialValues: Record<string, string>,
  validationRules: Record<string, ValidationRule>,
  options: UseFormValidationOptions = {}
) {
  const {
    validateOnChange = true,
    validateOnBlur = true,
    debounceMs = 300
  } = options;

  const [values, setValues] = useState(initialValues);
  const [validationStates, setValidationStates] = useState<Record<string, ValidationState>>({});
  const [hasInteracted, setHasInteracted] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Debounced validation timeouts
  const [validationTimeouts, setValidationTimeouts] = useState<Record<string, NodeJS.Timeout>>({});

  const validateField = useCallback(async (fieldName: string, value: string) => {
    const rule = validationRules[fieldName];
    if (!rule) return;

    // Clear existing timeout
    if (validationTimeouts[fieldName]) {
      clearTimeout(validationTimeouts[fieldName]);
    }

    // Set validating state
    setValidationStates(prev => ({
      ...prev,
      [fieldName]: { isValid: false, isValidating: true }
    }));

    const timeout = setTimeout(async () => {
      try {
        // Validate with Zod schema
        rule.schema.parse(value);
        
        // If async validator exists, run it
        if (rule.asyncValidator) {
          const isAsyncValid = await rule.asyncValidator(value);
          setValidationStates(prev => ({
            ...prev,
            [fieldName]: {
              isValid: isAsyncValid,
              message: isAsyncValid ? undefined : (rule.asyncMessage || "Validation failed"),
              isValidating: false
            }
          }));
        } else {
          setValidationStates(prev => ({
            ...prev,
            [fieldName]: { isValid: true, isValidating: false }
          }));
        }
      } catch (error) {
        const message = error instanceof z.ZodError 
          ? error.errors[0]?.message 
          : rule.message || "Invalid value";
        
        setValidationStates(prev => ({
          ...prev,
          [fieldName]: {
            isValid: false,
            message,
            isValidating: false
          }
        }));
      }
    }, rule.debounceMs || debounceMs);

    setValidationTimeouts(prev => ({
      ...prev,
      [fieldName]: timeout
    }));
  }, [validationRules, debounceMs, validationTimeouts]);

  const setValue = useCallback((fieldName: string, value: string) => {
    setValues(prev => ({ ...prev, [fieldName]: value }));
    
    if (validateOnChange && (hasInteracted[fieldName] || submitAttempted)) {
      validateField(fieldName, value);
    }
  }, [validateOnChange, hasInteracted, submitAttempted, validateField]);

  const handleBlur = useCallback((fieldName: string) => {
    setHasInteracted(prev => ({ ...prev, [fieldName]: true }));
    
    if (validateOnBlur) {
      validateField(fieldName, values[fieldName]);
    }
  }, [validateOnBlur, validateField, values]);

  const validateAllFields = useCallback(async () => {
    const validationPromises = Object.keys(validationRules).map(async (fieldName) => {
      await validateField(fieldName, values[fieldName]);
      return fieldName;
    });

    await Promise.all(validationPromises);

    // Wait a bit for all validations to complete
    return new Promise<boolean>((resolve) => {
      setTimeout(() => {
        const currentStates = Object.values(validationStates);
        const isValid = currentStates.length > 0 && currentStates.every(state => state.isValid && !state.isValidating);
        resolve(isValid);
      }, 100);
    });
  }, [validationRules, validateField, values, validationStates]);

  const handleSubmit = useCallback(async (onSubmit: () => Promise<void> | void) => {
    setSubmitAttempted(true);
    setIsSubmitting(true);

    // Mark all fields as interacted
    const allFieldsInteracted = Object.keys(validationRules).reduce((acc, field) => {
      acc[field] = true;
      return acc;
    }, {} as Record<string, boolean>);
    setHasInteracted(allFieldsInteracted);

    try {
      const isValid = await validateAllFields();
      
      if (isValid) {
        await onSubmit();
        setIsSubmitting(false);
        return true;
      } else {
        setIsSubmitting(false);
        return false;
      }
    } catch (error) {
      setIsSubmitting(false);
      throw error;
    }
  }, [validationRules, validateAllFields]);

  const reset = useCallback(() => {
    setValues(initialValues);
    setValidationStates({});
    setHasInteracted({});
    setIsSubmitting(false);
    setSubmitAttempted(false);
    
    // Clear all timeouts
    Object.values(validationTimeouts).forEach(timeout => clearTimeout(timeout));
    setValidationTimeouts({});
  }, [initialValues, validationTimeouts]);

  const isFormValid = Object.values(validationStates).length > 0 
    && Object.values(validationStates).every(state => state.isValid && !state.isValidating);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      Object.values(validationTimeouts).forEach(timeout => clearTimeout(timeout));
    };
  }, [validationTimeouts]);

  return {
    values,
    setValue,
    validationStates,
    hasInteracted,
    handleBlur,
    handleSubmit,
    reset,
    isSubmitting,
    isFormValid,
    submitAttempted
  };
}

// Common validation schemas
export const commonValidations = {
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  required: z.string().min(1, "This field is required"),
  phone: z.string().regex(/^[\+]?[1-9][\d]{0,15}$/, "Please enter a valid phone number"),
  url: z.string().url("Please enter a valid URL"),
  number: z.string().regex(/^\d+$/, "Please enter a valid number"),
};

// Async validators
export const asyncValidators = {
  emailExists: async (email: string): Promise<boolean> => {
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 500));
    return !email.includes("taken");
  },
  
  usernameAvailable: async (username: string): Promise<boolean> => {
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 300));
    return !["admin", "root", "test"].includes(username.toLowerCase());
  }
};