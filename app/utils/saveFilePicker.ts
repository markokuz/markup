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

export async function writeBlobWithSaveFilePicker(
  blob: Blob,
  suggestedName: string,
  fileType?: PickerFileType,
): Promise<boolean> {
  const showSaveFilePicker = getSaveFilePicker();
  if (!showSaveFilePicker) {
    return false;
  }

  const handle = await showSaveFilePicker({
    suggestedName,
    types: [fileType ?? inferFileType(blob)],
  });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  return true;
}
