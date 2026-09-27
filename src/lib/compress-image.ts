const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.72;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

/** Client-side stand-in for native Kotlin compression before vision upload. */
export async function compressImage(file: File): Promise<{ dataUrl: string; width: number; height: number; bytes: number }> {
  const raw = URL.createObjectURL(file);
  try {
    const img = await loadImage(raw);
    const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.drawImage(img, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    const bytes = Math.round((dataUrl.length * 3) / 4);
    return { dataUrl, width, height, bytes };
  } finally {
    URL.revokeObjectURL(raw);
  }
}

/** Plain FileReader fallback — works even when canvas/decoding fails (HEIC etc.). */
export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(file);
  });
}

/**
 * Lightweight "OCR": prefer embedded text from the file name / alt, then
 * attempt to read EXIF-less plain-text sidecar. Real ML Kit lives on Android;
 * here we extract any text the user pasted alongside, and for images we
 * return empty so the vision model does the reading.
 */
export function extractPlainText(file: File, dataUrl?: string): string | undefined {
  if (file.type.startsWith("text/") || /\.(md|txt|csv|json|ts|tsx|js|py|kt|java|go|rs|css|html|xml)$/i.test(file.name)) {
    return undefined; // caller reads as text
  }
  if (dataUrl?.startsWith("data:text")) {
    try {
      return decodeURIComponent(escape(atob(dataUrl.split(",")[1] ?? "")));
    } catch {
      return undefined;
    }
  }
  return undefined;
}
