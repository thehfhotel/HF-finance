import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { withSession } from "./lib/session";
import { runTransferPayrollFlow } from "./flows/transfer-payroll-flow";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: npm run transfer-payroll -- <path/to/xlsx>");
  process.exit(1);
}
const abs = resolve(filePath);
if (!existsSync(abs)) { console.error(`File not found: ${abs}`); process.exit(1); }

await withSession(async (_ctx, page) => {
  const result = await runTransferPayrollFlow(page, abs);
  if (result.success) {
    console.log(`\n✅ Done. final URL: ${result.finalUrl}`);
  } else {
    console.error(`\n❌ Failed: ${result.error}`);
    process.exit(1);
  }
});
