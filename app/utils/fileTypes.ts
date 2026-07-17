import type { DocumentType } from "@/app/types";

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"];

export function detectDocumentType(file: File): DocumentType | null {
  const name = file.name.toLowerCase();

  if (file.type === "application/pdf" || name.endsWith(".pdf")) {
    return "pdf";
  }

  if (
    file.type.startsWith("image/") ||
    IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext))
  ) {
    return "image";
  }

  return null;
}

export const ACCEPTED_FILE_TYPES =
  "application/pdf,image/*,.tif,.tiff,.png,.jpg,.jpeg,.webp,.gif,.bmp";

export function isTiffFile(fileName: string, mimeType = ""): boolean {
  const name = fileName.toLowerCase();
  return (
    mimeType === "image/tiff" ||
    mimeType === "image/tif" ||
    name.endsWith(".tif") ||
    name.endsWith(".tiff")
  );
}
