import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";

export default async function Root() {
  redirect((await getSessionUser()) ? "/dashboard" : "/login");
}
