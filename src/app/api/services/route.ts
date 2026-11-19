import { handle, json, requireUser } from "@/server/http";
import { allServiceStatus } from "@/server/providers/status";

export const GET = handle(async () => {
  await requireUser();
  return json({ services: allServiceStatus() });
});
