import { z } from "zod";

export type EmailTemplate = {
  id: string;
  name: string;
  subject: string;
  body: string;
  kind: "built_in" | "custom";
};

export const emailTemplateInputSchema = z.object({
  name: z.string().trim().min(1, "Template name is required").max(100),
  subject: z.string().trim().min(1, "Subject is required").max(200)
    .refine(value => !/[\r\n]/.test(value), "Subject must be a single line"),
  body: z.string().trim().min(1, "Message is required").max(20000),
}).strict();

const holidays = [
  ["new-year", "New Year's Day"],
  ["mlk", "Martin Luther King Jr. Day"],
  ["presidents", "Presidents' Day"],
  ["memorial", "Memorial Day"],
  ["juneteenth", "Juneteenth"],
  ["independence", "Independence Day"],
  ["labor", "Labor Day"],
  ["columbus-indigenous", "Columbus / Indigenous Peoples' Day"],
  ["veterans", "Veterans Day"],
  ["thanksgiving", "Thanksgiving"],
  ["christmas", "Christmas"],
] as const;

// Dates deliberately aren't inferred. Observed dates and special hours must be
// reviewed by the sender; selecting a template never schedules or sends mail.
export const BUILT_IN_EMAIL_TEMPLATES: readonly EmailTemplate[] = [
  {
    id: "document", name: "Document request", kind: "built_in",
    subject: "Documents needed",
    body: "Hello [Company],\n\nCould you please send the following documents when you have a chance?\n\n[Add document names]\n\nThank you,\nTrucking Pros Financial",
  },
  {
    id: "deadline", name: "Deadline reminder", kind: "built_in",
    subject: "Deadline reminder",
    body: "Hello [Company],\n\nThis is a reminder to send the outstanding [documents/items] by [agreed deadline]. If you need more time, please reply so we can help.\n\nThank you,\nTrucking Pros Financial",
  },
  ...holidays.map(([id, name]): EmailTemplate => ({
    id: `holiday-${id}`, name, kind: "built_in",
    subject: `Office closed — ${name}`,
    body: `Hello [Company],\n\nTrucking Pros Financial will be closed in observance of ${name}. Our office is closed on all federal holidays.\n\nPlease submit any time-sensitive funding requests and paperwork ahead of the holiday. Requests received during the closure will be reviewed when our office reopens on the next business day.\n\nPlease reply to this email if you have any questions.\n\nThank you,\nTrucking Pros Financial`,
  })),
  {
    id: "office-closed", name: "Office Closed", kind: "built_in",
    subject: "Office closure notice",
    body: "Hello [Company],\n\nPlease note the following Trucking Pros Financial office closure:\n\nClosed: [Closure date and hours]\nReopening: [Reopening date and time, including time zone]\n\nPlease submit time-sensitive funding requests and paperwork ahead of the closure. Requests received while we are closed will be reviewed when our office reopens.\n\nPlease reply if you have any questions.\n\nThank you,\nTrucking Pros Financial",
  },
  {
    id: "holiday-hours", name: "Holiday Hours", kind: "built_in",
    subject: "Upcoming holiday hours",
    body: "Hello [Company],\n\nTrucking Pros Financial is closed on all federal holidays. Our upcoming office hours are:\n\n[Holiday / observed closure date]\n[Special hours, including time zone]\n[Reopening date and time]\n\nPlease send time-sensitive funding requests and paperwork ahead of the closure. Requests received while we are closed will be reviewed when we reopen.\n\nThank you,\nTrucking Pros Financial",
  },
];

export function personalizeEmail(text: string, companyName?: string | null): string {
  // Names are text, not HTML or headers. A callback avoids interpreting $&/$'
  // in company names as replacement directives. The transport escapes HTML.
  const company = companyName?.replace(/[\r\n\t\u0000-\u001f\u007f]+/g, " ").trim() || "Valued Client";
  return text.replace(/\[Company\]/gi, () => company);
}
