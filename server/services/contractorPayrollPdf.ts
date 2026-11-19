import PDFDocument from "pdfkit";
import type { PayDay, PayStatement } from "../../shared/contractor-payroll";

export function renderPayStatement(statement: PayStatement, daily: PayDay[], timezone: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 48, info: { Title: `Pay Statement ${statement.statementNumber}`, Author: "Trucking Pros LLC" } });
    const chunks: Buffer[] = [];
    doc.on("data", chunk => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
    doc.fontSize(22).text("Trucking Pros LLC");
    doc.moveDown(.4).fontSize(17).text("Pay Statement");
    doc.fontSize(10).text(statement.statementNumber);
    doc.moveDown().fontSize(12).text(`Contractor: ${statement.contractorName}`);
    doc.fontSize(10).text(`Pay period: ${statement.startDate} through ${statement.endDate}`);
    doc.text(`Time zone: ${timezone}`);
    doc.text(`Pay date: ${statement.payDate}`);
    doc.moveDown().fontSize(12).text(`Hours worked: ${(statement.minutes / 60).toFixed(4)} (${Math.floor(statement.minutes / 60)}:${String(statement.minutes % 60).padStart(2, "0")} h:mm)`);
    doc.text(`Hourly rate: ${money(statement.rateCents)}`);
    doc.moveDown(.5).text(`Gross pay: ${money(statement.grossCents)}`);
    doc.font("Helvetica-Bold").text(`Net pay: ${money(statement.grossCents)}`).font("Helvetica");
    doc.moveDown(.5).fontSize(10).text("1099 contractor — no taxes withheld");
    doc.moveDown().text(`YTD gross through pay date (at issuance): ${money(statement.ytdGrossCents)}`);
    if (statement.replacesStatementId) doc.text(`Correction of statement record ${statement.replacesStatementId}; the prior statement is void.`);
    doc.moveDown().fontSize(12).text("Approved daily hours");
    doc.fontSize(10);
    for (const day of daily.filter(day => day.minutes > 0)) {
      if (doc.y > 710) doc.addPage();
      doc.text(`${day.date}    ${(day.minutes / 60).toFixed(4)} hours    ${Math.floor(day.minutes / 60)}:${String(day.minutes % 60).padStart(2, "0")}`);
    }
    doc.moveDown().fontSize(9).fillColor("#555555")
      .text("Daily worked time is summed before rounding to the nearest minute. This issued statement is retained unchanged; corrections receive a new statement number.");
    doc.end();
  });
}
