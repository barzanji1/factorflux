import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, X, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "./input";
import { Label } from "./label";

interface ValidationState {
  isValid: boolean;
  message?: string;
  isValidating?: boolean;
}

interface FormFieldWithValidationProps {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  validation?: ValidationState;
  required?: boolean;
  className?: string;
  disabled?: boolean;
}

export function FormFieldWithValidation({
  label,
  name,
  type = "text",
  placeholder,
  value,
  onChange,
  onBlur,
  validation,
  required = false,
  className,
  disabled = false,
}: FormFieldWithValidationProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);

  const showValidation = hasInteracted && validation;
  const isError = showValidation && !validation.isValid && !validation.isValidating;
  const isSuccess = showValidation && validation.isValid && !validation.isValidating;
  const isValidating = validation?.isValidating;

  const handleFocus = () => {
    setIsFocused(true);
  };

  const handleBlur = () => {
    setIsFocused(false);
    setHasInteracted(true);
    onBlur?.();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
    if (!hasInteracted) {
      setHasInteracted(true);
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      <Label
        htmlFor={name}
        className={cn(
          "text-sm font-medium transition-colors duration-200",
          isFocused && "text-blue-600 dark:text-blue-400",
          isError && "text-red-600 dark:text-red-400",
          isSuccess && "text-green-600 dark:text-green-400"
        )}
      >
        {label}
        {required && (
          <motion.span
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-red-500 ml-1"
          >
            *
          </motion.span>
        )}
      </Label>

      <div className="relative">
        <motion.div
          animate={{
            scale: isFocused ? 1.02 : 1,
            transition: { duration: 0.2, ease: "easeOut" }
          }}
        >
          <Input
            id={name}
            name={name}
            type={type}
            placeholder={placeholder}
            value={value}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            disabled={disabled}
            className={cn(
              "transition-all duration-200 ease-out",
              "focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500",
              isError && "border-red-500 focus:border-red-500 focus:ring-red-500/20",
              isSuccess && "border-green-500 focus:border-green-500 focus:ring-green-500/20",
              isValidating && "border-blue-400 focus:border-blue-400",
              disabled && "opacity-50 cursor-not-allowed"
            )}
          />
        </motion.div>

        {/* Validation Icons */}
        <AnimatePresence>
          {showValidation && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8, x: 10 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.8, x: 10 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="absolute right-3 top-1/2 transform -translate-y-1/2"
            >
              {isValidating && (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full"
                />
              )}
              {isSuccess && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.1, type: "spring", stiffness: 500 }}
                >
                  <Check className="w-4 h-4 text-green-500" />
                </motion.div>
              )}
              {isError && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.1, type: "spring", stiffness: 500 }}
                >
                  <X className="w-4 h-4 text-red-500" />
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Focus Ring Animation */}
        <AnimatePresence>
          {isFocused && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className={cn(
                "absolute inset-0 rounded-md pointer-events-none",
                "ring-2 ring-offset-2",
                isError ? "ring-red-500/30" : isSuccess ? "ring-green-500/30" : "ring-blue-500/30"
              )}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Validation Message */}
      <AnimatePresence>
        {showValidation && validation.message && (
          <motion.div
            initial={{ opacity: 0, y: -10, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -10, height: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="flex items-center space-x-2 text-sm"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.1 }}
            >
              {isError && <AlertCircle className="w-4 h-4 text-red-500" />}
              {isSuccess && <Check className="w-4 h-4 text-green-500" />}
            </motion.div>
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 }}
              className={cn(
                "transition-colors duration-200",
                isError && "text-red-600 dark:text-red-400",
                isSuccess && "text-green-600 dark:text-green-400"
              )}
            >
              {validation.message}
            </motion.span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}