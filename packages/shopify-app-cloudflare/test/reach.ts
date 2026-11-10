/**
 * What a package entry loads: the bare specifiers its static imports and re-exports reach.
 *
 * @module
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

/** The package's own import maps, as `package.json` declares them. */
const IMPORT_MAPS: readonly (readonly [string, string])[] = [
  ["#internal/", "internal"],
  ["#test/", "test"],
];

/**
 * The bare specifiers `entry` (a path under `src/`) reaches through its static imports and
 * re-exports, following the package's own `./` modules and its import maps.
 */
export const reachedPackages = (entry: string) => {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    // `from "x"` or a bare `import "x"`: a string before `from` ends the match, so an exported
    // string constant is not read as a specifier.
    for (const match of source.matchAll(
      /^\s*(?:import|export)\b[^;"']*?\bfrom\s*["'](?<named>[^"']+)["']|^\s*import\s*["'](?<bare>[^"']+)["']/gmu,
    )) {
      const specifier = match.groups?.named ?? match.groups?.bare;
      if (specifier === undefined) continue;
      const mapped = IMPORT_MAPS.find(([prefix]) => specifier.startsWith(prefix));
      if (mapped !== undefined) visit(path.join(SRC, mapped[1], specifier.slice(mapped[0].length)));
      else if (specifier.startsWith(".")) visit(path.resolve(path.dirname(file), specifier));
      else packages.add(specifier);
    }
  };
  visit(path.join(SRC, entry));
  return [...packages];
};
