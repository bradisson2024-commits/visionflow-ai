import { handle, json, requireUser } from "@/server/http";

export const GET = handle(async () => json({ user: await requireUser() }));
