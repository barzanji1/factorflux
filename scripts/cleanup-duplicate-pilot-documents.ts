// Narrow, byte-verified cleanup of the two abandoned intake attempts for INV001.
// Dry run by default; --apply removes only the exact unlinked IDs below.
import { pool } from "../server/db";
import { downloadFromS3 } from "../server/services/s3Service";
import { createHash } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

async function main() {
  const orphanIds = [85, 86, 87, 88, 89, 90, 91, 92];
  const keptIds = [93, 94, 95, 96];
  const { rows } = await pool.query("SELECT * FROM documents WHERE id = ANY($1::int[]) ORDER BY id", [[...orphanIds, ...keptIds]]);
  assert.equal(rows.length, 12, "Expected exactly these twelve intake rows");
  const hashes = new Map<number, string>();
  for (const row of rows) {
    assert(row.s3_key && row.uploaded_by === "admin-1");
    assert.equal(row.source_channel, "manual");
    if (keptIds.includes(row.id)) assert.equal(row.invoice_id, 189);
    else { assert.equal(row.invoice_id, null); assert.equal(row.load_id, null); assert.equal(row.client_id, null); }
    hashes.set(row.id, createHash("sha256").update(await downloadFromS3(row.s3_key)).digest("hex"));
  }
  const matches = orphanIds.map(id => {
    const orphan = rows.find(row => row.id === id)!;
    const kept = rows.filter(row => keptIds.includes(row.id) && row.original_name === orphan.original_name && hashes.get(row.id) === hashes.get(id));
    assert.equal(kept.length, 1, `Orphan ${id} must have exactly one byte-identical linked counterpart`);
    return { removedId: id, keptId: kept[0].id, sha256: hashes.get(id) };
  });
  console.log(JSON.stringify({ apply: process.argv.includes("--apply"), invoiceId: 189, matches }, null, 2));
  if (!process.argv.includes("--apply")) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query("SELECT * FROM documents WHERE id = ANY($1::int[]) FOR UPDATE", [[...orphanIds, ...keptIds]]);
    assert.equal(locked.rows.length, 12);
    for (const row of locked.rows) {
      const before = rows.find(r => r.id === row.id)!;
      assert.deepEqual(row, before, `Document ${row.id} changed during verification`);
    }
    const jobs = await client.query("SELECT * FROM doc_extraction_jobs WHERE document_id = ANY($1::int[]) FOR UPDATE", [orphanIds]);
    assert(jobs.rows.every(job => !["queued", "processing"].includes(job.status)), "An OCR job is still active");
    const backup: Record<string, unknown> = { documents: rows, jobs: jobs.rows, matches };
    for (const table of ["doc_extraction_results", "doc_field_candidates", "doc_reviews"]) {
      backup[table] = (await client.query(`SELECT * FROM ${table} WHERE document_id = ANY($1::int[])`, [orphanIds])).rows;
    }
    await mkdir("generated-artifacts", { recursive: true });
    await writeFile("generated-artifacts/duplicate-intake-cleanup-backup.json", JSON.stringify(backup, null, 2));
    for (const row of rows) {
      if (orphanIds.includes(row.id)) await client.query(
        "INSERT INTO s3_cleanup_queue(s3_key,reason) VALUES ($1,$2) ON CONFLICT (s3_key) DO NOTHING",
        [row.s3_key, `Byte-identical abandoned intake row ${row.id}; invoice 189 retains counterpart`],
      );
      else await client.query("UPDATE documents SET source_sha256=$1 WHERE id=$2", [hashes.get(row.id), row.id]);
    }
    const deleted = await client.query("DELETE FROM documents WHERE id=ANY($1::int[]) AND invoice_id IS NULL AND load_id IS NULL RETURNING id", [orphanIds]);
    assert.equal(deleted.rowCount, 8);
    await client.query("COMMIT");
    console.log("Removed exactly eight orphan rows; kept linked documents 93–96. Redundant S3 objects queued for durable deletion.");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
