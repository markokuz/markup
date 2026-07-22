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

export async function writeBlobWithSaveFilePicker(
  blob: Blob,
  suggestedName: string,
): Promise<boolean> {
  const showSaveFilePicker = getSaveFilePicker();
  if (!showSaveFilePicker) {
    return false;
  }

  const isPdf = blob.type === "application/pdf";
  const handle = await showSaveFilePicker({
    suggestedName,
    types: [
      {
        description: isPdf ? "PDF document" : "PNG image",
        accept: isPdf
          ? { "application/pdf": [".pdf"] }
          : { "image/png": [".png"] },
      },
    ],
  });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
  return true;
}
