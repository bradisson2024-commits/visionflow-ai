import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";
import { Logo } from "@/components/ui/logo";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getSessionUser()) redirect("/dashboard");
  return (
    <div className="filmstrip flex min-h-dvh flex-col">
      <div className="safe-top px-6 pt-8">
        <Logo gid="cf-g-auth" />
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">{children}</div>
      </div>
      <p className="safe-bottom px-6 pb-6 text-center text-xs text-faint">
        Procesa sólo videos que tengas derecho a usar.
      </p>
    </div>
  );
}
