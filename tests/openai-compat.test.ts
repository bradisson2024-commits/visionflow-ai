/** Proveedor compatible con OpenAI: si el servicio no admite json_schema, se reintenta con json_object. */
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { openAICompatibleProvider } from "@/server/providers/llm/openai";

let server: http.Server;
let base = "";
const formats: string[] = [];
beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const j = JSON.parse(body);
    formats.push(j.response_format.type);
    res.setHeader("content-type", "application/json");
    if (j.response_format.type === "json_schema") {
      res.statusCode = 400;
      return void res.end(JSON.stringify({ error: { message: "response_format json_schema is not supported for this model" } }));
    }
    res.end(JSON.stringify({ choices: [{ message: { content: '{"ok": true, "n": 3}' } }] }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
});
afterAll(() => server.close());

describe("openai_compatible", () => {
  it("reintenta con json_object y valida el resultado con el esquema", async () => {
    const llm = openAICompatibleProvider({ id: "test", baseUrl: base, apiKey: "x", model: "m" });
    const out = await llm.generateJson({ system: "s", user: "u", schema: z.object({ ok: z.boolean(), n: z.number() }), schemaName: "t" });
    expect(out).toEqual({ ok: true, n: 3 });
    expect(formats).toEqual(["json_schema", "json_object"]);
  });
});
