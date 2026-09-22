import * as React from "react";
import Sidebar from "@/components/layout/sidebar";
import TopNav from "@/components/layout/top-nav";
import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

export function PageShell({
  title,
  subtitle,
  group,
  children,
  className,
  contentClassName,
}: {
  title: string;
  subtitle?: string;
  group?: string;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <div className={cn("ff-app-shell flex h-screen overflow-hidden bg-win95-canvas", className)}>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopNav title={title} subtitle={subtitle} group={group} />
        <main className="custom-scrollbar flex-1 overflow-auto">
          <div className={cn("mx-auto w-full max-w-[1680px] space-y-6 p-6 xl:p-8", contentClassName)}>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

export const Win95Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("rounded-card border border-slate-200 bg-white shadow-[0_3px_10px_rgba(47,47,47,0.14)]", className)}
      {...props}
    />
  ),
);
Win95Card.displayName = "Win95Card";

export const Win95CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("p-4", className)} {...props} />,
);
Win95CardContent.displayName = "Win95CardContent";

export function Win95StatCard({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <Win95Card className={className}>
      <Win95CardContent>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-bold text-win95-teal">{value}</p>
      </Win95CardContent>
    </Win95Card>
  );
}

export const Win95Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-sm border-2 border-b-white border-r-white border-l-[#808080] border-t-[#808080] bg-white px-3 text-sm text-slate-900 shadow-bevel-dark outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-win95-teal/30",
        className,
      )}
      {...props}
    />
  ),
);
Win95Input.displayName = "Win95Input";

export const Win95Select = Select;
export const Win95SelectValue = SelectValue;
export const Win95SelectContent = SelectContent;
export const Win95SelectItem = SelectItem;
export const Win95SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectTrigger>,
  React.ComponentPropsWithoutRef<typeof SelectTrigger>
>(({ className, ...props }, ref) => (
  <SelectTrigger
    ref={ref}
    className={cn(
      "h-10 rounded-sm border-2 border-b-white border-r-white border-l-[#808080] border-t-[#808080] bg-white shadow-bevel-dark",
      className,
    )}
    {...props}
  />
));
Win95SelectTrigger.displayName = "Win95SelectTrigger";

export const Win95Button = React.forwardRef<HTMLButtonElement, ButtonProps & { primary?: boolean }>(
  ({ className, primary, ...props }, ref) => (
    <Button
      ref={ref}
      className={cn(
        "rounded-sm border-2 border-b-[#808080] border-r-[#808080] border-l-white border-t-white bg-win95-canvas shadow-bevel-light active:translate-x-px active:translate-y-px active:border-b-white active:border-r-white active:border-l-[#808080] active:border-t-[#808080] active:shadow-bevel-dark",
        primary && "bg-win95-teal text-white hover:bg-[#178e9b]",
        className,
      )}
      {...props}
    />
  ),
);
Win95Button.displayName = "Win95Button";

export const Win95Tabs = Tabs;
export const Win95TabsContent = TabsContent;
export const Win95TabsList = React.forwardRef<
  React.ElementRef<typeof TabsList>,
  React.ComponentPropsWithoutRef<typeof TabsList>
>(({ className, ...props }, ref) => (
  <TabsList
    ref={ref}
    className={cn(
      "h-auto w-fit flex-wrap justify-start rounded-none border-2 border-b-[#808080] border-r-[#808080] border-l-white border-t-white bg-win95-canvas p-1 shadow-bevel-light",
      className,
    )}
    {...props}
  />
));
Win95TabsList.displayName = "Win95TabsList";
export const Win95TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsTrigger>,
  React.ComponentPropsWithoutRef<typeof TabsTrigger>
>(({ className, ...props }, ref) => (
  <TabsTrigger
    ref={ref}
    className={cn(
      "flex items-center gap-2 rounded-none border-2 border-b-[#808080] border-r-[#808080] border-l-white border-t-white bg-win95-canvas px-4 py-1.5 text-sm font-medium text-[#2f2f2f] shadow-bevel-light focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=active]:border-b-white data-[state=active]:border-r-white data-[state=active]:border-l-[#808080] data-[state=active]:border-t-[#808080] data-[state=active]:bg-white data-[state=active]:text-win95-teal data-[state=active]:shadow-bevel-dark",
      className,
    )}
    {...props}
  />
));
Win95TabsTrigger.displayName = "Win95TabsTrigger";

export const Win95Table = React.forwardRef<HTMLTableElement, React.TableHTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="overflow-x-auto rounded-t-card">
      <table ref={ref} className={cn("w-full border-collapse text-sm", className)} {...props} />
    </div>
  ),
);
Win95Table.displayName = "Win95Table";
export const Win95TableHeader = ({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <thead className={cn("bg-win95-header text-white", className)} {...props} />
);
export const Win95TableBody = ({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <tbody className={cn("[&_tr:nth-child(even)]:bg-[#f3f3f3]", className)} {...props} />
);
export const Win95TableRow = ({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => (
  <tr className={cn("border-b border-slate-200", className)} {...props} />
);
export const Win95TableHead = ({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th className={cn("px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider", className)} {...props} />
);
export const Win95TableCell = ({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn("px-4 py-3 align-middle", className)} {...props} />
);

export function Win95Badge({ className, ...props }: BadgeProps) {
  return <Badge className={cn("ff-badge", className)} {...props} />;
}

export function Win95FilterChip({
  selected,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-sm border-2 border-b-[#808080] border-r-[#808080] border-l-white border-t-white bg-win95-canvas px-3 py-1.5 text-xs font-semibold",
        selected && "bg-win95-teal text-white",
        className,
      )}
      {...props}
    />
  );
}