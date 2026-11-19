import { PageHeader } from "@/components/shell/page-header";
import { CreateProjectForm } from "@/components/projects/create-project-form";

export const metadata = { title: "Nuevo proyecto" };

export default function NewProjectPage() {
  return (
    <>
      <PageHeader title="Nuevo proyecto" subtitle="Cada video que importes vive dentro de un proyecto." />
      <div className="max-w-xl rounded-3xl border border-line bg-surface p-5 sm:p-7">
        <CreateProjectForm autoFocus />
      </div>
    </>
  );
}
