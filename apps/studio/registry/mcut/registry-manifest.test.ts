import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Guards registry.json against drift: every file a registry item's code
 * reaches through imports must ship with that item, and every npm package
 * it imports must be declared, or `shadcn add` installs broken code.
 */

const studioRoot = path.resolve(import.meta.dir, "..", "..");

interface RegistryFile {
  path: string;
  type: string;
  target?: string;
}

interface RegistryItem {
  name: string;
  files: RegistryFile[];
  dependencies?: string[];
  registryDependencies?: string[];
}

const registry = JSON.parse(
  readFileSync(path.join(studioRoot, "registry.json"), "utf8"),
) as { items: RegistryItem[] };

const IMPORT_RE = /(?:from|import)\s+["']([^"']+)["']/g;

/** Packages every Next.js consumer app has without declaring. */
const FRAMEWORK_PACKAGES = new Set(["react", "react-dom", "next"]);

function resolveRelative(fromFile: string, spec: string): string | undefined {
  const base = path.normalize(path.join(path.dirname(fromFile), spec));
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    base,
    path.join(base, "index.tsx"),
    path.join(base, "index.ts"),
  ]) {
    const absolute = path.join(studioRoot, candidate);
    if (existsSync(absolute) && statSync(absolute).isFile()) return candidate;
  }
  return undefined;
}

function packageName(spec: string): string {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

/** Strip a version pin like `unicode-animations@1.0.3`. */
function dependencyName(dep: string): string {
  if (dep.startsWith("@")) return `@${dep.slice(1).split("@")[0]}`;
  return dep.split("@")[0]!;
}

interface Closure {
  files: Set<string>;
  uiImports: Set<string>;
  packages: Set<string>;
}

/**
 * Walk the transitive import closure of the item's listed files. Stops at
 * `components/ui/*` and `lib/utils.ts`: those are installed via shadcn
 * registryDependencies, so their own imports are the upstream item's
 * responsibility.
 */
function collectClosure(startFiles: string[]): Closure {
  const files = new Set<string>();
  const uiImports = new Set<string>();
  const packages = new Set<string>();
  const stack = [...startFiles];

  while (stack.length > 0) {
    const file = stack.pop()!;
    if (files.has(file) || file.includes(".test.")) continue;
    files.add(file);
    if (file.startsWith("components/ui/") || file === "lib/utils.ts") continue;

    const source = readFileSync(path.join(studioRoot, file), "utf8");
    for (const match of source.matchAll(IMPORT_RE)) {
      const spec = match[1]!;
      let resolved: string | undefined;
      if (spec.startsWith(".")) {
        resolved = resolveRelative(file, spec);
      } else if (spec.startsWith("@/")) {
        resolved = resolveRelative("x", spec.slice(2));
      } else {
        packages.add(packageName(spec));
        continue;
      }
      if (!resolved) continue;
      if (resolved.startsWith("components/ui/")) {
        uiImports.add(path.basename(resolved).replace(/\.tsx?$/, ""));
      }
      if (!files.has(resolved)) stack.push(resolved);
    }
  }

  return { files, uiImports, packages };
}

describe("registry.json manifest", () => {
  test("item names are unique", () => {
    const names = registry.items.map((item) => item.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("every listed file exists on disk", () => {
    const missing = registry.items.flatMap((item) =>
      item.files
        .filter((file) => !existsSync(path.join(studioRoot, file.path)))
        .map((file) => `${item.name}: ${file.path}`),
    );
    expect(missing).toEqual([]);
  });

  for (const item of registry.items) {
    describe(item.name, () => {
      const listed = new Set(item.files.map((file) => file.path));
      const closure = collectClosure([...listed]);

      test("lists every file its imports reach", () => {
        const unlisted = [...closure.files]
          .filter(
            (file) =>
              !listed.has(file) &&
              file !== "lib/utils.ts" &&
              !file.startsWith("components/ui/"),
          )
          .sort();
        expect(unlisted).toEqual([]);
      });

      test("declares every ui component it imports as a registryDependency", () => {
        const registryDeps = new Set(item.registryDependencies ?? []);
        const undeclared = [...closure.uiImports]
          .filter((name) => !registryDeps.has(name))
          .sort();
        expect(undeclared).toEqual([]);
      });

      test("declares every npm package it imports", () => {
        const declared = new Set(
          (item.dependencies ?? []).map((dep) => dependencyName(dep)),
        );
        const undeclared = [...closure.packages]
          .filter((pkg) => !declared.has(pkg) && !FRAMEWORK_PACKAGES.has(pkg))
          .sort();
        expect(undeclared).toEqual([]);
      });
    });
  }
});
