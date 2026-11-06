import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

export interface OcrTimingTrace { id: string; startedAt: number }
const context = new AsyncLocalStorage<OcrTimingTrace>();
export const currentOcrTrace = () => context.getStore();
export const newOcrTrace = (): OcrTimingTrace => ({ id: randomUUID(), startedAt: performance.now() });
export const withOcrTrace = <T>(trace: OcrTimingTrace, work: () => T): T => context.run(trace, work);

// Only timing/correlation metadata: never filenames, OCR text, fields or errors.
export function logOcrTiming(stage: string, startedAt: number, outcome = "completed") {
  const trace = currentOcrTrace();
  if (!trace) return;
  const durationMs = Math.round(performance.now() - startedAt);
  console.info(`[OCR Pipeline] Stage: ${stage} — ${durationMs.toLocaleString("en-US")}ms`,
    { traceId: trace.id, outcome });
}
export function startOcrStage(stage: string) {
  const startedAt = performance.now();
  let finished = false;
  return (outcome?: string) => {
    if (finished) return;
    finished = true;
    logOcrTiming(stage, startedAt, outcome);
  };
}
export async function timeOcrStage<T>(stage: string, work: () => Promise<T>): Promise<T> {
  const finish = startOcrStage(stage);
  try { const value = await work(); finish(); return value; }
  catch (error) { finish("failed"); throw error; }
}
export function timeOcrParsing<T>(work: () => T): T {
  const finish = startOcrStage("Field Extraction/Parsing");
  try { const value = work(); finish(); return value; }
  catch (error) { finish("failed"); throw error; }
}
