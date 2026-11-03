import type { Express, RequestHandler } from "express";
import { ZodError, z } from "zod";
import { buildChargebackReport, chargebackReportCsv, chargebackCsvColumns, searchChargebackReportDirectory } from "../services/chargebackReport";

export function registerChargebackReportRoutes(app: Express, requireReports: RequestHandler,
  build: typeof buildChargebackReport = buildChargebackReport,
  search: typeof searchChargebackReportDirectory = searchChargebackReportDirectory) {
  app.get("/api/reports/chargeback/options", requireReports, async (req, res) => {
    try { res.set("Cache-Control", "no-store").json(await search(req.query)); }
    catch (error) {
      if (error instanceof ZodError) return res.status(400).json({ message: error.errors[0]?.message ?? "Invalid search." });
      res.status(500).json({ message: "Unable to search report directories." });
    }
  });
  for (const csv of [false, true]) app.get(`/api/reports/chargeback${csv ? ".csv" : ""}`, requireReports, async (req, res) => {
    try {
      const { columns, ...filters } = req.query;
      const selected = columns === undefined ? undefined : z.string().transform(value => value.split(","))
        .refine(value => value.length > 0 && new Set(value).size === value.length && value.every(key => key in chargebackCsvColumns),
          "Choose valid export columns.").parse(columns);
      const report = await build(filters);
      res.set("Cache-Control", "no-store");
      if (csv) res.type("text/csv").attachment("Trucking_Pros_Financial_Chargeback_Report.csv").send(chargebackReportCsv(report, selected));
      else res.json(report);
    } catch (error) {
      if (error instanceof ZodError) return res.status(400).json({ message: error.errors[0]?.message ?? "Invalid report filters." });
      console.error("[chargebackReport] report failed", error instanceof Error ? error.message : "Unknown error");
      res.status(500).json({ message: "Unable to load the Chargeback report." });
    }
  });
}
