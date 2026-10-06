import type { DocumentRotation } from "@/app/types";

export type DocumentType = "pdf" | "image";

export interface DocumentViewport {
  width: number;
  height: number;
  docHeight: number;
  convertToDocPoint(viewX: number, viewY: number): { x: number; y: number };
  convertToViewportPoint(docX: number, docY: number): { x: number; y: number };
}

function docPointFromViewUnzoomed(
  viewX: number,
  viewY: number,
  zoom: number,
  naturalWidth: number,
  naturalHeight: number,
  rotation: DocumentRotation,
): { x: number; y: number } {
  const x = viewX / zoom;
  const y = viewY / zoom;

  switch (rotation) {
    case 0:
      return { x, y };
    case 90:
      return { x: y, y: naturalHeight - x };
    case 180:
      return { x: naturalWidth - x, y: naturalHeight - y };
    case 270:
      return { x: naturalWidth - y, y: x };
  }
}

function viewPointFromDocUnzoomed(
  docX: number,
  docY: number,
  zoom: number,
  naturalWidth: number,
  naturalHeight: number,
  rotation: DocumentRotation,
): { x: number; y: number } {
  let viewX: number;
  let viewY: number;

  switch (rotation) {
    case 0:
      viewX = docX;
      viewY = docY;
      break;
    // Must mirror the canvas draw in useDocument (rotate about the centre):
    // a 90°/270° view is naturalHeight wide and naturalWidth tall.
    case 90:
      viewX = naturalHeight - docY;
      viewY = docX;
      break;
    case 180:
      viewX = naturalWidth - docX;
      viewY = naturalHeight - docY;
      break;
    case 270:
      viewX = docY;
      viewY = naturalWidth - docX;
      break;
  }

  return { x: viewX * zoom, y: viewY * zoom };
}

export function createImageViewport(
  naturalWidth: number,
  naturalHeight: number,
  zoom: number,
  rotation: DocumentRotation = 0,
): DocumentViewport {
  const swapped = rotation === 90 || rotation === 270;

  return {
    width: (swapped ? naturalHeight : naturalWidth) * zoom,
    height: (swapped ? naturalWidth : naturalHeight) * zoom,
    docHeight: naturalHeight,
    convertToDocPoint(viewX, viewY) {
      return docPointFromViewUnzoomed(
        viewX,
        viewY,
        zoom,
        naturalWidth,
        naturalHeight,
        rotation,
      );
    },
    convertToViewportPoint(docX, docY) {
      return viewPointFromDocUnzoomed(
        docX,
        docY,
        zoom,
        naturalWidth,
        naturalHeight,
        rotation,
      );
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
