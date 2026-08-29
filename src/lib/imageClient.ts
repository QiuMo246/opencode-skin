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

/** 视频壁纸首帧： posters ≤720px JPEG（随配置持久化，服务器下线时作降级画面）+ 取色像素 ≤200px。 */
export async function videoPosterAndPixels(
  src: File | string,
): Promise<{ poster: string; pixels: PixelPayload }> {
  const blobUrl = typeof src === "string" ? null : URL.createObjectURL(src);
  const v = document.createElement("video");
  v.muted = true;
  v.preload = "auto";
  v.src = typeof src === "string" ? src : blobUrl!;
  const cleanup = () => {
    v.removeAttribute("src");
    v.load();
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  };
  try {
    await new Promise<void>((resolve, reject) => {
      v.onloadeddata = () => resolve();
      v.onerror = () => reject(new Error("视频无法解码（仅支持 mp4 / webm）"));
      v.load();
    });
    /* 首帧可能是纯黑转场：跳到开头附近再取；个别源 seek 失败时超时兜底用第一帧 */
    if (Number.isFinite(v.duration) && v.duration > 0.25) {
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        v.onseeked = done;
        v.currentTime = Math.min(0.1, v.duration / 2);
        setTimeout(done, 2000);
      });
    }
    const draw = (maxSide: number) => {
      const scale = Math.min(1, maxSide / Math.max(v.videoWidth, v.videoHeight));
      const w = Math.max(1, Math.round(v.videoWidth * scale));
      const h = Math.max(1, Math.round(v.videoHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: maxSide <= 200 });
      if (!ctx) throw new Error("canvas 2d 上下文不可用");
      ctx.drawImage(v, 0, 0, w, h);
      return { canvas, ctx, w, h };
    };
    const poster = draw(720);
    const px = draw(200);
    const rgba = px.ctx.getImageData(0, 0, px.w, px.h).data;
    return {
      poster: poster.canvas.toDataURL("image/jpeg", 0.8),
      pixels: { width: px.w, height: px.h, pixelsB64: bytesToBase64(new Uint8Array(rgba)), dataUrl: "" },
    };
  } finally {
    cleanup();
  }
}
