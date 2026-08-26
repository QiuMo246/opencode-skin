/** 解析 data:image/...;base64 dataURL（terminal 与 desktop 共用）。 */
export function decodeDataUrl(dataUrl: string): { buf: Buffer; ext: string } {
  const m = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/s.exec(dataUrl.trim());
  if (!m) throw new Error("仅支持 dataURL 图片（png/jpeg/webp）");
  return { buf: Buffer.from(m[2], "base64"), ext: m[1] === "jpeg" ? "jpg" : m[1] };
}
