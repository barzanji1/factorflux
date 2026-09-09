import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { db, pool } from "../db";
import { brokers, clients } from "../../shared/schema";

type CsvRow = string[];

const ASSET_DIR = path.resolve(process.cwd(), "attached_assets");

function resolveCsv(requestedName: string): string {
  const exact = path.join(ASSET_DIR, requestedName);
  if (fs.existsSync(exact)) return exact;

  const stem = requestedName.replace(/\.csv$/i, "");
  const matching = fs.readdirSync(ASSET_DIR)
    .filter((name) => name.startsWith(`${stem}_`) && name.toLowerCase().endsWith(".csv"))
    .sort();
  if (matching.length !== 1) {
    throw new Error(`Could not uniquely resolve ${requestedName}; found ${matching.length} matching uploaded files`);
  }
  return path.join(ASSET_DIR, matching[0]);
}

function readCsv(filePath: string): { headers: string[]; rows: CsvRow[] } {
  const records = parse(fs.readFileSync(filePath), {
    bom: true,
    relax_column_count: false,
    skip_empty_lines: true,
  }) as CsvRow[];
  if (records.length === 0) throw new Error(`CSV is empty: ${filePath}`);
  const [headers, ...rows] = records;
  return { headers: headers.map((value) => value.trim()), rows };
}

function columnIndex(headers: string[], name: string, occurrence = 0): number {
  const matches = headers
    .map((header, index) => ({ header, index }))
    .filter(({ header }) => header === name);
  return matches[occurrence]?.index ?? -1;
}

function valueAt(row: CsvRow, headers: string[], name: string, occurrence = 0): string {
  const index = columnIndex(headers, name, occurrence);
  return index >= 0 ? (row[index] ?? "").trim() : "";
}

