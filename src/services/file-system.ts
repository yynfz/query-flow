import type { DirectorySnapshot, FileManagementPlan, FileMoveOperation } from "./file-management";

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

export interface FileExecutionFailure {
  operation: FileMoveOperation;
  message: string;
}

export interface FileExecutionResult {
  completed: number;
  failures: FileExecutionFailure[];
}

function pathParts(path: string): string[] {
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) throw new Error(`Path tidak aman: ${path}`);
  return parts;
}

async function getDirectory(root: FileSystemDirectoryHandle, path: string, create: boolean): Promise<FileSystemDirectoryHandle> {
  let current = root;
  for (const part of pathParts(path)) current = await current.getDirectoryHandle(part, { create });
  return current;
}

async function getSource(root: FileSystemDirectoryHandle, path: string): Promise<{ parent: FileSystemDirectoryHandle; handle: FileSystemFileHandle }> {
  const parts = pathParts(path);
  const name = parts.pop();
  if (!name) throw new Error(`Path sumber tidak valid: ${path}`);
  const parent = parts.length > 0 ? await getDirectory(root, parts.join("/"), false) : root;
  return { parent, handle: await parent.getFileHandle(name) };
}

async function entryExists(directory: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await directory.getFileHandle(name);
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return false;
    throw error;
  }
}

export async function scanDirectory(root: FileSystemDirectoryHandle): Promise<DirectorySnapshot> {
  const directories: string[] = [];
  const files: string[] = [];

  async function visit(directory: FileSystemDirectoryHandle, prefix: string): Promise<void> {
    for await (const [name, handle] of (directory as IterableDirectoryHandle).entries()) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === "directory") {
        directories.push(path);
        await visit(handle as FileSystemDirectoryHandle, path);
      } else {
        files.push(path);
      }
    }
  }

  await visit(root, "");
  directories.sort((a, b) => a.localeCompare(b));
  files.sort((a, b) => a.localeCompare(b));
  return { directories, files };
}

export async function executeFileManagementPlan(
  root: FileSystemDirectoryHandle,
  plan: FileManagementPlan,
  onProgress?: (completed: number, total: number, operation?: FileMoveOperation) => void,
): Promise<FileExecutionResult> {
  for (const path of plan.dateDirectories) await getDirectory(root, path, true);

  let completed = 0;
  const failures: FileExecutionFailure[] = [];
  onProgress?.(0, plan.operations.length);

  for (const operation of plan.operations) {
    let destination: FileSystemDirectoryHandle | undefined;
    let destinationCreated = false;
    let sourceRemoved = false;
    try {
      const source = await getSource(root, operation.sourcePath);
      destination = await getDirectory(root, operation.destinationDirectory, true);
      if (await entryExists(destination, operation.destinationName)) {
        throw new Error("Tujuan sudah ada sejak preview; pindai ulang agar nama aman dihitung kembali.");
      }

      const sourceFile = await source.handle.getFile();
      const destinationHandle = await destination.getFileHandle(operation.destinationName, { create: true });
      destinationCreated = true;
      const writable = await destinationHandle.createWritable({ keepExistingData: false });
      await writable.write(sourceFile);
      await writable.close();

      const copiedFile = await destinationHandle.getFile();
      if (copiedFile.size !== sourceFile.size) throw new Error("Ukuran hasil salinan berbeda; sumber tidak dihapus.");
      await source.parent.removeEntry(source.handle.name);
      sourceRemoved = true;
      completed += 1;
      try {
        onProgress?.(completed, plan.operations.length, operation);
      } catch {
        // UI progress callbacks must never turn a completed move into a failure.
      }
    } catch (error) {
      if (destination && destinationCreated && !sourceRemoved) {
        await destination.removeEntry(operation.destinationName).catch(() => undefined);
      }
      failures.push({ operation, message: error instanceof Error ? error.message : "Pemindahan gagal." });
    }
  }
  return { completed, failures };
}

