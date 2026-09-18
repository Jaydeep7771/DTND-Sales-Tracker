// Client-side image compression. Runs in a Web Worker so the UI stays responsive.
// Targets ~200 KB / 1200 px, which is plenty for a catalog thumbnail + detail view.
import imageCompression from "browser-image-compression";

export const IMAGE_MAX_SIZE_MB = 0.2;
export const IMAGE_MAX_DIMENSION_PX = 1200;
export const IMAGE_ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function compressImage(file: File): Promise<File> {
  if (!IMAGE_ACCEPTED_TYPES.includes(file.type)) {
    throw new Error("Only JPEG, PNG, or WebP images are allowed.");
  }

  return imageCompression(file, {
    maxSizeMB: IMAGE_MAX_SIZE_MB,
    maxWidthOrHeight: IMAGE_MAX_DIMENSION_PX,
    useWebWorker: true,
    fileType: "image/webp", // WebP is ~30% smaller than JPEG at equal quality
    initialQuality: 0.8,
  });
}

/** Human-readable byte count for the UI, e.g. "1.4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
