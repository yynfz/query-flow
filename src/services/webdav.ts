export const TIM34_WEBDAV_URL = "https://transdata-cloud.bps.go.id/remote.php/dav/files/SSO-BPS-8eb18c3f-de94-462b-9778-e23336a565e5/";

type WebDavFetch = typeof fetch;

function encodePath(path: string): string {
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw new Error(`Path WebDAV tidak aman: ${path}`);
  return parts.map(encodeURIComponent).join("/");
}

function webDavUrl(rootUrl: string, path: string, directory = false): string {
  const root = rootUrl.endsWith("/") ? rootUrl : `${rootUrl}/`;
  return `${root}${encodePath(path)}${directory ? "/" : ""}`;
}

async function responseMessage(response: Response): Promise<string> {
  if (response.status === 401 || response.status === 403) {
    return "Sesi WebDAV tidak terautentikasi. Login ke Transdata Cloud di Chrome, lalu coba lagi.";
  }
  const detail = (await response.text().catch(() => "")).trim();
  return detail ? `HTTP ${response.status}: ${detail.slice(0, 200)}` : `HTTP ${response.status} ${response.statusText}`.trim();
}

export class WebDavUploader {
  private readonly knownDirectories = new Set<string>();

  constructor(
    private readonly rootUrl: string,
    private readonly fetcher: WebDavFetch = fetch,
  ) {}

  private async ensureDirectory(path: string): Promise<void> {
    const parts = path.split("/");
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (this.knownDirectories.has(current)) continue;
      const response = await this.fetcher(webDavUrl(this.rootUrl, current, true), {
        method: "MKCOL",
        credentials: "include",
      });
      if (!response.ok && response.status !== 405) {
        throw new Error(`Folder WebDAV ${current} gagal dibuat: ${await responseMessage(response)}`);
      }
      this.knownDirectories.add(current);
    }
  }

  async upload(path: string, file: Blob): Promise<void> {
    const separator = path.lastIndexOf("/");
    if (separator < 1) throw new Error(`Path tujuan WebDAV tidak valid: ${path}`);
    await this.ensureDirectory(path.slice(0, separator));
    const response = await this.fetcher(webDavUrl(this.rootUrl, path), {
      method: "PUT",
      credentials: "include",
      headers: { "If-None-Match": "*" },
      body: file,
    });
    if (response.status === 412) throw new Error(`File tujuan sudah ada: ${path}`);
    if (!response.ok) throw new Error(`Upload ${path} gagal: ${await responseMessage(response)}`);
  }
}
