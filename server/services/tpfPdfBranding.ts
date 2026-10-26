import fs from "node:fs";
import path from "node:path";

export function tpfPdfHeader(doc: PDFKit.PDFDocument) {
  const logo = [
    "client/public/images/tpf-logo.png", "dist/public/images/tpf-logo.png",
    "server/assets/tpf-logo.png", "dist/tpf-logo.png",
  ].map(file => path.resolve(process.cwd(), file)).find(file => fs.existsSync(file));
  if (logo) doc.image(logo, 48, 38, { fit: [58, 58] });
  doc.fillColor("#111").font("Helvetica-Bold").fontSize(16)
    .text("Trucking Pros Financial", 122, 55, { width: 420 });
}
export function tpfPdfFooter(doc: PDFKit.PDFDocument, detail: string) {
  doc.font("Helvetica").fontSize(8).fillColor("#64748b")
    .text(`Trucking Pros Financial · ${detail}`, 48, 730, { width: 516, lineBreak: false });
}
