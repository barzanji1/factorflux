/**
 * Default broker follow-up email templates.
 * Seeds 4 templates (one per trigger type) on first startup — no-op if they exist.
 */

import { db } from "../db";
import { brokerFollowUpTemplates } from "../../shared/schema";
import { eq } from "drizzle-orm";

const DEFAULTS = [
  {
    name: "Initial Funding Notice",
    triggerType: "immediate" as const,
    subject: "Payment Follow-Up — Invoice {{invoiceNumber}} [{{brokerName}}]",
    body: [
      "Dear {{brokerName}},",
      "",
      "This is a payment follow-up from Trucking Pros Financial regarding Invoice {{invoiceNumber}}.",
      "",
      "  Load #:         {{loadNumber}}",
      "  Amount Due:     {{amountDue}}",
      "  Due Date:       {{dueDate}}",
      "",
      "The carrier advance has been processed and payment is now due per the terms of your agreement.",
      "",
      "Payment Instructions:",
      "{{paymentInstructions}}",
      "",
      "Please remit at your earliest convenience or reply to this email with any questions.",
      "",
      "Thank you,",
      "{{contactName}}",
      "Trucking Pros Financial — Collections",
    ].join("\n"),
    isDefault: true,
  },
  {
    name: "Payment Due Reminder",
    triggerType: "due_date" as const,
    subject: "Payment Due Today — Invoice {{invoiceNumber}} [{{brokerName}}]",
    body: [
      "Dear {{brokerName}},",
      "",
      "This is a reminder that Invoice {{invoiceNumber}} for {{amountDue}} is due today.",
      "",
      "  Load #:     {{loadNumber}}",
      "  Due Date:   {{dueDate}}",
      "",
      "Please remit payment immediately to avoid late fees and interruption of service.",
      "",
      "Payment Instructions:",
      "{{paymentInstructions}}",
      "",
      "If you have already sent payment, please disregard this notice and reply",
      "with payment confirmation so we can update our records.",
      "",
      "Thank you,",
      "{{contactName}}",
      "Trucking Pros Financial — Collections",
    ].join("\n"),
    isDefault: true,
  },
  {
    name: "Overdue Reminder",
    triggerType: "overdue" as const,
    subject: "Past Due Notice — Invoice {{invoiceNumber}} [{{brokerName}}]",
    body: [
      "Dear {{brokerName}},",
      "",
      "Invoice {{invoiceNumber}} for {{amountDue}} is now PAST DUE.",
      "",
      "  Load #:     {{loadNumber}}",
      "  Was Due:    {{dueDate}}",
      "",
      "Immediate payment is required to avoid further collection action.",
      "",
      "Payment Instructions:",
      "{{paymentInstructions}}",
      "",
      "If there is a dispute or discrepancy, please contact us immediately at",
      "collections@truckingprosfinancial.com so we can resolve this promptly.",
      "",
      "Thank you,",
      "{{contactName}}",
      "Trucking Pros Financial — Collections",
    ].join("\n"),
    isDefault: true,
  },
  {
    name: "Escalation Notice",
    triggerType: "escalation" as const,
    subject: "Escalation Notice — Invoice {{invoiceNumber}} Remains Unpaid [{{brokerName}}]",
    body: [
      "Dear {{brokerName}},",
      "",
      "Despite multiple reminders, Invoice {{invoiceNumber}} for {{amountDue}} remains",
      "unpaid. This matter is now being escalated.",
      "",
      "  Load #:     {{loadNumber}}",
      "  Was Due:    {{dueDate}}",
      "",
      "IMPORTANT: Failure to remit payment within 5 business days may result in",
      "referral to our collections agency and may affect your credit rating with",
      "Trucking Pros Financial.",
      "",
      "Payment Instructions:",
      "{{paymentInstructions}}",
      "",
      "Please contact {{contactName}} immediately at collections@truckingprosfinancial.com",
      "to discuss payment arrangements.",
      "",
      "Trucking Pros Financial — Collections",
    ].join("\n"),
    isDefault: true,
  },
];

export async function seedDefaultTemplates(): Promise<void> {
  for (const tpl of DEFAULTS) {
    const [existing] = await db
      .select({ id: brokerFollowUpTemplates.id })
      .from(brokerFollowUpTemplates)
      .where(eq(brokerFollowUpTemplates.triggerType, tpl.triggerType))
      .limit(1);

    if (!existing) {
      await db.insert(brokerFollowUpTemplates).values(tpl);
      console.log(`[templateSeed] seeded "${tpl.name}"`);
    }
  }
}
