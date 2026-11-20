import { PageHeader } from "@/components/shell/page-header";
import { CreateProjectForm } from "@/components/projects/create-project-form";

export const metadata = { title: "Nuevo proyecto" };

export default function NewProjectPage() {
  return (
    <>
      <PageHeader title="Nuevo proyecto" subtitle="Crea un proyecto vacío y sube tu video desde el teléfono o el computador." />
      <div className="max-w-xl rounded-3xl border border-line bg-surface p-5 sm:p-7">
        <CreateProjectForm autoFocus />
      </div>
    </>
  );
}
