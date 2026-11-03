import type { Express, RequestHandler } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { brokers, brokerDumpStatements, eventLedger, users } from "../../shared/schema";
import { getSignedDownloadUrl } from "../services/s3Service";

type Store = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
export function registerDumpStatementRoutes(app: Express, requireAuth: RequestHandler,
  store: Store = db, sign: typeof getSignedDownloadUrl = getSignedDownloadUrl) {
  app.get("/api/brokers/:id/statement-history", requireAuth, async (req, res) => {
    const brokerId = Number(req.params.id);
    if (!Number.isSafeInteger(brokerId) || brokerId < 1) return res.status(400).json({ message: "Invalid broker ID." });
    try {
      const [broker] = await store.select({ id: brokers.id }).from(brokers).where(eq(brokers.id, brokerId));
      if (!broker) return res.status(404).json({ message: "Broker not found." });
      const rows = await store.select({
        id: eventLedger.id, eventType: eventLedger.eventType, createdAt: eventLedger.createdAt,
        label: sql<string>`case when ${eventLedger.eventType} like 'entity_note_%'
          then 'Note ' || replace(${eventLedger.eventType},'entity_note_','') || ' by ' || coalesce(nullif(concat_ws(' ',${users.firstName},${users.lastName}),''),'Former staff member')
          else coalesce(${eventLedger.payloadJson}->>'label',${eventLedger.eventType}) end`,
        noteId: sql<number | null>`(${eventLedger.payloadJson}->>'noteId')::integer`,
        noteAction: sql<string | null>`${eventLedger.payloadJson}->>'noteAction'`,
        statementId: brokerDumpStatements.id, totalBalance: brokerDumpStatements.totalBalance,
        invoiceCount: sql<number | null>`(${eventLedger.payloadJson}->>'invoiceCount')::integer`,
        status: sql<string>`case when ${eventLedger.eventType} like 'entity_note_%' then 'note'
          when ${eventLedger.eventType} = 'broker_dump_statement_sent' then 'sent'
          when ${eventLedger.eventType} = 'broker_dump_statement_skipped' then 'skipped'
          when ${brokerDumpStatements.status} = 'uncertain' then 'uncertain' else 'failed' end`,
        messageId: brokerDumpStatements.messageId,
        error: sql<string | null>`${eventLedger.payloadJson}->>'error'`,
        stored: brokerDumpStatements.pdfStoredAt,
      }).from(eventLedger).leftJoin(brokerDumpStatements,
        and(eq(brokerDumpStatements.brokerId, brokerId), sql`${brokerDumpStatements.id} = ${eventLedger.payloadJson}->>'statementId'`))
        .leftJoin(users, eq(users.id, eventLedger.actorId))
        .where(and(eq(eventLedger.entityType, "broker"), eq(eventLedger.entityId, brokerId),
          inArray(eventLedger.eventType, ["broker_dump_statement_sent", "broker_dump_statement_failed", "broker_dump_statement_skipped",
            "entity_note_added", "entity_note_edited", "entity_note_deleted"])))
        .orderBy(desc(eventLedger.createdAt), desc(eventLedger.id)).limit(100);
      res.set("Cache-Control", "no-store").json(rows.map(({ stored, ...row }) => ({
        ...row, downloadUrl: stored && row.statementId ? `/api/brokers/${brokerId}/dump-statements/${row.statementId}/download` : null,
      })));
    } catch { res.status(500).json({ message: "Unable to load broker statement history." }); }
  });
  app.get("/api/brokers/:id/dump-statements/:statementId/download", requireAuth, async (req, res) => {
    const brokerId = Number(req.params.id);
    if (!Number.isSafeInteger(brokerId) || brokerId < 1) return res.status(400).json({ message: "Invalid broker ID." });
    try {
      const [job] = await store.select().from(brokerDumpStatements).where(and(
        eq(brokerDumpStatements.id, req.params.statementId), eq(brokerDumpStatements.brokerId, brokerId)));
      if (!job?.pdfStoredAt) return res.status(404).json({ message: "Statement PDF not available." });
      res.set("Cache-Control", "no-store").redirect(await sign(job.s3Key, `TPF_Dump_Statement_${job.id}.pdf`));
    } catch { res.status(500).json({ message: "Unable to download statement PDF." }); }
  });
}
