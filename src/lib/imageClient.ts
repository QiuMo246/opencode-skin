export type PixelPayload = {
  width: number;
  height: number;
  pixelsB64: string;
  dataUrl: string;
};

const MAX_SIDE = 200;

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export async function sourceToBitmap(src: File | string): Promise<ImageBitmap> {
  if (typeof src === "string") {
    const res = await fetch(src);
    return createImageBitmap(await res.blob());
  }
  return createImageBitmap(src);
}

/** 壁纸用：压缩到最长边 ≤maxSide 的 dataURL（默认 JPEG 0.85）。 */
export async function compressToDataUrl(
  src: File | string,
  maxSide: number,
  type = "image/jpeg",
  quality = 0.85,
): Promise<string> {
  const bmp = await sourceToBitmap(src);
  try {
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 不可用");
    ctx.drawImage(bmp, 0, 0, w, h);
    return canvas.toDataURL(type, quality);
  } finally {
    bmp.close();
  }
}

/** 前端压缩到最长边 ≤200px，返回 RGBA 像素（base64）与预览 dataURL。 */
export async function compressAndExtract(src: File | string): Promise<PixelPayload> {
  const bmp = await sourceToBitmap(src);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("canvas 2d 上下文不可用");
    ctx.drawImage(bmp, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/png");
    const rgba = ctx.getImageData(0, 0, w, h).data;
    return { width: w, height: h, pixelsB64: bytesToBase64(new Uint8Array(rgba)), dataUrl };
  } finally {
    bmp.close();
  }
}
