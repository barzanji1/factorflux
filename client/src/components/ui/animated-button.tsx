import React, { forwardRef, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, ButtonProps } from "./button";

interface AnimatedButtonProps extends ButtonProps {
  loading?: boolean;
  success?: boolean;
  loadingText?: string;
  successText?: string;
  successDuration?: number;
}

export const AnimatedButton = forwardRef<HTMLButtonElement, AnimatedButtonProps>(
  ({ 
    children, 
    loading = false, 
    success = false, 
    loadingText, 
    successText,
    successDuration = 2000,
    className,
    disabled,
    ...props 
  }, ref) => {
    const [showSuccess, setShowSuccess] = useState(false);
    const [isPressed, setIsPressed] = useState(false);

    // Handle success state timing
    useEffect(() => {
      if (success && !showSuccess) {
        setShowSuccess(true);
        const timer = setTimeout(() => {
          setShowSuccess(false);
        }, successDuration);
        return () => clearTimeout(timer);
      }
    }, [success, successDuration, showSuccess]);

    const isDisabled = disabled || loading || showSuccess;

    const buttonVariants = {
      idle: { scale: 1 },
      pressed: { scale: 0.98 },
      loading: { scale: 1 },
      success: { scale: 1.05 }
    };

    const getState = () => {
      if (showSuccess) return "success";
      if (loading) return "loading";
      if (isPressed) return "pressed";
      return "idle";
    };

    const handleMouseDown = () => setIsPressed(true);
    const handleMouseUp = () => setIsPressed(false);
    const handleMouseLeave = () => setIsPressed(false);

    return (
      <motion.div
        variants={buttonVariants}
        animate={getState()}
        transition={{ duration: 0.15, ease: "easeOut" }}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        <Button
          ref={ref}
          disabled={isDisabled}
          className={cn(
            "relative overflow-hidden transition-all duration-200",
            showSuccess && "bg-green-500 hover:bg-green-600 border-green-500",
            loading && "cursor-not-allowed",
            className
          )}
          {...props}
        >
          {/* Background pulse for loading */}
          <AnimatePresence>
            {loading && (
              <motion.div
                initial={{ scale: 0, opacity: 0.5 }}
                animate={{ scale: 1.5, opacity: 0 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ duration: 1, repeat: Infinity, ease: "easeOut" }}
                className="absolute inset-0 bg-current rounded-md"
              />
            )}
          </AnimatePresence>

          {/* Success ripple effect */}
          <AnimatePresence>
            {showSuccess && (
              <motion.div
                initial={{ scale: 0, opacity: 0.8 }}
                animate={{ scale: 2, opacity: 0 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className="absolute inset-0 bg-white rounded-md"
              />
            )}
          </AnimatePresence>

          {/* Content */}
          <div className="relative flex items-center justify-center space-x-2">
            <AnimatePresence mode="wait">
              {loading && (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ duration: 0.2 }}
                  className="flex items-center space-x-2"
                >
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {loadingText && <span>{loadingText}</span>}
                </motion.div>
              )}

              {showSuccess && (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, scale: 0.8, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.8, y: -10 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                  className="flex items-center space-x-2"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.1, type: "spring", stiffness: 500 }}
                  >
                    <Check className="w-4 h-4" />
                  </motion.div>
                  {successText && <span>{successText}</span>}
                </motion.div>
              )}

              {!loading && !showSuccess && (
                <motion.div
                  key="default"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                >
                  {children}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </Button>
      </motion.div>
    );
  }
);

AnimatedButton.displayName = "AnimatedButton";