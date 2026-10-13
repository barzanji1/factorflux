export function CompressionInfo({ originalSize, compressedSize }: {
  originalSize?: number | null; compressedSize?: number | null;
}) {
  if (originalSize == null || compressedSize == null || originalSize === compressedSize) return null;
  return <p className="text-[11px] text-slate-500" data-testid="document-compression-info">
    Compressed from {(originalSize / 1024 / 1024).toFixed(1)} MB → {(compressedSize / 1024 / 1024).toFixed(1)} MB
  </p>;
}
