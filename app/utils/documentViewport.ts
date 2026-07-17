export type DocumentType = "pdf" | "image";

export interface DocumentViewport {
  width: number;
  height: number;
  docHeight: number;
  convertToDocPoint(viewX: number, viewY: number): { x: number; y: number };
  convertToViewportPoint(docX: number, docY: number): { x: number; y: number };
}

export function createImageViewport(
  naturalWidth: number,
  naturalHeight: number,
  zoom: number,
): DocumentViewport {
  return {
    width: naturalWidth * zoom,
    height: naturalHeight * zoom,
    docHeight: naturalHeight,
    convertToDocPoint(viewX, viewY) {
      return { x: viewX / zoom, y: viewY / zoom };
    },
    convertToViewportPoint(docX, docY) {
      return { x: docX * zoom, y: docY * zoom };
    },
  };
}

export function createPdfViewport(
  width: number,
  height: number,
  docHeight: number,
  convertToPdfPoint: (x: number, y: number) => [number, number],
  convertToViewportPoint: (x: number, y: number) => [number, number],
): DocumentViewport {
  return {
    width,
    height,
    docHeight,
    convertToDocPoint(viewX, viewY) {
      const [x, y] = convertToPdfPoint(viewX, viewY);
      return { x, y };
    },
    convertToViewportPoint(docX, docY) {
      const [x, y] = convertToViewportPoint(docX, docY);
      return { x, y };
    },
  };
}
