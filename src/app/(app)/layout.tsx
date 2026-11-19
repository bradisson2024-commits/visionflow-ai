import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/auth/session";
import { BottomNav, Sidebar } from "@/components/shell/nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return (
    <div className="min-h-dvh">
      <Sidebar user={user} />
      <main className="pb-28 md:pb-12 md:pl-60 lg:pl-64">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-10">{children}</div>
      </main>
      <BottomNav />
    </div>
  );
}
