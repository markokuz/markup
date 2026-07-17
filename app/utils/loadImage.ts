import UTIF from "utif";
import { isTiffFile } from "@/app/utils/fileTypes";

export interface ImageSource {
  width: number;
  height: number;
  draw(
    context: CanvasRenderingContext2D,
    destWidth: number,
    destHeight: number,
  ): void;
}

function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = url;
  });
}

function loadTiffImage(bytes: Uint8Array): ImageSource {
  const ifds = UTIF.decode(bytes);
  if (ifds.length === 0) {
    throw new Error("TIFF file contains no images");
  }

  const page = ifds[0];
  UTIF.decodeImage(bytes, page);
  const rgba = UTIF.toRGBA8(page);

  return {
    width: page.width,
    height: page.height,
    draw(context, destWidth, destHeight) {
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = page.width;
      tempCanvas.height = page.height;
      const tempContext = tempCanvas.getContext("2d");
      if (!tempContext) return;

      const imageData = tempContext.createImageData(page.width, page.height);
      imageData.data.set(rgba);
      tempContext.putImageData(imageData, 0, 0);
      context.drawImage(tempCanvas, 0, 0, destWidth, destHeight);
    },
  };
}

export async function loadImageSource(
  bytes: Uint8Array,
  fileName: string,
  mimeType = "",
): Promise<ImageSource> {
  if (isTiffFile(fileName, mimeType)) {
    return loadTiffImage(bytes);
  }

  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], {
    type: mimeType || undefined,
  });
  const url = URL.createObjectURL(blob);

  try {
    const img = await loadHtmlImage(url);
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      draw(context, destWidth, destHeight) {
        context.drawImage(img, 0, 0, destWidth, destHeight);
      },
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
