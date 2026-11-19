import { describe, expect, it } from "vitest";
import { assertPublicUrl, detectPlatform, normalizeShareUrl } from "@/server/services/url-import";

describe("Protección de enlaces (SSRF) — sin IMPORT_ALLOW_PRIVATE_HOSTS", () => {
  it("bloquea direcciones locales y privadas", async () => {
    delete process.env.IMPORT_ALLOW_PRIVATE_HOSTS;
    for (const u of ["http://127.0.0.1/a.mp4", "http://localhost/a.mp4", "http://10.0.0.5/a.mp4", "http://192.168.1.2/a.mp4", "http://169.254.169.254/latest", "http://[::1]/a.mp4"])
      await expect(assertPublicUrl(u), u).rejects.toThrow(/privada o local/);
  });
  it("detecta plataformas", () => {
    expect(detectPlatform("m.youtube.com")?.name).toBe("YouTube");
    expect(detectPlatform("vm.tiktok.com")?.name).toBe("TikTok");
    expect(detectPlatform("example.com")).toBeNull();
  });
  it("convierte enlaces de compartir de Dropbox y Google Drive en descarga directa", () => {
    expect(normalizeShareUrl(new URL("https://www.dropbox.com/s/abc/v.mp4?dl=0")).searchParams.get("dl")).toBe("1");
    expect(normalizeShareUrl(new URL("https://drive.google.com/file/d/FILEID/view?usp=sharing")).toString()).toContain("id=FILEID");
  });
});
