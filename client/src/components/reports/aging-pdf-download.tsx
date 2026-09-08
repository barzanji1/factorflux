import { Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const AGING_THRESHOLDS = [
  { value: "1", label: "1+ days" },
  { value: "45", label: "45+ days" },
  { value: "60", label: "60+ days" },
  { value: "90", label: "90+ days" },
  { value: "100", label: "100+ days" },
] as const;

export function AgingPdfDownload({
  carrierId,
  minDays,
  onMinDaysChange,
  compact = false,
}: {
  carrierId?: string | number | null;
  minDays: string;
  onMinDaysChange: (value: string) => void;
  compact?: boolean;
}) {
  const download = () => {
    if (!carrierId) return;
    const link = document.createElement("a");
    link.href = `/api/reports/aging-pdf?carrierId=${encodeURIComponent(String(carrierId))}&minDays=${encodeURIComponent(minDays)}`;
    link.download = `carrier-aging-${carrierId}-${minDays}-days.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <div className={compact ? "flex flex-wrap items-center gap-2" : "space-y-3"}>
      <Select value={minDays} onValueChange={onMinDaysChange}>
        <SelectTrigger className={compact ? "h-9 w-36 text-xs" : "w-full"}>
          <SelectValue placeholder="Aging threshold" />
        </SelectTrigger>
        <SelectContent>
          {AGING_THRESHOLDS.map(option => (
            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="button" size={compact ? "sm" : "default"} disabled={!carrierId} onClick={download}
        className="gap-2 bg-[#098b9f] text-white hover:bg-[#08798b]">
        {compact ? <Download className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
        Download Aging Report PDF
      </Button>
    </div>
  );
}