function firstValue(row: CsvRow, headers: string[], candidates: Array<[string, number?]>): string {
  for (const [name, occurrence = 0] of candidates) {
    const value = valueAt(row, headers, name, occurrence);
    if (value) return value;
  }
  return "";
}

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function decimal(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value.replace(/[$,%\s,]/g, ""));
  if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric value: ${value}`);
  return parsed.toFixed(2);
}

function integerCurrency(value: string): number | undefined {
  const parsed = decimal(value);
  return parsed === undefined ? undefined : Math.round(Number(parsed));
}

function createdAt(value: string): Date | undefined {
  if (!value.trim()) return undefined;
  const parsed = new Date(`${value.trim()}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid Date Created value: ${value}`);
  return parsed;
}

function brokerStatus(value: string): "active" | "inactive" {
  return normalized(value) === "inactive" ? "inactive" : "active";
}

function carrierStatus(value: string): "active" | "inactive" | "new_client" {
  const status = normalized(value);
  if (status === "active") return "active";
  if (status === "inactive") return "inactive";
  return "new_client";
}

function ownerAt(row: CsvRow, headers: string[], occurrence: number): Record<string, string> | null {
  const firstName = valueAt(row, headers, "First Name", occurrence);
  const lastName = valueAt(row, headers, "Last Name", occurrence);
  const dateOfBirth = occurrence === 2
    ? firstValue(row, headers, [["DOB", occurrence], ["DBO", 0]])
    : valueAt(row, headers, "DOB", occurrence);
  const mobile = valueAt(row, headers, "Mobile Number", occurrence);
  const email = valueAt(row, headers, "Email Address", occurrence);
  if (![firstName, lastName, dateOfBirth, mobile, email].some(Boolean)) return null;
  return { firstName, lastName, dateOfBirth, mobile, email };
}

async function run(): Promise<void> {
  const brokerCsv = readCsv(resolveCsv("260909053353_aaa-brokers_formidable_entries.csv"));
  const carrierCsv = readCsv(resolveCsv("260909053407_aaa-carrier_formidable_entries.csv"));

  let carriersImported = 0;
  let brokersImported = 0;
  let skipped = 0;

  await db.transaction(async (tx) => {
    const existingClients = await tx.select({ name: clients.name, mcNumber: clients.mcNumber }).from(clients);
    const existingBrokers = await tx.select({ name: brokers.name, mcNumber: brokers.mcNumber }).from(brokers);
    const clientNames = new Set(existingClients.map((record) => normalized(record.name)));
    const clientMcs = new Set(existingClients.map((record) => normalized(record.mcNumber ?? "")).filter(Boolean));
    const brokerNames = new Set(existingBrokers.map((record) => normalized(record.name)));
    const brokerMcs = new Set(existingBrokers.map((record) => normalized(record.mcNumber ?? "")).filter(Boolean));

    for (const row of carrierCsv.rows) {
      const name = valueAt(row, carrierCsv.headers, "Legal Name");
      const mcNumber = valueAt(row, carrierCsv.headers, "MC#");
      if (!name) {
        skipped += 1;
        console.log("Skipped carrier: empty Legal Name");
        continue;
      }
      if (clientNames.has(normalized(name))) {
        skipped += 1;
        console.log(`Skipped carrier: ${name} / duplicate name`);
        continue;
      }
      if (mcNumber && clientMcs.has(normalized(mcNumber))) {
        skipped += 1;
        console.log(`Skipped carrier: ${name} / duplicate MC# ${mcNumber}`);
        continue;
      }

      const owners = [0, 1, 2]
        .map((occurrence) => ownerAt(row, carrierCsv.headers, occurrence))
        .filter((owner): owner is Record<string, string> => owner !== null);
      const onboardingProfile = {
        noa: firstValue(row, carrierCsv.headers, [["NOA", 0], ["NOA", 1]]),
        factoringCompany: valueAt(row, carrierCsv.headers, "Factoring Company"),
        paymentMethodPreferences: {
          ldm: valueAt(row, carrierCsv.headers, "LDM"),
          fdm: valueAt(row, carrierCsv.headers, "FDM"),
        },
        owners,
      };

      await tx.insert(clients).values({
        name,
        preferredName: valueAt(row, carrierCsv.headers, "Preferred Name") || null,
        mcNumber: mcNumber || null,
        dotNumber: valueAt(row, carrierCsv.headers, "DOT#") || null,
        phone: valueAt(row, carrierCsv.headers, "Phone #") || null,
        email: firstValue(row, carrierCsv.headers, [["Email Address", 0], ["Email Address", 1], ["Email Address", 2]]) || null,
        address: valueAt(row, carrierCsv.headers, "Address", 1) || null,
        city: valueAt(row, carrierCsv.headers, "City", 1) || null,
        state: firstValue(row, carrierCsv.headers, [["State (value)", 1], ["State (label)", 1]]) || null,
        zipCode: valueAt(row, carrierCsv.headers, "Zip/Postal", 0) || null,
        status: carrierStatus(valueAt(row, carrierCsv.headers, "Status")),
        advanceRate: decimal(valueAt(row, carrierCsv.headers, "FA %")),
        factoringFeeRate: decimal(valueAt(row, carrierCsv.headers, "Rate %")),
        creditLimit: decimal(valueAt(row, carrierCsv.headers, "Current Limit $")),
        maxLimit: decimal(valueAt(row, carrierCsv.headers, "Max Limit $")),
        onboardingProfile,
        owners,
        createdAt: createdAt(valueAt(row, carrierCsv.headers, "Date Created")),
        source: "import",
      });
      clientNames.add(normalized(name));
      if (mcNumber) clientMcs.add(normalized(mcNumber));
      carriersImported += 1;
      console.log(`Imported carrier: ${name}`);
    }

    for (const row of brokerCsv.rows) {
      const name = valueAt(row, brokerCsv.headers, "Name");
      const mcNumber = valueAt(row, brokerCsv.headers, "MC#");
      if (!name) {
        skipped += 1;
        console.log("Skipped broker: empty Name");
        continue;
      }
      if (brokerNames.has(normalized(name))) {
        skipped += 1;
        console.log(`Skipped broker: ${name} / duplicate name`);
        continue;
      }
      if (mcNumber && brokerMcs.has(normalized(mcNumber))) {
        skipped += 1;
        console.log(`Skipped broker: ${name} / duplicate MC# ${mcNumber}`);
        continue;
      }

      const dba = valueAt(row, brokerCsv.headers, "DBA");
      await tx.insert(brokers).values({
        name,
        contactPerson: "Imported CSV",
        email: valueAt(row, brokerCsv.headers, "Email Address"),
        phone: valueAt(row, brokerCsv.headers, "Phone#"),
        address: valueAt(row, brokerCsv.headers, "Address", 0) || null,
        city: valueAt(row, brokerCsv.headers, "City", 0) || null,
        state: valueAt(row, brokerCsv.headers, "State", 0) || null,
        zipCode: valueAt(row, brokerCsv.headers, "Zip Code", 0) || null,
        mcNumber: mcNumber || null,
        creditLimit: integerCurrency(valueAt(row, brokerCsv.headers, "Current Limit $")),
        currentAr: decimal(valueAt(row, brokerCsv.headers, "AR")),
        website: valueAt(row, brokerCsv.headers, "Website/URL") || null,
        fmcsaUrl: valueAt(row, brokerCsv.headers, "SAFER FMCSA DOR GOV") || null,
        status: brokerStatus(valueAt(row, brokerCsv.headers, "Status")),
        notes: dba ? `DBA: ${dba}` : null,
        createdAt: createdAt(valueAt(row, brokerCsv.headers, "Date Created")),
        source: "import",
      });
      brokerNames.add(normalized(name));
      if (mcNumber) brokerMcs.add(normalized(mcNumber));
      brokersImported += 1;
      console.log(`Imported broker: ${name}`);
    }
  });

  console.log(`Final summary: ${carriersImported} carriers imported, ${brokersImported} brokers imported, ${skipped} skipped`);
}

run()
  .catch((error) => {
    console.error("Import failed; transaction rolled back:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });