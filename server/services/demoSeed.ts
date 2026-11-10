/**
 * demoSeed.ts
 * ──────────────────────────────────────────────────────────────────────────
 * Seeds realistic freight-factoring demo data so the Document Review Panel
 * and full OCR pipeline can be exercised end-to-end without real uploads.
 *
 * Documents seeded:
 *  1. Rate Confirmation  — native PDF extraction (high confidence)
 *  2. Bill of Lading     — OCR fallback success (scanned image simulation)
 *  3. Lumper Receipt     — OCR success with extracted lumper amount
 *  4. Carrier Invoice    — native PDF with full field candidates
 *  5. Unreadable scan    — failed OCR, review_status = "unreadable"
 *
 * Safe to run multiple times — skips seeding if demo load already exists.
 */

import path from "path";
import fs   from "fs";
import { db } from "../db";
import {
  clients,
  debtors,
  loads,
  invoices,
  documents,
  docExtractionJobs,
  docExtractionResults,
  docFieldCandidates,
  docReviews,
} from "../../shared/schema";
import { eq } from "drizzle-orm";

// ─── Guard ────────────────────────────────────────────────────────────────────
const DEMO_LOAD_NUMBER = "DEMO-2024-001";

// ─── Stub file generator ──────────────────────────────────────────────────────
// Creates a minimal plain-text file in uploads/ so the document viewer has
// something to render.  Real PDFs/images would be placed here on upload.

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

function writeStub(filename: string, content: string): void {
  const fp = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(fp)) {
    fs.writeFileSync(fp, content, "utf8");
  }
}

// ─── Realistic document text bodies ──────────────────────────────────────────

const RATE_CON_TEXT = `
RATE CONFIRMATION
Rate Confirmation #: RC-78341
Date: 04/28/2024

Broker: Coyote Logistics LLC
Carrier: Swift Freight Transport, MC472891
USDOT: 1234567

Load Number: DEMO-2024-001
Reference #: COY-98234

Origin (Pickup): Chicago, IL
Pickup Date: 04/29/2024

Destination (Delivery): Dallas, TX
Delivery Date: 04/30/2024

Agreed Rate: $2,850.00
Fuel Surcharge: $142.50
Total Amount: $2,992.50

Carrier agrees to transport freight per the terms of this rate confirmation.
Driver: James Hoover
`.trim();

const BOL_TEXT = `
BILL OF LADING
BOL Number: BOL-224891
Date: 04/29/2024

Shipper: Chicago Cold Storage, Inc.
Origin: Chicago, IL
Consignee: Dallas Distribution Center
Destination: Dallas, TX

Carrier: Swift Freight Transport
MC Number: MC472891
Pro Number: PRO-77234

Commodity: Frozen Food Products
Packages: 24 pallets
Weight: 38,400 lbs
Freight Charges Prepaid

Special Instructions: Keep frozen at -10°F

Driver Signature: _______________
Received in Good Condition
`.trim();

const LUMPER_TEXT = `
LUMPER RECEIPT
Date: 04/30/2024

Lumper Service Provider: DFW Unloading Services
Warehouse: Dallas Distribution Center, Dallas, TX

Load #: DEMO-2024-001
BOL #: BOL-224891

Unloading Fee (Lumper): $325.00
Number of Workers: 2
Hours: 2.5

Received By: Carlos M.
Driver Signature: James Hoover

Payment Method: Check
Receipt #: LR-9021
`.trim();

const INVOICE_TEXT = `
CARRIER INVOICE
Invoice #: INV-2024-4412
Invoice Date: 05/01/2024
Due Date: 05/31/2024

From: Swift Freight Transport
MC Number: MC472891
USDOT: 1234567
Address: 400 N Truckers Way, Memphis, TN 38103

Bill To: Coyote Logistics LLC
Load Number: DEMO-2024-001
Reference #: COY-98234

Freight Charges:
  Line Haul:         $2,850.00
  Fuel Surcharge:    $142.50
  Accessorial:       $0.00

Subtotal:            $2,992.50
Tax:                 $0.00
Total Amount Due:    $2,992.50

Remit To: Swift Freight Transport
Bank: First Tennessee Bank
Routing: 084000026   Account: 112233445
`.trim();

