export interface DirectorySnapshot {
  directories: string[];
  files: string[];
}

export interface FileMoveOperation {
  sourcePath: string;
  destinationDirectory: string;
  destinationName: string;
  code: string;
  renamed: boolean;
}

export interface FileManagementIssue {
  path: string;
  reason: "no-code" | "province-not-found" | "regency-not-found";
  message: string;
}

export interface FileManagementPlan {
  date: string;
  dateDirectories: string[];
  operations: FileMoveOperation[];
  issues: FileManagementIssue[];
  partialFiles: string[];
}

const RANTAB_SUFFIXES = [
  "query_jumlah_remark",
  "rantab_DBNAS_jumlah_per_flag",
  "rantab_DBNAS_semua_kategori",
] as const;

function parentPath(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "" : path.slice(0, separator);
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function reserveUniqueName(name: string, reserved: Set<string>): string {
  const extensionIndex = name.toLowerCase().lastIndexOf(".xlsx");
  const stem = extensionIndex >= 0 ? name.slice(0, extensionIndex) : name;
  const extension = extensionIndex >= 0 ? name.slice(extensionIndex) : "";
  let candidate = name;
  let index = 2;
  while (reserved.has(candidate.toLocaleLowerCase("en-US"))) {
    candidate = `${stem}_${index}${extension}`;
    index += 1;
  }
  reserved.add(candidate.toLocaleLowerCase("en-US"));
  return candidate;
}

function rantabName(path: string, originalName: string, code: string): string {
  if (!originalName.toLowerCase().startsWith("rantabdbnas_")) return originalName;
  const sourceFolder = parentPath(path).toLowerCase();
  const suffix = RANTAB_SUFFIXES.find((candidate) => sourceFolder.includes(candidate.toLowerCase()));
  if (!suffix) return originalName;
  const stem = originalName.replace(/\.xlsx$/i, "");
  if (stem.toLowerCase().endsWith(`_${suffix.toLowerCase()}`)) return originalName;
  const prefix = new RegExp(`^RantabDBNAS_${code}_`, "i");
  if (!prefix.test(stem)) return originalName;
  const randomId = stem.replace(prefix, "");
  return `RantabDBNAS_${code}_${randomId}_${suffix}.xlsx`;
}

export function isValidManagementDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === (month ?? 0) - 1 && parsed.getUTCDate() === day;
}

export function buildFileManagementPlan(snapshot: DirectorySnapshot, date: string): FileManagementPlan {
  if (!isValidManagementDate(date)) throw new Error("Tanggal harus valid dengan format YYYY-MM-DD.");

  const directorySet = new Set(snapshot.directories);
  const provinces = snapshot.directories.filter((path) => !path.includes("/") && /^\d{2}\s*-\s*.+/.test(path));
  const provinceByCode = new Map(provinces.map((path) => [path.slice(0, 2), path]));
  const regencyByCode = new Map<string, string>();
  for (const path of snapshot.directories) {
    const segments = path.split("/");
    if (segments.length !== 2 || !provinces.includes(segments[0] ?? "")) continue;
    const match = /^(\d{4})\s*-\s*.+/.exec(segments[1] ?? "");
    if (match?.[1]) regencyByCode.set(match[1], path);
  }

  const dateDirectories = [...regencyByCode.values()].map((path) => `${path}/${date}`).sort();
  const reservedByDirectory = new Map<string, Set<string>>();
  for (const filePath of snapshot.files) {
    const directory = parentPath(filePath);
    const reserved = reservedByDirectory.get(directory) ?? new Set<string>();
    reserved.add(baseName(filePath).toLocaleLowerCase("en-US"));
    reservedByDirectory.set(directory, reserved);
  }

  const operations: FileMoveOperation[] = [];
  const issues: FileManagementIssue[] = [];
  const sourcePrefix = `${date}/`;
  const sourceFiles = snapshot.files
    .filter((path) => path.startsWith(sourcePrefix) && /\.xlsx$/i.test(path))
    .sort((a, b) => a.localeCompare(b));

  for (const sourcePath of sourceFiles) {
    const name = baseName(sourcePath);
    const code = /_(\d{4})_/.exec(name)?.[1];
    if (!code) {
      issues.push({ path: sourcePath, reason: "no-code", message: "Kode kabupaten/kota 4 digit tidak ditemukan." });
      continue;
    }
    const province = provinceByCode.get(code.slice(0, 2));
    if (!province) {
      issues.push({ path: sourcePath, reason: "province-not-found", message: `Folder provinsi ${code.slice(0, 2)} tidak ditemukan.` });
      continue;
    }
    const regency = regencyByCode.get(code);
    if (!regency || !regency.startsWith(`${province}/`)) {
      issues.push({ path: sourcePath, reason: "regency-not-found", message: `Folder kabupaten/kota ${code} tidak ditemukan.` });
      continue;
    }
    const plannedName = rantabName(sourcePath, name, code);
    const destinationDirectory = `${regency}/${date}`;
    const reserved = reservedByDirectory.get(destinationDirectory) ?? new Set<string>();
    const destinationName = reserveUniqueName(plannedName, reserved);
    reservedByDirectory.set(destinationDirectory, reserved);
    operations.push({
      sourcePath,
      destinationDirectory,
      destinationName,
      code,
      renamed: destinationName !== name,
    });
  }

  return {
    date,
    dateDirectories: dateDirectories.filter((path) => !directorySet.has(path)),
    operations,
    issues,
    partialFiles: snapshot.files.filter((path) => /_partial.*\.xlsx$/i.test(baseName(path))).sort(),
  };
}

