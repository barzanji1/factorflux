import { runDatabaseBackup } from "../server/services/databaseBackup";
import { BACKUP_TIMEOUT_MS } from "../server/services/sqlBackup";

try {
  console.info("[backup] Starting SQL backup", { timeoutMs: BACKUP_TIMEOUT_MS });
  console.log(JSON.stringify(await runDatabaseBackup()));
} catch {
  // The shared runner sends the failure alert; never print connection strings.
  console.error("Database backup failed; see the backup log and alert email.");
  process.exitCode = 1;
}
