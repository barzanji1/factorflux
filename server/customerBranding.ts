import fs from "node:fs";
import path from "node:path";

export const CUSTOMER_COMPANY_NAME = "Trucking Pros Financial";
export function customerLogoPath(): string | undefined {
  return [
    "client/public/images/tpf-logo.png", "dist/public/images/tpf-logo.png",
    "server/assets/tpf-logo.png", "dist/tpf-logo.png",
  ].map(candidate => path.resolve(process.cwd(), candidate)).find(candidate => fs.existsSync(candidate));
}
