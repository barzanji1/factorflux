import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { pool } from "../db";
import { assertPayrollAdmin, getPayStatementPdf, getPayrollReview, listPayStatements, mutateContractorPayroll, PayrollError, payrollAdminOverview } from "../services/contractorPayroll";

const numberId = z.coerce.number().int().positive();
const paging = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  year: z.coerce.number().int().min(2000).max(2200).default(() => new Date().getFullYear()),
}).strict();
export function registerContractorPayrollRoutes(app: Express, auth: RequestHandler) {
  const handler = (action: string): RequestHandler => async (req: any, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    try {
      const actor = req.user;
      if (action === "list") {
        const { page, year } = paging.parse(req.query);
        return void res.json(await listPayStatements(actor, page, year));
      }
      if (action === "pdf") {
        const pdf = await getPayStatementPdf(actor, numberId.parse(req.params.id));
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="${pdf.number}.pdf"`);
        res.setHeader("X-Pay-Statement-Status", pdf.status);
        res.setHeader("X-Content-Type-Options", "nosniff");
        return void res.send(pdf.bytes);
      }
      assertPayrollAdmin(actor);
      if (action === "admin") {
        const { contractorPage, periodPage } = z.object({
          contractorPage: numberId.max(100000).default(1), periodPage: numberId.max(100000).default(1),
        }).strict().parse(req.query);
        return void res.json(await payrollAdminOverview(contractorPage, periodPage));
      }
      if (action === "review") return void res.json(await getPayrollReview(numberId.parse(req.params.id)));
      if (action === "audit") {
        const { page } = z.object({ page: numberId.default(1) }).strict().parse(req.query);
        const [rows, count] = await Promise.all([
          pool.query(`SELECT id,action,actor_name AS "actorName",created_at AS "createdAt",details
            FROM contractor_payroll_audit ORDER BY created_at DESC,id DESC LIMIT 15 OFFSET $1`, [(page - 1) * 15]),
          pool.query("SELECT count(*)::int AS total FROM contractor_payroll_audit"),
        ]);
        return void res.json({ items: rows.rows, total: count.rows[0].total, page });
      }
      let id = req.params.id ?? req.params.contractorId ?? "";
      if (["time", "approve", "lock", "unlock", "issue"].includes(action)) id = String(numberId.parse(req.params.id));
      const result = await mutateContractorPayroll(actor, action, id, req.body);
      res.status(action === "issue" || action === "period" ? 201 : 200).json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) return void res.status(400).json({ message: error.issues[0]?.message ?? "Invalid payroll request." });
      if (error instanceof PayrollError) return void res.status(error.status).json({ message: error.message });
      if (error?.code === "23514" && /Payroll period is locked/.test(error.message)) return void res.status(409).json({ message: "This period is locked. An admin must unlock it before editing time." });
      if (error?.code === "23505") return void res.status(409).json({ message: "This payroll record already exists. Refresh and try again." });
      console.error("[contractor-payroll] Request failed:", error?.code || error?.name || "Unknown error");
      res.status(500).json({ message: "Payroll could not be loaded or saved. No partial operation was committed." });
    }
  };
  app.get("/api/contractor-payroll", auth, handler("list"));
  app.get("/api/contractor-payroll/admin", auth, handler("admin"));
  app.get("/api/contractor-payroll/audit", auth, handler("audit"));
  app.get("/api/contractor-payroll/periods/:id", auth, handler("review"));
  app.get("/api/contractor-payroll/statements/:id/pdf", auth, handler("pdf"));
  app.put("/api/contractor-payroll/rates/:contractorId", auth, handler("rate"));
  app.patch("/api/contractor-payroll/settings", auth, handler("settings"));
  app.post("/api/contractor-payroll/periods", auth, handler("period"));
  app.patch("/api/contractor-payroll/time-entries/:id", auth, handler("time"));
  for (const action of ["approve", "lock", "unlock", "issue"]) app.post(`/api/contractor-payroll/periods/:id/${action}`, auth, handler(action));
}
