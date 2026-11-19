import { ArrowDownToLine, ArrowLeft, ArrowRight, FileText, RotateCcw } from "lucide-react";
import { Badge, Button, Card, CardContent, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/admin-neu/adapters";
import { PAYROLL_PAGE_SIZE, type PayStatement, type PayrollList } from "../../../../shared/contractor-payroll";
import { dateLabel, money } from "./payroll-utils";

function StatementStatus({ statement }: { statement: PayStatement }) {
  return <Badge tone={statement.status === "issued" ? "success" : "warning"}>{statement.status === "issued" ? "Issued" : "Void"}</Badge>;
}

export function PayrollStatements({ data, page, year, onPage, onYear, onReissue, isAdmin }: {
  data: PayrollList; page: number; year: number; isAdmin: boolean;
  onPage: (page: number) => void; onYear: (year: number) => void; onReissue: (statement: PayStatement) => void;
}) {
  const pages = Math.max(1, Math.ceil(data.total / PAYROLL_PAGE_SIZE));
  return <section className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-muted-foreground">Your records</p><h2 className="mt-1 text-xl font-semibold">Pay statements</h2></div>
      <label className="grid gap-1 text-xs font-medium text-muted-foreground">Tax year
        <select className="admin-neu-input min-h-10 rounded-xl px-3 text-sm text-foreground" value={year} onChange={(e) => { onYear(Number(e.target.value)); onPage(1); }}>
          {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - i).map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </label>
    </div>
    <Card><CardContent className="p-0">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow><TableHead>Pay statement</TableHead><TableHead>Pay period</TableHead><TableHead>Pay date</TableHead><TableHead className="text-right">Hours</TableHead><TableHead className="text-right">Gross pay</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Document</TableHead></TableRow></TableHeader>
          <TableBody>
            {data.statements.length === 0 ? <TableRow><TableCell colSpan={7} className="py-14 text-center">
              <div className="mx-auto flex max-w-sm flex-col items-center gap-2 text-muted-foreground"><FileText className="h-8 w-8 opacity-50" /><strong className="text-foreground">No statements for {year}</strong><span>Issued contractor statements will appear here.</span></div>
            </TableCell></TableRow> : data.statements.map((item) => <TableRow key={item.id}>
              <TableCell><div className="font-semibold">{item.statementNumber}</div><div className="text-xs text-muted-foreground">{item.contractorName}</div>
                {item.voidReason && <div className="mt-1 max-w-xs text-xs text-rose-700">Void reason: {item.voidReason}</div>}
                {item.replacesStatementId && <div className="mt-1 text-xs text-muted-foreground">Replaces statement #{item.replacesStatementId}</div>}
              </TableCell>
              <TableCell>{dateLabel(item.startDate)} – {dateLabel(item.endDate)}</TableCell>
              <TableCell>{dateLabel(item.payDate)}</TableCell>
              <TableCell className="text-right tabular-nums">{(item.minutes / 60).toFixed(2)}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{money(item.grossCents)}</TableCell>
              <TableCell><StatementStatus statement={item} /></TableCell>
              <TableCell><div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => window.open(`/api/contractor-payroll/statements/${item.id}/pdf`, "_blank", "noopener,noreferrer")}><ArrowDownToLine className="mr-1.5 h-4 w-4" />PDF</Button>
                {isAdmin && item.status === "issued" && <Button type="button" variant="outline" size="sm" onClick={() => onReissue(item)}><RotateCcw className="mr-1.5 h-4 w-4" />Reissue</Button>}
              </div></TableCell>
            </TableRow>)}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between border-t border-border/60 px-4 py-3 text-sm">
        <span className="text-muted-foreground">{data.total ? `Showing ${(page - 1) * PAYROLL_PAGE_SIZE + 1}–${Math.min(page * PAYROLL_PAGE_SIZE, data.total)} of ${data.total}` : "No records"}</span>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}><ArrowLeft className="mr-1 h-4 w-4" />Previous</Button>
          <Button type="button" variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next<ArrowRight className="ml-1 h-4 w-4" /></Button>
        </div>
      </div>
    </CardContent></Card>
  </section>;
}
