/**
 * Almacenamiento de archivos con dos controladores intercambiables:
 *  - local: disco del servidor (STORAGE_LOCAL_DIR)
 *  - s3:    cualquier servicio compatible con S3 (AWS, R2, MinIO, Supabase Storage)
 *
 * FFmpeg necesita archivos locales, así que `materialize()` devuelve una ruta
 * local (directa en modo local; descarga temporal en modo s3).
 */
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat, rename, copyFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { env } from "../env";

export type ReadResult = { stream: Readable; size: number; start: number; end: number };

const root = () => path.resolve(env.STORAGE_LOCAL_DIR);
const safeKey = (key: string) => {
  const p = path.resolve(root(), key);
  if (!p.startsWith(root() + path.sep)) throw new Error("Clave de almacenamiento no válida");
  return p;
};

/** Directorio de trabajo temporal (subidas parciales, renders intermedios). */
export async function tempDir(...parts: string[]) {
  const dir = path.join(root(), "tmp", ...parts);
  await mkdir(dir, { recursive: true });
  return dir;
}

let s3Client: import("@aws-sdk/client-s3").S3Client | null = null;
async function s3() {
  if (!s3Client) {
    const { S3Client } = await import("@aws-sdk/client-s3");
    s3Client = new S3Client({
      region: env.S3_REGION || "auto",
      endpoint: env.S3_ENDPOINT || undefined,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    });
  }
  return s3Client;
}

export const storage = {
  /** Mueve/sube un archivo local al almacenamiento bajo `key`. Consume el archivo de origen. */
  async putFile(key: string, localPath: string, contentType?: string) {
    if (env.STORAGE_DRIVER === "s3") {
      const { Upload } = await import("@aws-sdk/lib-storage");
      await new Upload({
        client: await s3(),
        params: { Bucket: env.S3_BUCKET, Key: key, Body: createReadStream(localPath), ContentType: contentType },
      }).done();
      await rm(localPath, { force: true });
      return;
    }
    const dest = safeKey(key);
    await mkdir(path.dirname(dest), { recursive: true });
    try {
      await rename(localPath, dest);
    } catch {
      await copyFile(localPath, dest);
      await rm(localPath, { force: true });
    }
  },

  async size(key: string): Promise<number> {
    if (env.STORAGE_DRIVER === "s3") {
      const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
      const r = await (await s3()).send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
      return Number(r.ContentLength ?? 0);
    }
    return (await stat(safeKey(key))).size;
  },

  /** Lectura con soporte de rangos (para reproducir video con búsqueda). */
  async read(key: string, range?: { start: number; end?: number }): Promise<ReadResult> {
    const size = await this.size(key);
    const start = range?.start ?? 0;
    const end = Math.min(range?.end ?? size - 1, size - 1);
    if (env.STORAGE_DRIVER === "s3") {
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const r = await (await s3()).send(
        new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Range: range ? `bytes=${start}-${end}` : undefined }),
      );
      return { stream: r.Body as Readable, size, start, end };
    }
    return { stream: createReadStream(safeKey(key), { start, end }), size, start, end };
  },

  /** Devuelve una ruta local utilizable por FFmpeg y una función de limpieza. */
  async materialize(key: string): Promise<{ path: string; cleanup: () => Promise<void> }> {
    if (env.STORAGE_DRIVER !== "s3") return { path: safeKey(key), cleanup: async () => {} };
    const dir = path.join(os.tmpdir(), "clipforge");
    await mkdir(dir, { recursive: true });
    const local = path.join(dir, `${Date.now()}-${path.basename(key)}`);
    const { stream } = await this.read(key);
    await pipeline(stream, createWriteStream(local));
    return { path: local, cleanup: () => rm(local, { force: true }) };
  },

  /** Elimina todos los archivos bajo un prefijo (p. ej. un proyecto). */
  async deletePrefix(prefix: string) {
    if (env.STORAGE_DRIVER === "s3") {
      const { ListObjectsV2Command, DeleteObjectsCommand } = await import("@aws-sdk/client-s3");
      const client = await s3();
      let token: string | undefined;
      do {
        const list = await client.send(new ListObjectsV2Command({ Bucket: env.S3_BUCKET, Prefix: prefix, ContinuationToken: token }));
        const objs = (list.Contents ?? []).map((o) => ({ Key: o.Key! }));
        if (objs.length) await client.send(new DeleteObjectsCommand({ Bucket: env.S3_BUCKET, Delete: { Objects: objs } }));
        token = list.NextContinuationToken;
      } while (token);
      return;
    }
    await rm(safeKey(prefix), { recursive: true, force: true });
  },
};

export const keys = {
  projectPrefix: (projectId: string) => `projects/${projectId}/`,
  videoSource: (projectId: string, videoId: string, ext: string) => `projects/${projectId}/videos/${videoId}/source${ext}`,
  videoThumb: (projectId: string, videoId: string) => `projects/${projectId}/videos/${videoId}/thumb.jpg`,
  clipPrefix: (projectId: string, clipId: string) => `projects/${projectId}/clips/${clipId}/`,
  clipFile: (projectId: string, clipId: string, version: number, ext: string) => `projects/${projectId}/clips/${clipId}/clip-${version}${ext}`,
};
