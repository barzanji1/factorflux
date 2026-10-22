import { randomUUID } from "node:crypto";
import { asc } from "drizzle-orm";
import { db } from "../db";
import { clientEmailTemplates } from "../../shared/schema";
import { BUILT_IN_EMAIL_TEMPLATES, emailTemplateInputSchema, type EmailTemplate } from "../../shared/email-templates";

type Store = Pick<typeof db, "select" | "insert">;

export function createEmailTemplateService(store: Store = db) {
  return {
    async list(): Promise<EmailTemplate[]> {
      const rows = await store.select({
        id: clientEmailTemplates.id, name: clientEmailTemplates.name,
        subject: clientEmailTemplates.subject, body: clientEmailTemplates.body,
      }).from(clientEmailTemplates).orderBy(asc(clientEmailTemplates.name), asc(clientEmailTemplates.id));
      return [...BUILT_IN_EMAIL_TEMPLATES, ...rows.map(row => ({ ...row, kind: "custom" as const }))];
    },
    async create(input: unknown, actorId: string): Promise<EmailTemplate> {
      const values = emailTemplateInputSchema.parse(input);
      const [row] = await store.insert(clientEmailTemplates).values({
        ...values, id: `custom:${randomUUID()}`, createdBy: actorId,
      }).returning({
        id: clientEmailTemplates.id, name: clientEmailTemplates.name,
        subject: clientEmailTemplates.subject, body: clientEmailTemplates.body,
      });
      if (!row) throw new Error("Unable to save email template");
      return { ...row, kind: "custom" };
    },
  };
}

export const emailTemplateService = createEmailTemplateService();
