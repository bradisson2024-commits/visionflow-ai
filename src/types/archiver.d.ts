// Tipos mínimos para archiver 8 (el paquete no publica tipos para la API de clases).
declare module "archiver" {
  import type { Readable, Transform } from "node:stream";
  export class ZipArchive extends Transform {
    constructor(options?: { store?: boolean; zlib?: { level?: number } });
    append(source: Readable | Buffer | string, data: { name: string }): this;
    finalize(): Promise<void>;
    abort(): this;
  }
}
