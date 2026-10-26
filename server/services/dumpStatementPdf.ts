import PDFDocument from "pdfkit";
import type { DumpStatementInvoice } from "../../shared/dump-statements";
import { fundedAgeDays } from "./brokerConfirmationService";
import { tpfPdfHeader, tpfPdfFooter } from "./tpfPdfBranding";

export interface DumpStatementPdfData {
  id: string;
  brokerName: string;
  statementAt: Date;
  totalBalance: string;
  invoiceSnapshot: DumpStatementInvoice[];
}
const money = (value: string) => Number(value).toLocaleString("en-US", { style: "currency", currency: "USD" });
const date = (value: Date) => new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Denver", month: "2-digit", day: "2-digit", year: "numeric",
}).format(value);

export function renderDumpStatementPdf(statement: DumpStatementPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 48, bufferPages: true, info: {
      Title: "Dump-Load Aging Statement", Author: "Trucking Pros Financial",
      CreationDate: statement.statementAt, ModDate: statement.statementAt,
    } });
    const buffers: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => buffers.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);
    const columns = [
      { title: "Invoice #", x: 48, width: 75 }, { title: "Load #", x: 123, width: 55 },
      { title: "Carrier", x: 178, width: 125 }, { title: "Amount", x: 303, width: 65 },
      { title: "Funded", x: 368, width: 68 }, { title: "Days", x: 436, width: 40 },
      { title: "Open balance", x: 476, width: 88 },
    ];
    const header = () => {
      tpfPdfHeader(doc);
      doc.fillColor("#111").font("Helvetica-Bold").fontSize(20).text("Dump-Load Aging Statement", 48, 112);
      doc.font("Helvetica").fontSize(9).text(`As of ${date(statement.statementAt)} · ${statement.invoiceSnapshot.length} open dump-load invoices`, 48, 143);
      doc.text(`Broker: ${statement.brokerName}`, 48, 160, { width: 516, height: 32, ellipsis: true });
      doc.fontSize(8).fillColor("#555").text(`Statement ${statement.id}`, 48, 194);
      doc.moveTo(48, 214).lineTo(564, 214).strokeColor("#cbd5e1").stroke();
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#111");
      columns.forEach(column => doc.text(column.title, column.x, 225, { width: column.width - 4 }));
      return 248;
    };
    let y = header();
    for (const invoice of statement.invoiceSnapshot) {
      const values = [
        invoice.invoiceNumber.slice(0, 100), (invoice.loadNumber || "Not provided").slice(0, 80),
        invoice.carrier.slice(0, 180), money(invoice.amount), date(new Date(invoice.fundedAt)),
        String(fundedAgeDays(new Date(invoice.fundedAt), statement.statementAt)), money(invoice.balance),
      ];
      doc.font("Helvetica").fontSize(8);
      const height = Math.max(30, ...values.map((value, index) => doc.heightOfString(value, { width: columns[index].width - 5 }) + 10));
      if (y + height > 681) { doc.addPage(); y = header(); }
      doc.font("Helvetica").fontSize(8).fillColor("#111");
      values.forEach((value, index) => doc.text(value, columns[index].x, y, { width: columns[index].width - 5 }));
      y += height;
      doc.moveTo(48, y - 4).lineTo(564, y - 4).strokeColor("#e2e8f0").stroke();
    }
    if (y > 660) { doc.addPage(); y = header(); }
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#111")
      .text(`Total balance owed: ${money(statement.totalBalance)}`, 270, y + 12, { width: 294, align: "right" });
    doc.font("Helvetica").fontSize(8).fillColor("#555")
      .text("Open balances reflect applied payments and write-offs as of the statement date.", 48, y + 42, { width: 516 });
    const pages = doc.bufferedPageRange();
    for (let page = pages.start; page < pages.start + pages.count; page++) {
      doc.switchToPage(page);
      tpfPdfFooter(doc, `Broker aging statement · Page ${page + 1} of ${pages.count}`);
    }
    doc.end();
  });
}
