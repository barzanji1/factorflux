"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={cn(
          "ff-input flex min-h-[100px] w-full px-3 py-2 text-sm",
          "placeholder:text-muted-foreground",
          "transition-colors",
          "focus:outline-none",
          "ring-offset-background",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "resize-y",
          className
        )}
        {...props}
      />
    )
  }
)

Textarea.displayName = "Textarea"

export { Textarea }