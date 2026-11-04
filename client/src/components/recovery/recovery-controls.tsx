import {
  forwardRef, useState, type ButtonHTMLAttributes, type ComponentPropsWithoutRef, type ReactNode,
  type ElementRef, type HTMLAttributes, type InputHTMLAttributes, type Ref,
} from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";
import {
  NeuBadge, NeuButton, NeuCard, NeuInput, NeuPageShell, NeuSelect, NeuStatCard,
  NeuTable, NeuTableBody, NeuTableCell, NeuTableHead, NeuTableHeader, NeuTableRow,
  NeuTab, NeuTabList, NeuTabPanel, NeuTabs,
} from "@/styles/neu/components";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { DialogContent as BaseDialogContent } from "@/components/ui/dialog";
import { SelectContent as BaseSelectContent, SelectTrigger as BaseSelectTrigger } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

type Variant = "default" | "accent" | "destructive" | "outline" | "secondary" | "ghost" | "link";
type Size = "default" | "sm" | "lg" | "icon";
interface RecoveryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: Variant; size?: Size; asChild?: boolean; primary?: boolean }
const sizes: Record<Size, string> = {
  default: "!min-h-10 !px-4 !py-2", sm: "!min-h-8 !px-3 !py-1.5 text-xs",
  lg: "!min-h-11 !px-8 !py-2.5", icon: "!min-h-9 !h-9 !w-9 !px-0 !py-0",
};
const variants: Record<Variant, string> = {
  default: "!bg-[#e0e0e0] !text-[#444] hover:!text-[#168d99]",
  accent: "!bg-[#e0e0e0] !text-[#168d99] hover:!bg-[#e0e0e0] hover:!text-[#087f8c]",
  destructive: "!bg-[#e0e0e0] !text-[#a3483e] hover:!text-[#a3483e]",
  outline: "!border-0 !bg-[#e0e0e0] !text-[#444] hover:!text-[#168d99]",
  secondary: "!bg-[#d5d5d5] !text-[#444]", ghost: "!bg-transparent !text-[#444] !shadow-none hover:!bg-[#d5d5d5]",
  link: "!bg-transparent !text-[#168d99] !shadow-none underline-offset-4 hover:underline",
};
export const RecoveryButton = forwardRef<HTMLButtonElement, RecoveryButtonProps>(
  ({ variant = "default", size = "default", asChild = false, primary = false, className, children, type = "submit", ...props }, ref) => {
    const resolvedVariant = primary ? "accent" : variant;
    const classes = cn("rounded-xl font-semibold transition-[transform,box-shadow,background-color,color] duration-150",
      resolvedVariant === "accent" && "recovery-neu-accent", resolvedVariant === "destructive" && "recovery-neu-danger",
      sizes[size], variants[resolvedVariant], className);
    if (asChild) return <Slot ref={ref as Ref<HTMLElement>} className={classes} {...props}>{children}</Slot>;
    return <NeuButton ref={ref} variant={resolvedVariant === "accent" ? "accent" : "default"} className={classes} {...props} type={type}>{children}</NeuButton>;
  },
);
RecoveryButton.displayName = "RecoveryButton";

