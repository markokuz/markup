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

export interface PickerFileType {
  description: string;
  accept: Record<string, string[]>;
}

function inferFileType(blob: Blob): PickerFileType {
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

/** Shows the save picker and writes the blob; returns the chosen handle (null if unsupported). */
export async function writeBlobWithSaveFilePicker(
  blob: Blob,
  suggestedName: string,
  fileType?: PickerFileType,
): Promise<FileSystemFileHandle | null> {
  const showSaveFilePicker = getSaveFilePicker();
  if (!showSaveFilePicker) {
    return null;
  }

  const handle = await showSaveFilePicker({
    suggestedName,
    types: [fileType ?? inferFileType(blob)],
  });
  await writeBlobToHandle(handle, blob);
  return handle;
}

type PermissionedFileHandle = FileSystemFileHandle & {
  queryPermission?: (descriptor: { mode: "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: "readwrite" }) => Promise<PermissionState>;
};

/** Overwrite an existing file handle, asking for write access if needed. */
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
      throw new Error(`Permission to save "${handle.name}" was denied.`);
    }
  }

  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
}
