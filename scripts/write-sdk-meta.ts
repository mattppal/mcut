import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const sdkRoot = path.join(process.cwd(), "apps/web/content/docs/sdk");
const referenceRoot = path.join(sdkRoot, "reference");

const packageLabels: Record<string, string> = {
  timeline: "@mcut/timeline",
  editor: "@mcut/editor",
  compositor: "@mcut/compositor",
  media: "@mcut/media",
  react: "@mcut/react",
  transcription: "@mcut/transcription",
  "transcription-ai-sdk": "@mcut/transcription-ai-sdk",
  "transcription-assemblyai": "@mcut/transcription-assemblyai",
  "transcription-local": "@mcut/transcription-local",
};

const packageOrder = Object.keys(packageLabels);

async function existingPackageDirs() {
  const entries = await readdir(referenceRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && packageLabels[entry.name])
    .map((entry) => entry.name)
    .sort((a, b) => packageOrder.indexOf(a) - packageOrder.indexOf(b));
}

async function existingChildDirs(dir: string) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

async function walkFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return walkFiles(fullPath);
      return entry.isFile() ? [fullPath] : [];
    }),
  );
  return files.flat();
}

function titleFromMarkdown(markdown: string, filePath: string) {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) {
    return heading
      .replace(/^(Class|Function|Interface|Type Alias|Variable):\s+/, "")
      .replace(/\(\)$/, "")
      .replace(/`/g, "");
  }
  return path.basename(filePath, ".mdx");
}

async function ensureGeneratedTitles() {
  const files = (await walkFiles(referenceRoot)).filter((file) => file.endsWith(".mdx"));

  for (const file of files) {
    const markdown = await readFile(file, "utf8");
    if (!markdown.startsWith("---\n")) continue;

    const frontmatterEnd = markdown.indexOf("\n---", 4);
    if (frontmatterEnd === -1) continue;

    const frontmatter = markdown.slice(4, frontmatterEnd);
    if (/^title:/m.test(frontmatter)) continue;

    const title = titleFromMarkdown(markdown.slice(frontmatterEnd + 4), file);
    const next = `---\ntitle: ${JSON.stringify(title)}\n${frontmatter}\n---${markdown.slice(frontmatterEnd + 4)}`;
    await writeFile(file, next);
  }
}

const packageDirs = await existingPackageDirs();

await ensureGeneratedTitles();

await writeFile(
  path.join(sdkRoot, "meta.json"),
  `${JSON.stringify(
    {
      title: "SDK Reference",
      description: "Generated TypeScript API reference.",
      root: true,
      defaultOpen: false,
      pages: ["index", "...reference"],
    },
    null,
    2,
  )}\n`,
);

await writeFile(
  path.join(referenceRoot, "meta.json"),
  `${JSON.stringify(
    {
      title: "Generated API",
      defaultOpen: false,
      pages: ["index", ...packageDirs],
    },
    null,
    2,
  )}\n`,
);

for (const dir of packageDirs) {
  const packageRoot = path.join(referenceRoot, dir);
  const srcRoot = path.join(packageRoot, "src");
  const symbolGroups = await existingChildDirs(srcRoot);

  await writeFile(
    path.join(packageRoot, "meta.json"),
    `${JSON.stringify(
      {
        title: packageLabels[dir],
        pages: ["...src"],
      },
      null,
      2,
    )}\n`,
  );

  await mkdir(srcRoot, { recursive: true });
  await writeFile(
    path.join(srcRoot, "meta.json"),
    `${JSON.stringify(
      {
        title: packageLabels[dir],
        pages: ["index", ...symbolGroups.map((name) => `...${name}`)],
      },
      null,
      2,
    )}\n`,
  );
}
