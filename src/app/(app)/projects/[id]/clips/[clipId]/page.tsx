import { notFound } from "next/navigation";
import { requirePageUser } from "@/server/auth/session";
import { getClipDetail } from "@/server/services/clips";
import { HttpError } from "@/server/http";
import { ClipEditor } from "@/components/editor/clip-editor";

export const metadata = { title: "Editor de clip" };

export default async function ClipEditorPage({ params }: { params: Promise<{ id: string; clipId: string }> }) {
  const { id, clipId } = await params;
  const user = await requirePageUser();
  let detail;
  try {
    detail = await getClipDetail(user.id, clipId);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  if (detail.project.id !== id) notFound();
  return <ClipEditor key={detail.clip.updatedAt.toString()} {...detail} />;
}
