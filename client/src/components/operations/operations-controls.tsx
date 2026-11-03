import {
  forwardRef,
  type ButtonHTMLAttributes,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type Ref,
} from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";
import {
  NeuBadge,
  NeuButton,
  NeuCard,
  NeuInput,
} from "@/styles/neu/components";
import { DialogContent as BaseDialogContent } from "@/components/ui/dialog";
import {
  SelectContent as BaseSelectContent,
  SelectTrigger as BaseSelectTrigger,
} from "@/components/ui/select";
import { DropdownMenuContent as BaseDropdownMenuContent } from "@/components/ui/dropdown-menu";

type OperationsButtonVariant = "default" | "accent" | "destructive" | "outline" | "secondary" | "ghost" | "link";
type OperationsButtonSize = "default" | "sm" | "lg" | "icon";

export interface OperationsButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: OperationsButtonVariant;
  size?: OperationsButtonSize;
  asChild?: boolean;
}

const sizeClasses: Record<OperationsButtonSize, string> = {
  default: "!min-h-10 !px-4 !py-2",
  sm: "!min-h-8 !px-3 !py-1.5 text-xs",
  lg: "!min-h-11 !px-8 !py-2.5",
  icon: "!min-h-9 !h-9 !w-9 !px-0 !py-0",
};

const variantClasses: Record<OperationsButtonVariant, string> = {
  default: "!bg-[#e0e0e0] !text-[#168d99] hover:!bg-[#27aab8] hover:!text-white",
  accent: "!bg-[#27aab8] !text-white hover:!bg-[#2398a4]",
  destructive: "!bg-[#b94e4e] !text-white hover:!bg-[#a94343]",
  outline: "!border-0 !bg-[#e0e0e0] !text-[#444] hover:!text-[#168d99]",
  secondary: "!bg-[#d5d5d5] !text-[#444]",
  ghost: "!bg-transparent !text-[#444] !shadow-none hover:!bg-[#d5d5d5]",
  link: "!bg-transparent !text-[#168d99] !shadow-none underline-offset-4 hover:underline",
};

export const OperationsButton = forwardRef<HTMLButtonElement, OperationsButtonProps>(
  ({ variant = "default", size = "default", asChild = false, className, children, type = "button", ...props }, ref) => {
    const classes = cn(
      "rounded-xl font-semibold transition-[transform,box-shadow,background-color,color] duration-150",
      variant === "accent" && "operations-neu-accent",
      variant === "destructive" && "operations-neu-danger",
      sizeClasses[size],
      variantClasses[variant],
      className,
    );
    if (asChild) {
      return <Slot ref={ref as Ref<HTMLElement>} className={classes} {...props}>{children}</Slot>;
    }
    return (
      <NeuButton
        ref={ref}
        variant={variant === "accent" ? "accent" : "default"}
        className={classes}
        {...props}
        type={type}
      >
        {children}
      </NeuButton>
    );
  },
);
OperationsButton.displayName = "OperationsButton";

export const OperationsInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <NeuInput ref={ref} className={className} {...props} />,
);
OperationsInput.displayName = "OperationsInput";

export const OperationsCard = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <NeuCard ref={ref} className={cn("operations-neu-surface border-0", className)} {...props} />
  ),
);
OperationsCard.displayName = "OperationsCard";

export const OperationsBadge = forwardRef<
  ElementRef<typeof NeuBadge>,
  ComponentPropsWithoutRef<typeof NeuBadge>
>(({ className, ...props }, ref) => (
  <NeuBadge ref={ref} className={cn("operations-neu-badge", className)} {...props} />
));
OperationsBadge.displayName = "OperationsBadge";

export const OperationsDialogContent = forwardRef<
  ElementRef<typeof BaseDialogContent>,
  ComponentPropsWithoutRef<typeof BaseDialogContent>
>(({ className, ...props }, ref) => (
  <BaseDialogContent ref={ref} className={cn("operations-neu-dialog", className)} {...props} />
));
OperationsDialogContent.displayName = "OperationsDialogContent";

export const OperationsSelectTrigger = forwardRef<
  ElementRef<typeof BaseSelectTrigger>,
  ComponentPropsWithoutRef<typeof BaseSelectTrigger>
>(({ className, ...props }, ref) => (
  <BaseSelectTrigger ref={ref} className={cn("operations-neu-select", className)} {...props} />
));
OperationsSelectTrigger.displayName = "OperationsSelectTrigger";

export const OperationsSelectContent = forwardRef<
  ElementRef<typeof BaseSelectContent>,
  ComponentPropsWithoutRef<typeof BaseSelectContent>
>(({ className, ...props }, ref) => (
  <BaseSelectContent ref={ref} className={cn("operations-neu-select", className)} {...props} />
));
OperationsSelectContent.displayName = "OperationsSelectContent";

export const OperationsDropdownMenuContent = forwardRef<
  ElementRef<typeof BaseDropdownMenuContent>,
  ComponentPropsWithoutRef<typeof BaseDropdownMenuContent>
>(({ className, ...props }, ref) => (
  <BaseDropdownMenuContent ref={ref} className={cn("operations-neu-menu", className)} {...props} />
));
OperationsDropdownMenuContent.displayName = "OperationsDropdownMenuContent";
