import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

// Resolve duplicate Radix helpers to the newest installed compatible copy.
// Unlike blindly forcing the hoisted copy, this never downgrades a helper or
// combines different major versions. No package versions are changed.
export function deduplicateUiAliases(): Record<string, string> {
  const root = createRequire(import.meta.url);
  const manifest = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));
  const consumers = Object.keys(manifest.dependencies).filter(name => name.startsWith("@radix-ui/"));
  const resolvers = [root, ...consumers.map(name => createRequire(root.resolve(name)))];
  const names = ["react-dialog", "react-dismissable-layer", "react-focus-scope", "react-presence",
    "react-slot", "react-use-controllable-state", "react-primitive", "react-portal"];
  const aliases: Record<string, string> = {};
  for (const short of names) {
    const name = `@radix-ui/${short}`;
    const copies = new Map<string, { version: number[]; root: string }>();
    for (const resolver of resolvers) {
      try {
        let directory = path.dirname(resolver.resolve(name));
        while (!fs.existsSync(path.join(directory, "package.json"))) {
          const parent = path.dirname(directory);
          if (parent === directory) throw new Error("Package manifest not found");
          directory = parent;
        }
        const metadata = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
        if (metadata.name !== name || !/^\d+\.\d+\.\d+$/.test(metadata.version)) continue;
        copies.set(directory, { version: metadata.version.split(".").map(Number), root: directory });
      } catch (error: any) {
        if (error.code !== "MODULE_NOT_FOUND") throw error;
      }
    }
    const candidates = [...copies.values()];
    if (candidates.length < 2 || new Set(candidates.map(copy => copy.version[0])).size > 1) continue;
    candidates.sort((a, b) => b.version[0] - a.version[0] || b.version[1] - a.version[1] || b.version[2] - a.version[2]);
    aliases[name] = candidates[0].root;
  }
  return aliases;
}
