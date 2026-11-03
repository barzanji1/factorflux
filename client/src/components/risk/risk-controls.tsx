import {
  forwardRef,
  useState,
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
  NeuStatCard,
  NeuTable,
  NeuTableBody,
  NeuTableCell,
  NeuTableHead,
  NeuTableHeader,
  NeuTableRow,
  NeuPageShell,
  NeuTabs,
  NeuTab,
  NeuTabList,
  NeuTabPanel,
} from "@/styles/neu/components";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { useToast } from "@/hooks/use-toast";
import { DialogContent as BaseDialogContent } from "@/components/ui/dialog";
import {
  SelectContent as BaseSelectContent,
  SelectTrigger as BaseSelectTrigger,
} from "@/components/ui/select";

type RiskButtonVariant = "default" | "accent" | "destructive" | "outline" | "secondary" | "ghost" | "link";
type RiskButtonSize = "default" | "sm" | "lg" | "icon";

interface RiskButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: RiskButtonVariant;
  size?: RiskButtonSize;
  asChild?: boolean;
}

const buttonSizes: Record<RiskButtonSize, string> = {
  default: "!min-h-10 !px-4 !py-2",
  sm: "!min-h-8 !px-3 !py-1.5 text-xs",
  lg: "!min-h-11 !px-8 !py-2.5",
  icon: "!min-h-9 !h-9 !w-9 !px-0 !py-0",
};

const buttonVariants: Record<RiskButtonVariant, string> = {
  default: "!bg-[#e0e0e0] !text-[#444] hover:!text-[#168d99]",
  accent: "!bg-[#27aab8] !text-white hover:!bg-[#2398a4]",
  destructive: "!bg-[#b94e4e] !text-white hover:!bg-[#a94343]",
  outline: "!border-0 !bg-[#e0e0e0] !text-[#444] hover:!text-[#168d99]",
  secondary: "!bg-[#d5d5d5] !text-[#444]",
  ghost: "!bg-transparent !text-[#444] !shadow-none hover:!bg-[#d5d5d5]",
  link: "!bg-transparent !text-[#168d99] !shadow-none underline-offset-4 hover:underline",
};

export const RiskButton = forwardRef<HTMLButtonElement, RiskButtonProps>(
  ({ variant = "default", size = "default", asChild = false, className, children, type = "submit", ...props }, ref) => {
    const classes = cn(
      "rounded-xl font-semibold transition-[transform,box-shadow,background-color,color] duration-150",
      variant === "accent" && "risk-neu-accent",
      variant === "destructive" && "risk-neu-danger",
      buttonSizes[size],
      buttonVariants[variant],
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
RiskButton.displayName = "RiskButton";

export const RiskInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <NeuInput ref={ref} className={className} {...props} />,
);
RiskInput.displayName = "RiskInput";

export const RiskCard = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <NeuCard ref={ref} className={cn("risk-neu-surface border-0", className)} {...props} />
  ),
);
RiskCard.displayName = "RiskCard";

export const RiskBadge = forwardRef<
  ElementRef<typeof NeuBadge>,
  ComponentPropsWithoutRef<typeof NeuBadge>
>(({ className, ...props }, ref) => (
  <NeuBadge ref={ref} className={cn("risk-neu-badge", className)} {...props} />
));
RiskBadge.displayName = "RiskBadge";

export const RiskStatCard = forwardRef<
  ElementRef<typeof NeuStatCard>,
  ComponentPropsWithoutRef<typeof NeuStatCard>
>(({ className, ...props }, ref) => (
  <NeuStatCard ref={ref} className={cn("risk-neu-surface border-0", className)} {...props} />
));
RiskStatCard.displayName = "RiskStatCard";

export {
  NeuTable as RiskTable,
  NeuTableBody as RiskTableBody,
  NeuTableCell as RiskTableCell,
  NeuTableHead as RiskTableHead,
  NeuTableHeader as RiskTableHeader,
  NeuTableRow as RiskTableRow,
};

export const RiskDialogContent = forwardRef<
  ElementRef<typeof BaseDialogContent>,
  ComponentPropsWithoutRef<typeof BaseDialogContent>
>(({ className, ...props }, ref) => (
  <BaseDialogContent ref={ref} className={cn("risk-neu-dialog", className)} {...props} />
));
RiskDialogContent.displayName = "RiskDialogContent";

export const RiskSelectTrigger = forwardRef<
  ElementRef<typeof BaseSelectTrigger>,
  ComponentPropsWithoutRef<typeof BaseSelectTrigger>
>(({ className, ...props }, ref) => (
  <BaseSelectTrigger ref={ref} className={cn("risk-neu-select", className)} {...props} />
));
RiskSelectTrigger.displayName = "RiskSelectTrigger";

export const RiskSelectContent = forwardRef<
  ElementRef<typeof BaseSelectContent>,
  ComponentPropsWithoutRef<typeof BaseSelectContent>
>(({ className, ...props }, ref) => (
  <BaseSelectContent ref={ref} className={cn("risk-neu-select", className)} {...props} />
));
RiskSelectContent.displayName = "RiskSelectContent";

export function useRiskToast() {
  const state = useToast();
  return {
    ...state,
    toast: (options: Parameters<typeof state.toast>[0]) => state.toast({
      ...options, className: cn("risk-neu-toast", options.className),
    }),
  };
}

export function RiskTabs({
  value,
  defaultValue = "",
  onValueChange,
  ...props
}: Omit<ComponentPropsWithoutRef<typeof NeuTabs>, "value" | "onValueChange"> & {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}) {
  const [localValue, setLocalValue] = useState(defaultValue);
  return <NeuTabs {...props} value={value ?? localValue} onValueChange={next => {
    if (value === undefined) setLocalValue(next);
    onValueChange?.(next);
  }} />;
}

export { NeuTab as RiskTab, NeuTabList as RiskTabList, NeuTabPanel as RiskTabPanel };

export function RiskPageFrame({
  title, subtitle, group, className, children,
}: { title: string; subtitle?: string; group?: string; className?: string; children: React.ReactNode }) {
  return <div className={cn("risk-neu-page flex h-screen overflow-hidden", className)}>
    <Sidebar />
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <TopNav title={title} subtitle={subtitle} group={group} neu />
      <NeuPageShell className="!min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto w-full max-w-[1680px] space-y-6">{children}</div>
      </NeuPageShell>
    </div>
  </div>;
}
