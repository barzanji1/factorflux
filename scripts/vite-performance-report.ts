import fs from "node:fs";
import path from "node:path";
import { gzipSync, brotliCompressSync } from "node:zlib";
import type { Plugin } from "vite";

/** Opt-in local build evidence; never emitted into the public asset directory. */
export function performanceReport(): Plugin {
  return {
    name: "local-performance-report",
    writeBundle(options, bundle) {
      const destination = process.env.PERFORMANCE_REPORT;
      if (!destination) return;
      const files = Object.values(bundle).map(file => {
        const bytes = fs.readFileSync(path.join(options.dir!, file.fileName));
        return {
          file: file.fileName,
          bytes: bytes.length,
          gzip: gzipSync(bytes).length,
          brotli: brotliCompressSync(bytes).length,
          entry: file.type === "chunk" && file.isEntry,
          imports: file.type === "chunk" ? file.imports : [],
          dynamicImports: file.type === "chunk" ? file.dynamicImports : [],
        };
      });
      const initial = new Set<string>();
      const visit = (name: string) => {
        if (initial.has(name)) return;
        initial.add(name);
        files.find(file => file.file === name)?.imports.forEach(visit);
      };
      files.filter(file => file.entry).forEach(file => visit(file.file));
      const totals = (filter: (file: typeof files[number]) => boolean) =>
        files.filter(filter).reduce((sum, file) => ({
          bytes: sum.bytes + file.bytes, gzip: sum.gzip + file.gzip, brotli: sum.brotli + file.brotli,
        }), { bytes: 0, gzip: 0, brotli: 0 });
      const packages = new Map<string, number>();
      const modules: Array<{ id: string; renderedBytes: number; chunk: string }> = [];
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;
        for (const [id, module] of Object.entries(chunk.modules)) {
          modules.push({ id: id.replace(`${process.cwd()}/`, ""), renderedBytes: module.renderedLength, chunk: chunk.fileName });
          const match = [...id.matchAll(/node_modules\/((?:@[^/]+\/)?[^/]+)/g)].at(-1);
          if (match) packages.set(match[1], (packages.get(match[1]) ?? 0) + module.renderedLength);
        }
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, JSON.stringify({
        measuredAt: new Date().toISOString(),
        initialJavaScript: totals(file => initial.has(file.file) && file.file.endsWith(".js")),
        totalJavaScript: totals(file => file.file.endsWith(".js")),
        totalCss: totals(file => file.file.endsWith(".css")),
        files,
        largestPackages: [...packages].sort((a, b) => b[1] - a[1]),
        modules: modules.sort((a, b) => b.renderedBytes - a.renderedBytes),
      }, null, 2));
    },
  };
}
