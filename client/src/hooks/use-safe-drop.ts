/**
 * useSafeDrop
 * ─────────────────────────────────────────────────────────────────────────
 * Robust drag-and-drop hook that fixes three common browser pitfalls:
 *
 * 1. Browser file-open takeover — A global window-level handler prevents
 *    the browser from opening/previewing files that are dropped anywhere
 *    on the page, even outside the drop zone.
 *
 * 2. dragLeave flickering on child elements — dragleave fires whenever the
 *    cursor moves from the container to a child element inside it. A ref
 *    counter increments on dragenter and decrements on dragleave; the zone
 *    is only deactivated when the counter hits zero (cursor truly left).
 *
 * 3. Missed drop events — stopPropagation on all events prevents parent
 *    elements from intercepting and swallowing the drop.
 *
 * Usage:
 *   const { dropProps, isDragOver } = useSafeDrop({ onFiles });
 *   <div {...dropProps} className={isDragOver ? "active" : ""}>...</div>
 */

import { useRef, useState, useCallback, useEffect } from "react";

export interface SafeDropOptions {
  /** Called with the raw FileList items after validation; never throws */
  onFiles: (files: File[]) => void;
  /** MIME types to accept — others are silently filtered (optional) */
  accept?: string[];
  /** Whether the hook is active (default: true) */
  enabled?: boolean;
}

export interface SafeDropResult {
  /** Spread these props onto the drop-zone element */
  dropProps: {
    onDragEnter: (e: React.DragEvent) => void;
    onDragOver:  (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop:      (e: React.DragEvent) => void;
  };
  /** True when a valid drag is over the zone */
  isDragOver: boolean;
  /** True when files being dragged contain at least one accepted type */
  isValidDrag: boolean;
}

export function useSafeDrop({
  onFiles,
  accept,
  enabled = true,
}: SafeDropOptions): SafeDropResult {
  const [isDragOver,  setIsDragOver]  = useState(false);
  const [isValidDrag, setIsValidDrag] = useState(false);

  // Counter tracks how many dragenter events have fired without a matching
  // dragleave — ensures we only deactivate when the cursor truly leaves the zone.
  const enterCounter = useRef(0);

  // ── Global window-level blocker ──────────────────────────────────────────
  // Prevents the browser from opening/previewing files dropped outside the zone.
  useEffect(() => {
    if (!enabled) return;

    const prevent = (e: DragEvent) => {
      // Only block file drags — don't break text/link drag-and-drop elsewhere
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "drop") {
          // Files dropped outside our zone — do nothing, just block the browser
          e.dataTransfer.effectAllowed = "none";
          e.dataTransfer.dropEffect    = "none";
        }
      }
    };

    window.addEventListener("dragover", prevent);
    window.addEventListener("drop",     prevent);

    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop",     prevent);
    };
  }, [enabled]);

  // ── Check if dragged items include accepted types ────────────────────────
  const checkValidity = useCallback(
    (e: React.DragEvent): boolean => {
      if (!accept || accept.length === 0) return true;
      const types = Array.from(e.dataTransfer.items ?? []).map((i) => i.type);
      return types.some((t) => accept.includes(t));
    },
    [accept],
  );

  // ── Handlers ─────────────────────────────────────────────────────────────

  const onDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      enterCounter.current += 1;
      if (enterCounter.current === 1) {
        setIsDragOver(true);
        setIsValidDrag(checkValidity(e));
      }
    },
    [checkValidity],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Ensure browser shows the correct cursor
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    enterCounter.current -= 1;
    if (enterCounter.current <= 0) {
      enterCounter.current = 0;
      setIsDragOver(false);
      setIsValidDrag(false);
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      enterCounter.current = 0;
      setIsDragOver(false);
      setIsValidDrag(false);

      const rawFiles = Array.from(e.dataTransfer.files);
      if (rawFiles.length === 0) return;

      const filtered = accept
        ? rawFiles.filter((f) => accept.includes(f.type))
        : rawFiles;

      onFiles(filtered);
    },
    [accept, onFiles],
  );

  return {
    dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
    isDragOver,
    isValidDrag,
  };
}
