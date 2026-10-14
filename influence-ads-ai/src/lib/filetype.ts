/**
 * Detección de tipo por contenido (no por extensión) y dimensiones de imagen.
 * Módulo puro: se usa para validar que un archivo existe, se puede visualizar
 * y cumple los requisitos técnicos antes de usarlo en un anuncio.
 */
export type Detected = { mime: string; ext: string; kind: "image" | "video" | "document"; width?: number; height?: number };

export function detectFile(buf: Buffer): Detected | null {
  if (buf.length < 12) return null;
  // PNG
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: "image/png", ext: "png", kind: "image", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    const dims = jpegSize(buf);
    return { mime: "image/jpeg", ext: "jpg", kind: "image", ...dims };
  }
  // WebP
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return { mime: "image/webp", ext: "webp", kind: "image", ...webpSize(buf) };
  }
  // GIF
  if (buf.toString("ascii", 0, 3) === "GIF") {
    return { mime: "image/gif", ext: "gif", kind: "image", width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  // MP4 / MOV (ftyp)
  if (buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    return brand.startsWith("qt") ? { mime: "video/quicktime", ext: "mov", kind: "video" } : { mime: "video/mp4", ext: "mp4", kind: "video" };
  }
  // PDF
  if (buf.toString("ascii", 0, 5) === "%PDF-") return { mime: "application/pdf", ext: "pdf", kind: "document" };
  return null;
}

function jpegSize(buf: Buffer): { width?: number; height?: number } {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return {};
}

function webpSize(buf: Buffer): { width?: number; height?: number } {
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  if (chunk === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L") {
    const b = buf.readUInt32LE(21);
    return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
  }
  return {};
}

export const MAX_UPLOAD_BYTES = { image: 30 * 1024 * 1024, video: 500 * 1024 * 1024, document: 25 * 1024 * 1024 };
