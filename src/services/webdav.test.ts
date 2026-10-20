import { describe, expect, it, vi } from "vitest";
import { WebDavUploader } from "./webdav";

describe("WebDavUploader", () => {
  it("creates encoded destination folders and uploads without overwrite", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 201 }));
    const uploader = new WebDavUploader("https://cloud.example/dav/files/user/", fetcher);

    await uploader.upload("63 - KALSEL/6301 - TANAH LAUT/2026-10-19/hasil akhir.xlsx", new Blob(["excel"]));

    expect(fetcher.mock.calls.map(([url, options]) => [url, options?.method])).toEqual([
      ["https://cloud.example/dav/files/user/63%20-%20KALSEL/", "MKCOL"],
      ["https://cloud.example/dav/files/user/63%20-%20KALSEL/6301%20-%20TANAH%20LAUT/", "MKCOL"],
      ["https://cloud.example/dav/files/user/63%20-%20KALSEL/6301%20-%20TANAH%20LAUT/2026-10-19/", "MKCOL"],
      ["https://cloud.example/dav/files/user/63%20-%20KALSEL/6301%20-%20TANAH%20LAUT/2026-10-19/hasil%20akhir.xlsx", "PUT"],
    ]);
    expect(fetcher.mock.calls.at(-1)?.[1]).toMatchObject({
      credentials: "include",
      headers: { "If-None-Match": "*" },
    });
  });

  it("accepts existing folders and reports a remote collision", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 405 }))
      .mockResolvedValueOnce(new Response(null, { status: 412 }));
    const uploader = new WebDavUploader("https://cloud.example/dav/files/user", fetcher);

    await expect(uploader.upload("folder/result.xlsx", new Blob())).rejects.toThrow("File tujuan sudah ada: folder/result.xlsx");
  });

  it("turns authentication failures into an actionable message", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }));
    const uploader = new WebDavUploader("https://cloud.example/dav/files/user/", fetcher);

    await expect(uploader.upload("folder/result.xlsx", new Blob())).rejects.toThrow("Login ke Transdata Cloud");
  });
});
