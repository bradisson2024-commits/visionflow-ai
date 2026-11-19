import Link from "next/link";
export default function NotFound() {
  return (
    <div className="py-24 text-center">
      <h1 className="font-display text-2xl font-semibold">Proyecto no encontrado</h1>
      <p className="mt-2 text-sm text-muted">No existe o no pertenece a tu cuenta.</p>
      <Link href="/projects" className="mt-6 inline-block text-sm text-ember-2 hover:underline">Volver a proyectos</Link>
    </div>
  );
}