// Intentionally sparse / corrupt — simulates unreadable scan
const UNREADABLE_TEXT = `
... ... ...
[page corrupted - scan quality insufficient]
... ...
`.trim();

// ─── Main seed function ───────────────────────────────────────────────────────

export async function seedDemoData(agentUserId = "prod-1"): Promise<{
  skipped: boolean;
  message: string;
  summary?: Record<string, number>;
}> {
  // ── Guard: skip if demo load already exists ─────────────────────────────────
  const existing = await db
    .select({ id: loads.id })
    .from(loads)
    .where(eq(loads.loadNumber, DEMO_LOAD_NUMBER))
    .limit(1);

  if (existing.length > 0) {
    return { skipped: true, message: "Demo data already seeded — skipping." };
  }

  ensureUploadsDir();

  // ── 1. Ensure a demo client exists ─────────────────────────────────────────
  const [client] = await db
    .insert(clients)
    .values({
      name:          "Swift Freight Transport (Demo)",
      email:         "demo@swiftfreight.example",
      phone:         "901-555-0101",
      address:       "400 N Truckers Way, Memphis, TN 38103",
      contactPerson: "James Hoover",
      mcNumber:      "MC472891",
      ratePercent:   "3.00",
      status:        "active",
    })
    .returning({ id: clients.id });

  // ── 2. Ensure a demo debtor (broker) exists ─────────────────────────────────
  const [debtor] = await db
    .insert(debtors)
    .values({
      name:         "Coyote Logistics LLC (Demo)",
      email:        "ar@coyotelogistics.example",
      phone:        "312-555-0222",
      address:      "960 N Point Pkwy, Alpharetta, GA 30005",
      mcNumber:     "MC384127",
      creditLimit:  "500000.00",
      status:       "active",
    })
    .returning({ id: debtors.id });

  // ── 3. Create demo load ─────────────────────────────────────────────────────
  // loads.id is integer (not serial) — pick a high value to avoid collisions
  const demoLoadId = 90001;
  await db.insert(loads).values({
    id:               demoLoadId,
    loadNumber:       DEMO_LOAD_NUMBER,
    clientId:         client.id,
    pickupLocation:   "Chicago, IL",
    deliveryLocation: "Dallas, TX",
    pickupDate:       new Date("2024-04-29"),
    deliveryDate:     new Date("2024-04-30"),
    rate:             "2992.50",
    status:           "invoiced",
    driverName:       "James Hoover",
  });

  // ── 4. Create demo invoice ──────────────────────────────────────────────────
  const [invoice] = await db
    .insert(invoices)
    .values({
      invoiceNumber:    "INV-DEMO-4412",
      loadId:           demoLoadId,
      clientId:         client.id,
      debtorId:         debtor.id,
      loadNumber:       DEMO_LOAD_NUMBER,
      amount:           "2992.50",
      currency:         "USD",
      invoiceDate:      new Date("2024-05-01"),
      dueDate:          new Date("2024-05-31"),
      pickupLocation:   "Chicago, IL",
      deliveryLocation: "Dallas, TX",
      loadType:         "otr_load",
      bolNumber:        "BOL-224891",
      status:           "under_review",
      factoringStage:   "verification",
      submittedBy:      agentUserId,
      submittedAt:      new Date("2024-05-01"),
      notes:            "Demo invoice — seeded for review workflow testing.",
    })
    .returning({ id: invoices.id });

  // ── 5. Seed documents ───────────────────────────────────────────────────────

  const docDefs: Array<{
    filename:              string;
    originalName:          string;
    mimeType:              string;
    docType:               string;
    candidateType:         string;
    status:                string;
    extractionMethod:      string;
    confidence:            number;
    stubContent:           string;
    fields:                Array<{ name: string; value: string; norm: string; conf: number; snippet: string }>;
    reviewStatus?:         string;
    reviewNotes?:          string;
    finalFields?:          Record<string, string>;
  }> = [
    // ── Doc 1: Rate Confirmation — native PDF, high confidence, confirmed ───
    {
      filename:         "demo_rate_con_RC78341.txt",
      originalName:     "Rate_Confirmation_RC-78341.pdf",
      mimeType:         "application/pdf",
      docType:          "rate_confirmation",
      candidateType:    "rate_confirmation",
      status:           "processed",
      extractionMethod: "native_pdf",
      confidence:       0.91,
      stubContent:      RATE_CON_TEXT,
      fields: [
        { name: "amount",           value: "$2,992.50",           norm: "2992.50",        conf: 0.78, snippet: "Total Amount: $2,992.50" },
        { name: "load_number",      value: "DEMO-2024-001",       norm: "DEMO-2024-001",  conf: 0.82, snippet: "Load Number: DEMO-2024-001" },
        { name: "reference_number", value: "COY-98234",           norm: "COY-98234",      conf: 0.72, snippet: "Reference #: COY-98234" },
        { name: "broker_name",      value: "Coyote Logistics LLC",norm: "Coyote Logistics LLC", conf: 0.65, snippet: "Broker: Coyote Logistics LLC" },
        { name: "carrier_name",     value: "Swift Freight Transport", norm: "Swift Freight Transport", conf: 0.60, snippet: "Carrier: Swift Freight Transport" },
        { name: "mc_number",        value: "MC472891",            norm: "472891",         conf: 0.92, snippet: "MC472891" },
        { name: "dot_number",       value: "1234567",             norm: "1234567",        conf: 0.92, snippet: "USDOT: 1234567" },
        { name: "pickup_location",  value: "Chicago, IL",         norm: "CHICAGO, IL",    conf: 0.72, snippet: "Origin (Pickup): Chicago, IL" },
        { name: "delivery_location",value: "Dallas, TX",          norm: "DALLAS, TX",     conf: 0.72, snippet: "Destination (Delivery): Dallas, TX" },
        { name: "pickup_date",      value: "04/29/2024",          norm: "2024-04-29",     conf: 0.78, snippet: "Pickup Date: 04/29/2024" },
        { name: "delivery_date",    value: "04/30/2024",          norm: "2024-04-30",     conf: 0.78, snippet: "Delivery Date: 04/30/2024" },
        { name: "document_type",    value: "rate confirmation",   norm: "rate_confirmation", conf: 0.92, snippet: "rate confirmation, load rate" },
      ],
      reviewStatus: "confirmed",
      reviewNotes:  "All fields verified. Rate matches load tender.",
      finalFields:  { amount: "$2,992.50", load_number: "DEMO-2024-001", mc_number: "MC472891" },
    },

    // ── Doc 2: BOL — OCR fallback success ───────────────────────────────────
    {
      filename:         "demo_bol_BOL224891.txt",
      originalName:     "BOL_224891_scanned.jpg",
      mimeType:         "image/jpeg",
      docType:          "bill_of_lading",
      candidateType:    "bill_of_lading",
      status:           "processed",
      extractionMethod: "image_ocr",
      confidence:       0.76,
      stubContent:      BOL_TEXT,
      fields: [
        { name: "bol_number",       value: "BOL-224891",  norm: "BOL-224891",   conf: 0.85, snippet: "BOL Number: BOL-224891" },
        { name: "load_number",      value: "DEMO-2024-001", norm: "DEMO-2024-001", conf: 0.82, snippet: "Load #: DEMO-2024-001" },
        { name: "pickup_location",  value: "Chicago, IL", norm: "CHICAGO, IL",  conf: 0.72, snippet: "Origin: Chicago, IL" },
        { name: "delivery_location",value: "Dallas, TX",  norm: "DALLAS, TX",   conf: 0.72, snippet: "Destination: Dallas, TX" },
        { name: "pickup_date",      value: "04/29/2024",  norm: "2024-04-29",   conf: 0.78, snippet: "Date: 04/29/2024" },
        { name: "pod_signature",    value: "Yes",         norm: "true",         conf: 0.70, snippet: "Driver Signature: Received in Good Condition" },
        { name: "document_type",    value: "bill of lading", norm: "bill_of_lading", conf: 0.88, snippet: "bill of lading, bol number" },
      ],
      reviewStatus: "confirmed",
      reviewNotes:  "BOL scanned copy verified — legible, all required fields present.",
      finalFields:  { bol_number: "BOL-224891", pickup_location: "Chicago, IL", delivery_location: "Dallas, TX" },
    },

    // ── Doc 3: Lumper Receipt — OCR success ──────────────────────────────────
    {
      filename:         "demo_lumper_LR9021.txt",
      originalName:     "Lumper_Receipt_LR-9021.jpg",
      mimeType:         "image/jpeg",
      docType:          "lumper_receipt",
      candidateType:    "lumper_receipt",
      status:           "processed",
      extractionMethod: "image_ocr",
      confidence:       0.73,
      stubContent:      LUMPER_TEXT,
      fields: [
        { name: "lumper_amount",    value: "$325.00",     norm: "325",          conf: 0.82, snippet: "Unloading Fee (Lumper): $325.00" },
        { name: "amount",           value: "$325.00",     norm: "325",          conf: 0.78, snippet: "$325.00" },
        { name: "load_number",      value: "DEMO-2024-001", norm: "DEMO-2024-001", conf: 0.82, snippet: "Load #: DEMO-2024-001" },
        { name: "bol_number",       value: "BOL-224891",  norm: "BOL-224891",   conf: 0.85, snippet: "BOL #: BOL-224891" },
        { name: "delivery_date",    value: "04/30/2024",  norm: "2024-04-30",   conf: 0.78, snippet: "Date: 04/30/2024" },
        { name: "document_type",    value: "lumper receipt", norm: "lumper_receipt", conf: 0.91, snippet: "lumper receipt, lumper fee" },
      ],
      reviewStatus: "confirmed",
      reviewNotes:  "Lumper fee of $325 verified against warehouse receipt.",
      finalFields:  { lumper_amount: "$325.00", load_number: "DEMO-2024-001" },
    },

    // ── Doc 4: Carrier Invoice — native PDF, all fields, pending review ──────
    {
      filename:         "demo_invoice_INV20244412.txt",
      originalName:     "Swift_Invoice_INV-2024-4412.pdf",
      mimeType:         "application/pdf",
      docType:          "invoice",
      candidateType:    "freight_invoice",
      status:           "processed",
      extractionMethod: "native_pdf",
      confidence:       0.90,
      stubContent:      INVOICE_TEXT,
      fields: [
        { name: "invoice_number",   value: "INV-2024-4412",       norm: "INV-2024-4412",  conf: 0.80, snippet: "Invoice #: INV-2024-4412" },
        { name: "amount",           value: "$2,992.50",           norm: "2992.50",         conf: 0.78, snippet: "Total Amount Due: $2,992.50" },
        { name: "load_number",      value: "DEMO-2024-001",       norm: "DEMO-2024-001",  conf: 0.82, snippet: "Load Number: DEMO-2024-001" },
        { name: "reference_number", value: "COY-98234",           norm: "COY-98234",       conf: 0.72, snippet: "Reference #: COY-98234" },
        { name: "carrier_name",     value: "Swift Freight Transport", norm: "Swift Freight Transport", conf: 0.60, snippet: "From: Swift Freight Transport" },
        { name: "mc_number",        value: "MC472891",            norm: "472891",          conf: 0.92, snippet: "MC Number: MC472891" },
        { name: "dot_number",       value: "1234567",             norm: "1234567",         conf: 0.92, snippet: "USDOT: 1234567" },
        { name: "date",             value: "05/01/2024",          norm: "2024-05-01",      conf: 0.55, snippet: "Invoice Date: 05/01/2024" },
        { name: "delivery_date",    value: "05/31/2024",          norm: "2024-05-31",      conf: 0.78, snippet: "Due Date: 05/31/2024" },
        { name: "document_type",    value: "freight invoice",     norm: "freight_invoice", conf: 0.94, snippet: "invoice number, amount due, remit to" },
      ],
      // Intentionally leave pending so the UI review flow can be tested
    },

    // ── Doc 5: Unreadable scan — failed OCR ──────────────────────────────────
    {
      filename:         "demo_unreadable_scan.txt",
      originalName:     "Corrupted_Scan_UNKNOWN.jpg",
      mimeType:         "image/jpeg",
      docType:          "other",
      candidateType:    "other",
      status:           "failed",
      extractionMethod: "ocr_error",
      confidence:       0,
      stubContent:      UNREADABLE_TEXT,
      fields: [
        { name: "document_type", value: "other", norm: "other", conf: 0.0, snippet: "scan quality insufficient" },
      ],
      reviewStatus: "unreadable",
      reviewNotes:  "Scan is corrupted — image quality too poor for OCR. Request re-submission from carrier.",
      finalFields:  {},
    },
  ];

  let docCount = 0;
  let fieldCount = 0;
  let reviewCount = 0;

  for (const def of docDefs) {
    writeStub(def.filename, def.stubContent);

    const stubSize = Buffer.byteLength(def.stubContent, "utf8");

    const [doc] = await db
      .insert(documents)
      .values({
        filename:              def.filename,
        originalName:          def.originalName,
        mimeType:              def.mimeType,
        size:                  stubSize,
        documentType:          def.docType as any,
        candidateDocumentType: def.candidateType as any,
        finalDocumentType:     def.reviewStatus === "confirmed" ? def.candidateType as any : undefined,
        classificationConfidence: String(def.confidence),
        loadId:                demoLoadId,
        invoiceId:             invoice.id,
        uploadedBy:            agentUserId,
        sourceChannel:         "manual",
        status:                def.status as any,
      })
      .returning({ id: documents.id });

    docCount++;

    // ── Extraction job ────────────────────────────────────────────────────────
    const [job] = await db
      .insert(docExtractionJobs)
      .values({
        documentId:   doc.id,
        jobType:      "pdf_text",
        status:       def.status === "failed" ? "failed" : "completed",
        parserName:   def.extractionMethod === "native_pdf" ? "hybrid_pdf_ocr" : "tesseract_ocr",
        attemptCount: def.status === "failed" ? 3 : 1,
        startedAt:    new Date("2024-05-01T10:00:00Z"),
        completedAt:  new Date("2024-05-01T10:00:05Z"),
        errorMessage: def.status === "failed" ? "Tesseract.recognize: image quality too low — confidence below threshold" : null,
      })
      .returning({ id: docExtractionJobs.id });

    // ── Extraction result (skip for failed) ───────────────────────────────────
    if (def.status !== "failed") {
      await db.insert(docExtractionResults).values({
        documentId:       doc.id,
        jobId:            job.id,
        fullText:         def.stubContent,
        mainText:         def.stubContent,
        pageTexts:        [{ page: 1, text: def.stubContent, method: def.extractionMethod, confidence: def.confidence }],
        rawPayloadJson: {
          method:      def.extractionMethod,
          charCount:   def.stubContent.length,
          pageCount:   1,
          providerKey: def.extractionMethod === "native_pdf" ? "hybrid_pdf_ocr" : "tesseract_ocr",
          classification: { docType: def.candidateType, confidence: def.confidence, signals: [def.candidateType] },
        },
        confidenceScore:  String(def.confidence),
        extractionMethod: def.extractionMethod,
        pageCount:        1,
      });
    }

    // ── Field candidates ──────────────────────────────────────────────────────
    if (def.fields.length > 0) {
      await db.insert(docFieldCandidates).values(
        def.fields.map(f => ({
          documentId:      doc.id,
          fieldName:       f.name,
          fieldValue:      f.value,
          normalizedValue: f.norm,
          confidenceScore: String(f.conf),
          pageNumber:      1,
          sourceSnippet:   f.snippet,
        })),
      );
      fieldCount += def.fields.length;
    }

    // ── Review record ─────────────────────────────────────────────────────────
    if (def.reviewStatus) {
      await db.insert(docReviews).values({
        documentId:       doc.id,
        reviewedByUserId: agentUserId,
        reviewStatus:     def.reviewStatus as any,
        reviewNotes:      def.reviewNotes ?? null,
        finalFieldsJson:  def.finalFields ?? null,
        reviewedAt:       new Date("2024-05-01T11:00:00Z"),
      });
      reviewCount++;
    }
  }

  return {
    skipped: false,
    message: "Demo data seeded successfully.",
    summary: {
      loads:     1,
      invoices:  1,
      documents: docCount,
      fields:    fieldCount,
      reviews:   reviewCount,
    },
  };
}
