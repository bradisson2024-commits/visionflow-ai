import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, AudioLines, Download, Scissors, Sparkles, Upload } from "lucide-react";
import { requirePageUser } from "@/server/auth/session";
import { listProjects } from "@/server/services/projects";
import { PageHeader } from "@/components/shell/page-header";
import { QuickClipForm } from "@/components/projects/quick-clip-form";
import { llmStatus } from "@/server/providers/status";
import { env } from "@/server/env";
import { checkOllama } from "@/server/providers/llm/ollama";
import { ProjectCard } from "@/components/projects/project-card";
import { ServicesPanel } from "@/components/settings/services-panel";

export const metadata = { title: "Inicio" };

const pipeline = [
  { icon: Upload, label: "Importar", hint: "MP4 · MOV" },
  { icon: AudioLines, label: "Transcribir", hint: "Palabra a palabra" },
  { icon: Sparkles, label: "Detectar", hint: "Mejores momentos" },
  { icon: Scissors, label: "Editar", hint: "Formato y subtítulos" },
  { icon: Download, label: "Exportar", hint: "Shorts · Reels · TikTok" },
];

export default async function DashboardPage() {
  const user = await requirePageUser();
  const projects = await listProjects(user.id);
  const recent = projects.slice(0, 6);
  const l = llmStatus();
  const ollamaProblem = l.ready && env.LLM_PROVIDER === "ollama" ? await checkOllama() : null;
  const llmReady = l.ready && !ollamaProblem;
  const llmMissing = ollamaProblem ?? `falta ${l.missing.join(", ")}`;

  return (
    <>
      <PageHeader title={`Hola, ${user.name.split(" ")[0]}`} subtitle="¿Qué video convertimos en clips hoy?" />

      <section className="filmstrip relative overflow-hidden rounded-3xl border border-line bg-surface p-5 sm:p-7">
        <h2 className="font-display max-w-xl text-2xl font-semibold leading-tight sm:text-3xl">
          Pega un video largo. <span className="forge-text">Recibe sus clips más virales.</span>
        </h2>
        <p className="mt-2 max-w-xl text-sm text-muted">
          La IA transcribe el video, encuentra los momentos con más potencial (con una idea completa, no cortes
          al azar) y los ordena de mayor a menor puntuación, listos en vertical con subtítulos.
        </p>
        <div className="mt-5 max-w-2xl">
          <QuickClipForm llmReady={llmReady} llmMissing={llmMissing} />
        </div>
        <ol className="mt-7 grid grid-cols-5 gap-1.5 sm:gap-3" aria-label="Flujo de trabajo">
          {pipeline.map(({ icon: Icon, label, hint }, i) => (
            <li key={label} className="relative">
              <div className="flex flex-col items-center gap-1.5 rounded-xl border border-line/70 bg-bg/40 px-1 py-3 text-center sm:items-start sm:px-3 sm:text-left">
                <Icon className="size-4 text-ember-2" />
                <span className="text-[11px] font-medium sm:text-sm">{label}</span>
                <span className="hidden text-[11px] text-faint sm:block">{hint}</span>
              </div>
              {i < pipeline.length - 1 && <span className="absolute -right-1.5 top-1/2 hidden h-px w-3 bg-line-strong sm:block" />}
            </li>
          ))}
        </ol>
      </section>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_300px]">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">Proyectos recientes</h2>
            {projects.length > 0 && (
              <Link href="/projects" className="inline-flex items-center gap-1 text-sm text-muted hover:text-text">
                Ver todos <ArrowRight className="size-3.5" />
              </Link>
            )}
          </div>
          {recent.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line px-6 py-12 text-center">
              <p className="text-sm text-muted">Todavía no tienes proyectos.</p>
              <p className="mt-1 text-xs text-faint">Crea el primero con el formulario de arriba.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {recent.map((p) => (
                <ProjectCard key={p.id} p={p} />
              ))}
            </div>
          )}
        </section>

        <aside>
          <h2 className="font-display mb-3 text-lg font-semibold">Estado del sistema</h2>
          <div className="rounded-2xl border border-line bg-surface px-4">
            <Suspense fallback={<p className="py-4 text-sm text-faint">Comprobando servicios…</p>}>
              <ServicesPanel />
            </Suspense>
          </div>
          <Link href="/settings" className="mt-2 inline-block text-xs text-muted hover:text-text">
            Ver configuración →
          </Link>
        </aside>
      </div>
    </>
  );
}
