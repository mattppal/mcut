import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const appRoot = process.cwd();
const sourceRoot = path.join(appRoot, "content/docs");
const publicDocsRoot = path.join(appRoot, "public/docs");
const publicRootDoc = path.join(appRoot, "public/docs.md");

async function copyMarkdownTree(sourceDir: string, targetDir: string) {
  await mkdir(targetDir, { recursive: true });

  for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyMarkdownTree(sourcePath, targetPath);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".mdx")) continue;

    const markdown = await readFile(sourcePath, "utf8");
    await writeFile(targetPath.replace(/\.mdx$/, ".md"), markdown);

    if (sourcePath === path.join(sourceRoot, "index.mdx")) {
      await writeFile(publicRootDoc, markdown);
    }
  }
}

await rm(publicDocsRoot, { recursive: true, force: true });
await rm(publicRootDoc, { force: true });
await copyMarkdownTree(sourceRoot, publicDocsRoot);