export const RecoveryInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <NeuInput ref={ref} className={className} {...props} />,
);
RecoveryInput.displayName = "RecoveryInput";
export const RecoverySelect = NeuSelect;
export const RecoveryCard = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <NeuCard ref={ref} className={cn("recovery-neu-surface border-0", className)} {...props} />,
);
RecoveryCard.displayName = "RecoveryCard";
export const RecoveryCardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("p-4", className)} {...props} />,
);
RecoveryCardContent.displayName = "RecoveryCardContent";
export const RecoveryStatCard = forwardRef<ElementRef<typeof NeuStatCard>, ComponentPropsWithoutRef<typeof NeuStatCard>>(
  ({ className, ...props }, ref) => <NeuStatCard ref={ref} className={cn("recovery-neu-surface border-0", className)} {...props} />,
);
RecoveryStatCard.displayName = "RecoveryStatCard";
export const RecoveryBadge = forwardRef<ElementRef<typeof NeuBadge>, ComponentPropsWithoutRef<typeof NeuBadge> & { variant?: string }>(
  ({ className, tone, variant, ...props }, ref) => {
    const legacy = (variant ?? "").toLowerCase();
    const mappedTone = tone ?? (/(funded|approved|completed|success|delivered)/.test(legacy) ? "success" :
      /(pending|hold|warning|amber)/.test(legacy) ? "warning" : /(submitted|accent|blue)/.test(legacy) ? "accent" : "neutral");
    return <NeuBadge ref={ref} tone={mappedTone} className={cn("recovery-neu-badge", className)} {...props} />;
  },
);
RecoveryBadge.displayName = "RecoveryBadge";
export {
  NeuTable as RecoveryTable, NeuTableBody as RecoveryTableBody, NeuTableCell as RecoveryTableCell,
  NeuTableHead as RecoveryTableHead, NeuTableHeader as RecoveryTableHeader, NeuTableRow as RecoveryTableRow,
  NeuTab as RecoveryTab, NeuTabList as RecoveryTabList, NeuTabPanel as RecoveryTabPanel,
};
export function RecoveryTabsContent(props: ComponentPropsWithoutRef<typeof NeuTabPanel>) {
  return <NeuTabPanel {...props} unmountInactive={props.unmountInactive ?? true} />;
}
export function RecoveryTabs({ value, defaultValue = "", onValueChange, ...props }: Omit<ComponentPropsWithoutRef<typeof NeuTabs>, "value" | "onValueChange"> & { value?: string; defaultValue?: string; onValueChange?: (value: string) => void }) {
  const [localValue, setLocalValue] = useState(defaultValue);
  return <NeuTabs {...props} value={value ?? localValue} onValueChange={next => { if (value === undefined) setLocalValue(next); onValueChange?.(next); }} />;
}
export const RecoveryPageFrame = ({ title, subtitle, group, className, children }: { title: string; subtitle?: string; group?: string; className?: string; children: ReactNode }) => (
  <div className={cn("recovery-neu-page flex h-[100dvh] min-h-[100dvh] overflow-hidden", className)}>
    <Sidebar />
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <TopNav title={title} subtitle={subtitle} group={group} neu />
      <NeuPageShell className="!min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto w-full max-w-[1680px] space-y-6">{children}</div>
      </NeuPageShell>
    </div>
  </div>
);
export const RecoveryDialogContent = forwardRef<ElementRef<typeof BaseDialogContent>, ComponentPropsWithoutRef<typeof BaseDialogContent>>(
  ({ className, ...props }, ref) => <BaseDialogContent ref={ref} className={cn("recovery-neu-dialog", className)} {...props} />,
);
RecoveryDialogContent.displayName = "RecoveryDialogContent";
export const RecoverySelectTrigger = forwardRef<ElementRef<typeof BaseSelectTrigger>, ComponentPropsWithoutRef<typeof BaseSelectTrigger>>(
  ({ className, ...props }, ref) => <BaseSelectTrigger ref={ref} className={cn("recovery-neu-select", className)} {...props} />,
);
RecoverySelectTrigger.displayName = "RecoverySelectTrigger";
export const RecoverySelectContent = forwardRef<ElementRef<typeof BaseSelectContent>, ComponentPropsWithoutRef<typeof BaseSelectContent>>(
  ({ className, ...props }, ref) => <BaseSelectContent ref={ref} className={cn("recovery-neu-select", className)} {...props} />,
);
RecoverySelectContent.displayName = "RecoverySelectContent";
export function useRecoveryToast() {
  const state = useToast();
  return { ...state, toast: (options: Parameters<typeof state.toast>[0]) => state.toast({ ...options, className: cn("recovery-neu-toast", options.className) }) };
}
