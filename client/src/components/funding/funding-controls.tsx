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
import { NeuButton, NeuCard, NeuInput } from "@/styles/neu/components";
import { DialogContent as BaseDialogContent } from "@/components/ui/dialog";
import { SelectContent as BaseSelectContent, SelectTrigger as BaseSelectTrigger } from "@/components/ui/select";
import { DropdownMenuContent as BaseDropdownMenuContent } from "@/components/ui/dropdown-menu";

type FundingButtonVariant = "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
type FundingButtonSize = "default" | "sm" | "lg" | "icon";

export interface FundingButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: FundingButtonVariant;
  size?: FundingButtonSize;
  asChild?: boolean;
}

const sizeClasses: Record<FundingButtonSize, string> = {
  default: "!min-h-10 !px-4 !py-2",
  sm: "!min-h-8 !px-3 !py-1.5 text-xs",
  lg: "!min-h-11 !px-8 !py-2.5",
  icon: "!min-h-9 !h-9 !w-9 !px-0 !py-0",
};

const variantClasses: Record<FundingButtonVariant, string> = {
  default: "!bg-[#e0e0e0] !text-[#168d99] hover:!bg-[#27aab8] hover:!text-white",
  destructive: "!bg-[#b94e4e] !text-white hover:!bg-[#a94343]",
  outline: "!border-0 !bg-[#e0e0e0] !text-[#444] hover:!text-[#168d99]",
  secondary: "!bg-[#d5d5d5] !text-[#444]",
  ghost: "!bg-transparent !text-[#444] !shadow-none hover:!bg-[#d5d5d5]",
  link: "!bg-transparent !text-[#168d99] !shadow-none underline-offset-4 hover:underline",
};

export const FundingButton = forwardRef<HTMLButtonElement, FundingButtonProps>(
  ({ variant = "default", size = "default", asChild = false, className, children, ...props }, ref) => {
    const classes = cn(
      "rounded-xl font-semibold transition-[transform,box-shadow,background-color,color] duration-150",
      variant === "default" && props.type === "submit" && "funding-neu-accent",
      variant === "destructive" && "funding-neu-danger",
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
        variant={variant === "default" && props.type === "submit" ? "accent" : "default"}
        className={classes}
        {...props}
        type={props.type ?? "submit"}
      >
        {children}
      </NeuButton>
    );
  },
);
FundingButton.displayName = "FundingButton";

export const FundingInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <NeuInput ref={ref} className={className} {...props} />,
);
FundingInput.displayName = "FundingInput";

export const FundingCard = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <NeuCard ref={ref} className={cn("funding-neu-surface border-0", className)} {...props} />
  ),
);
FundingCard.displayName = "FundingCard";

export const FundingDialogContent = forwardRef<
  ElementRef<typeof BaseDialogContent>,
  ComponentPropsWithoutRef<typeof BaseDialogContent>
>(({ className, ...props }, ref) => (
  <BaseDialogContent ref={ref} className={cn("funding-neu-dialog", className)} {...props} />
));
FundingDialogContent.displayName = "FundingDialogContent";

export const FundingSelectTrigger = forwardRef<
  ElementRef<typeof BaseSelectTrigger>,
  ComponentPropsWithoutRef<typeof BaseSelectTrigger>
>(({ className, ...props }, ref) => (
  <BaseSelectTrigger ref={ref} className={cn("funding-neu-select", className)} {...props} />
));
FundingSelectTrigger.displayName = "FundingSelectTrigger";

export const FundingSelectContent = forwardRef<
  ElementRef<typeof BaseSelectContent>,
  ComponentPropsWithoutRef<typeof BaseSelectContent>
>(({ className, ...props }, ref) => (
  <BaseSelectContent ref={ref} className={cn("funding-neu-select", className)} {...props} />
));
FundingSelectContent.displayName = "FundingSelectContent";

export const FundingDropdownMenuContent = forwardRef<
  ElementRef<typeof BaseDropdownMenuContent>,
  ComponentPropsWithoutRef<typeof BaseDropdownMenuContent>
>(({ className, ...props }, ref) => (
  <BaseDropdownMenuContent ref={ref} className={cn("funding-neu-menu", className)} {...props} />
));
FundingDropdownMenuContent.displayName = "FundingDropdownMenuContent";
