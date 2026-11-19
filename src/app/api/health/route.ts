import { json } from "@/server/http";
import { runHealthChecks } from "@/server/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks = await runHealthChecks();
  const ok = checks.every((c) => c.ok || c.optional);
  return json({ ok, checks }, ok ? 200 : 503);
}
