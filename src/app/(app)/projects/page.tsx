import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePageUser } from "@/server/auth/session";
import { listProjects } from "@/server/services/projects";
import { PageHeader } from "@/components/shell/page-header";
import { ProjectsList } from "@/components/projects/projects-list";
import { buttonClass } from "@/components/ui/button";

export const metadata = { title: "Proyectos" };

export default async function ProjectsPage() {
  const user = await requirePageUser();
  const projects = await listProjects(user.id);
  return (
    <>
      <PageHeader
        title="Proyectos"
        subtitle={`${projects.length} ${projects.length === 1 ? "proyecto" : "proyectos"}`}
        actions={
          <Link href="/new" className={buttonClass("primary", "md", "hidden sm:inline-flex")}>
            <Plus className="size-4" /> Nuevo
          </Link>
        }
      />
      <ProjectsList projects={projects} />
    </>
  );
}
