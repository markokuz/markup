interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: {
    description?: string;
    accept: Record<string, string[]>;
  }[];
}

type WindowWithSaveFilePicker = Window & {
  showSaveFilePicker?: (
    options?: SaveFilePickerOptions,
  ) => Promise<FileSystemFileHandle>;
};

function getSaveFilePicker(): WindowWithSaveFilePicker["showSaveFilePicker"] {
  if (typeof window === "undefined") {
    return undefined;
  }
  return (window as WindowWithSaveFilePicker).showSaveFilePicker;
}

export function supportsSaveFilePicker(): boolean {
  return typeof getSaveFilePicker() === "function";
}

function inferFileType(blob: Blob): { description: string; accept: Record<string, string[]> } {
  if (blob.type === "application/pdf") {
    return { description: "PDF document", accept: { "application/pdf": [".pdf"] } };
  }
  if (blob.type === "application/json") {
    return {
      description: "Markup project",
      accept: { "application/json": [".mkup"] },
    };
  }
  return { description: "PNG image", accept: { "image/png": [".png"] } };
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Save through the browser's picker, or as a download where it has none. Returns the
 * chosen file's handle (null for a download), or null overall if the user cancelled.
 */
export async function saveBlobAs(
  blob: Blob,
  suggestedName: string,
): Promise<{ handle: FileSystemFileHandle | null } | null> {
  const showSaveFilePicker = getSaveFilePicker();
  if (!showSaveFilePicker) {
    downloadBlob(blob, suggestedName);
    return { handle: null };
  }

  try {
    const handle = await showSaveFilePicker({
      suggestedName,
      types: [inferFileType(blob)],
    });
    await writeBlobToHandle(handle, blob);
    return { handle };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    throw error;
  }
}

type PermissionedFileHandle = FileSystemFileHandle & {
  queryPermission?: (descriptor: { mode: "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: "readwrite" }) => Promise<PermissionState>;
};

/** The user declined Chrome's "allow this site to edit the file" prompt. */
export class SavePermissionError extends Error {
  constructor(readonly fileName: string) {
    super(`Permission to save "${fileName}" was denied.`);
    this.name = "SavePermissionError";
  }
}

/** Writing to the file itself failed, for example because another program has it locked. */
export class SaveWriteError extends Error {
  constructor(
    readonly fileName: string,
    readonly reason: unknown,
  ) {
    super(`Couldn't write "${fileName}".`);
    this.name = "SaveWriteError";
  }
}

/** Overwrite an existing file handle, asking for write access only if it isn't granted yet. */
export async function writeBlobToHandle(
  handle: FileSystemFileHandle,
  blob: Blob,
): Promise<void> {
  const permissioned = handle as PermissionedFileHandle;
  if (permissioned.queryPermission && permissioned.requestPermission) {
    const descriptor = { mode: "readwrite" } as const;
    let permission = await permissioned.queryPermission(descriptor);
    if (permission !== "granted") {
      permission = await permissioned.requestPermission(descriptor);
    }
    if (permission !== "granted") {
      throw new SavePermissionError(handle.name);
    }
  }

  try {
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    throw new SaveWriteError(handle.name, error);
  }
}
