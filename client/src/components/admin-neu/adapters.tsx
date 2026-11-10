import {
  forwardRef, useCallback, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes,
  type Ref, type ComponentPropsWithoutRef, type ElementRef,
} from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";
import {
  NeuBadge, NeuButton, NeuCard, NeuInput, NeuPageShell, NeuStatCard, NeuTab, NeuTabList, NeuTabPanel, NeuTabs,
  NeuTable, NeuTableBody, NeuTableCell, NeuTableHead, NeuTableHeader, NeuTableRow,
} from "@/styles/neu/components";
import { useToast } from "@/hooks/use-toast";
import BaseTopNav from "@/components/layout/top-nav";
import { DialogContent as BaseDialogContent } from "@/components/ui/dialog";
import { AlertDialogContent as BaseAlertDialogContent } from "@/components/ui/alert-dialog";
import { SelectContent as BaseSelectContent, SelectTrigger as BaseSelectTrigger } from "@/components/ui/select";

export { NeuTextarea as Textarea } from "@/styles/neu/components";

type ButtonVariant = "default" | "accent" | "destructive" | "outline" | "secondary" | "ghost" | "link";
type ButtonSize = "default" | "sm" | "lg" | "icon";
interface AdminButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
  primary?: boolean;
}
const sizeClasses: Record<ButtonSize, string> = {
  default: "min-h-10 px-4 py-2",
  sm: "min-h-8 px-3 py-1.5 text-xs",
  lg: "min-h-11 px-8 py-2.5",
  icon: "min-h-9 h-9 w-9 px-0 py-0",
};

export const Button = forwardRef<HTMLButtonElement, AdminButtonProps>(
  ({ variant = "default", size = "default", asChild = false, primary = false, className, children, type = "submit", ...props }, ref) => {
    const resolved = primary ? "accent" : variant;
    const classes = cn("admin-neu-button rounded-xl font-semibold transition-[transform,box-shadow,background-color,color] duration-150", sizeClasses[size],
      resolved === "accent" && "admin-neu-accent",
      resolved === "destructive" && "admin-neu-danger",
      resolved === "secondary" && "admin-neu-secondary",
      resolved === "ghost" && "admin-neu-ghost",
      resolved === "link" && "admin-neu-link",
      className);
    if (asChild) return <Slot ref={ref as Ref<HTMLElement>} className={classes} {...props}>{children}</Slot>;
    return <NeuButton ref={ref} variant={resolved === "accent" ? "accent" : "default"} className={classes} {...props} type={type}>{children}</NeuButton>;
  },
);
Button.displayName = "AdminNeuButton";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <NeuInput ref={ref} className={cn("admin-neu-input", className)} {...props} />,
);
Input.displayName = "AdminNeuInput";

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <NeuCard ref={ref} className={cn("admin-neu-surface", className)} {...props} />,
);
Card.displayName = "AdminNeuCard";
export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />,
);
CardContent.displayName = "AdminNeuCardContent";
export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("ff-card-header flex flex-col space-y-1.5 p-6", className)} {...props} />,
);
CardHeader.displayName = "AdminNeuCardHeader";
export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => <h3 ref={ref} className={cn("text-base font-semibold leading-none tracking-tight", className)} {...props} />,
);
CardTitle.displayName = "AdminNeuCardTitle";
export const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />,
);
CardDescription.displayName = "AdminNeuCardDescription";

export const Badge = forwardRef<HTMLSpanElement, HTMLAttributes<HTMLSpanElement> & { variant?: string; tone?: "neutral" | "accent" | "success" | "warning" }>(
  ({ className, variant, tone, ...props }, ref) => {
    const legacy = (variant ?? "").toLowerCase();
    const mapped = tone ?? (/(funded|approved|completed|success|delivered|active)/.test(legacy) ? "success" :
      /(pending|hold|warning|amber|destructive|rejected)/.test(legacy) ? "warning" :
        /(submitted|accent|blue|default)/.test(legacy) ? "accent" : "neutral");
    return <NeuBadge ref={ref} tone={mapped} className={cn("admin-neu-badge", className)} {...props} />;
  },
);
Badge.displayName = "AdminNeuBadge";

export const StatCard = NeuStatCard;
export const Table = NeuTable;
export const TableBody = NeuTableBody;
export const TableCell = NeuTableCell;
export const TableHead = NeuTableHead;
export const TableHeader = NeuTableHeader;
export const TableRow = NeuTableRow;
export const Tabs = NeuTabs;
export const TabsList = NeuTabList;
export const TabsTrigger = NeuTab;
export function TabsContent(props: ComponentPropsWithoutRef<typeof NeuTabPanel>) {
  return <NeuTabPanel {...props} unmountInactive={props.unmountInactive ?? true} />;
}
export const DialogContent = forwardRef<ElementRef<typeof BaseDialogContent>, ComponentPropsWithoutRef<typeof BaseDialogContent>>(
  ({ className, ...props }, ref) => <BaseDialogContent ref={ref} className={cn("admin-neu-dialog", className)} {...props} />,
);
DialogContent.displayName = "AdminNeuDialogContent";
export const AlertDialogContent = forwardRef<ElementRef<typeof BaseAlertDialogContent>, ComponentPropsWithoutRef<typeof BaseAlertDialogContent>>(
  ({ className, ...props }, ref) => <BaseAlertDialogContent ref={ref} className={cn("admin-neu-dialog", className)} {...props} />,
);
AlertDialogContent.displayName = "AdminNeuAlertDialogContent";
export const SelectContent = forwardRef<ElementRef<typeof BaseSelectContent>, ComponentPropsWithoutRef<typeof BaseSelectContent>>(
  ({ className, ...props }, ref) => <BaseSelectContent ref={ref} className={cn("admin-neu-select", className)} {...props} />,
);
SelectContent.displayName = "AdminNeuSelectContent";
export const SelectTrigger = forwardRef<ElementRef<typeof BaseSelectTrigger>, ComponentPropsWithoutRef<typeof BaseSelectTrigger>>(
  ({ className, ...props }, ref) => <BaseSelectTrigger ref={ref} className={cn("min-h-11 rounded-xl border-0 bg-[#e0e0e0] text-[#333] shadow-[inset_5px_5px_10px_#b8b8b8,inset_-5px_-5px_10px_#fff] focus-visible:ring-2 focus-visible:ring-[#27aab8]", className)} {...props} />,
);
SelectTrigger.displayName = "AdminNeuSelectTrigger";
export function useAdminToast() {
  const state = useToast();
  const toast = useCallback((options: Parameters<typeof state.toast>[0]) => {
    state.toast({ ...options, className: cn("admin-neu-toast", options.className) });
  }, [state.toast]);
  return { ...state, toast };
}

export function AdminPageShell({ className, children, ...props }: ComponentPropsWithoutRef<typeof NeuPageShell>) {
  return <NeuPageShell className={cn("admin-neu-page-shell", className)} {...props}>{children}</NeuPageShell>;
}

export function TopNav(props: ComponentPropsWithoutRef<typeof BaseTopNav>) {
  return <BaseTopNav {...props} neu />;
}
