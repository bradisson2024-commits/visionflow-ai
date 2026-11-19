import type { z } from "zod";

export type JsonRequest<T extends z.ZodType> = {
  system: string;
  user: string;
  schema: T;
  schemaName: string;
  signal?: AbortSignal;
};

export type LlmProvider = {
  id: string;
  model: string;
  generateJson<T extends z.ZodType>(req: JsonRequest<T>): Promise<z.infer<T>>;
};
