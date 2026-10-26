import { runDatabaseBackup } from "../server/services/databaseBackup";

try {
  console.log(JSON.stringify(await runDatabaseBackup()));
} catch {
  // The shared runner sends the failure alert; never print connection strings.
  console.error("Database backup failed; see the backup log and alert email.");
  process.exitCode = 1;
}
