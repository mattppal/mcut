import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

type JsonObject = Record<string, unknown>;

type Worktree = {
  path: string;
  branch?: string;
  head?: string;
  baseRepo: string;
};

const repoRoot = path.resolve(import.meta.dirname, "..");
const rootPackagePath = path.join(repoRoot, "package.json");
const lockfilePath = path.join(repoRoot, "bun.lock");
const statePath = path.join(repoRoot, ".context", "mcut-dev.json");
const publishedLockBackupPath = path.join(repoRoot, ".context", "mcut-dev", "bun.lock.published");
const publishedPackageSpecsPath = path.join(repoRoot, ".context", "mcut-dev", "package-specs.published.json");
const studioDir = path.join(repoRoot, "apps", "studio");
const studioEnvLocalPath = path.join(studioDir, ".env.local");
const mcutConsumerPackagePaths = [
  path.join(studioDir, "package.json"),
  path.join(repoRoot, "skills", "mcut-editing", "package.json"),
];
const dependencySections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const defaultReposDir = process.env.MCUT_REPOS_DIR ?? path.resolve(repoRoot, "..");
const requiredMcutPackages = ["timeline", "react", "media", "compositor", "editor"];

const args = process.argv.slice(2);
const command = args[0] ?? "help";

function main() {
  switch (command) {
    case "list":
      listWorktrees();
      return;
    case "use":
      useMcut(args.slice(1));
      return;
    case "preview":
      usePreview(args.slice(1));
      return;
    case "published":
      usePublished(args.slice(1));
      return;
    case "status":
      printStatus();
      return;
    case "env:list":
      listEnvProfiles();
      return;
    case "env:use":
      useEnv(args.slice(1));
      return;
    case "env:clear":
      clearEnv(args.slice(1));
      return;
    case "env:new":
      createEnvProfile(args.slice(1));
      return;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    default:
      fail(`Unknown command "${command}". Run "bun run mcut:dev --help".`);
  }
}

function listWorktrees() {
  const worktrees = discoverWorktrees();

  if (worktrees.length === 0) {
    console.log(`No mcut worktrees found under ${defaultReposDir}.`);
    console.log("Set MCUT_REPOS_DIR or pass an explicit path to `bun run mcut:dev use <path>`.");
    return;
  }

  const current = getCurrentMcutWorkspacePath();
  for (const worktree of worktrees) {
    const marker = current && samePath(current, worktree.path) ? "*" : " ";
    const branch = worktree.branch ? shortBranch(worktree.branch) : "detached";
    console.log(`${marker} ${path.basename(worktree.path)}  ${branch}  ${worktree.path}`);
  }
}

function useMcut(commandArgs: string[]) {
  const selector = commandArgs.find((arg) => !arg.startsWith("-"));
  const dryRun = commandArgs.includes("--dry-run");
  const noInstall = commandArgs.includes("--no-install") || dryRun;

  if (!selector) {
    fail("Usage: bun run mcut:dev use <worktree-name|branch|path> [--no-install] [--dry-run]");
  }

  const selectedPath = resolveMcutSelector(selector);
  validateMcutRoot(selectedPath);

  const workspaceEntry = `${selectedPath}/packages/*`;
  const pkg = readJson(rootPackagePath);
  const currentWorkspaces = getStringArray(pkg.workspaces, "package.json workspaces");
  const nextWorkspaces = [...currentWorkspaces.filter((entry) => !isExternalMcutWorkspace(entry)), workspaceEntry];
  const nextOverrides = withLocalMcutOverrides(pkg.overrides, selectedPath);

  if (!dryRun) {
    backupPublishedLockfile();
    backupPublishedPackageSpecs();
    restorePublishedPackageSpecsBackup(false);
  }

  if (arraysEqual(currentWorkspaces, nextWorkspaces) && objectsEqual(pkg.overrides, nextOverrides)) {
    console.log(`Studio is already pointed at ${selectedPath}.`);
  } else {
    console.log(`${dryRun ? "Would point" : "Pointing"} Studio at ${selectedPath}.`);
    pkg.workspaces = nextWorkspaces;
    pkg.overrides = nextOverrides;
    if (!dryRun) {
      writeJson(rootPackagePath, pkg);
    }
  }

  if (!dryRun) {
    writeState({
      mode: "local",
      mcutPath: selectedPath,
      workspaceEntry,
      updatedAt: new Date().toISOString(),
    });
  }

  if (noInstall) {
    console.log("Skipped bun install.");
  } else {
    runBunInstall();
  }

  console.log(`Run this in the selected mcut repo to keep dist fresh:`);
  console.log(`  cd ${selectedPath}`);
  console.log("  bun run dev");
}

function usePreview(commandArgs: string[]) {
  const selector = commandArgs.find((arg) => !arg.startsWith("-"));
  const dryRun = commandArgs.includes("--dry-run");
  const noInstall = commandArgs.includes("--no-install") || dryRun;

  if (!selector) {
    fail("Usage: bun run mcut:dev preview <pr-number> [--no-install] [--dry-run]");
  }

  const previewId = parsePreviewId(selector);
  const pkg = readJson(rootPackagePath);
  const currentWorkspaces = getStringArray(pkg.workspaces, "package.json workspaces");
  const nextWorkspaces = currentWorkspaces.filter((entry) => !isExternalMcutWorkspace(entry));
  const nextOverrides = withoutLocalMcutOverrides(pkg.overrides);

  console.log(`${dryRun ? "Would point" : "Pointing"} Studio @mcut packages at pkg.pr.new PR #${previewId}.`);

  if (!dryRun) {
    backupPublishedLockfile();
    backupPublishedPackageSpecs();

    pkg.workspaces = nextWorkspaces;
    if (nextOverrides === undefined) {
      delete pkg.overrides;
    } else {
      pkg.overrides = nextOverrides;
    }
    writeJson(rootPackagePath, pkg);
    writePreviewPackageSpecs(previewId);
    writeState({
      mode: "preview",
      preview: previewId,
      updatedAt: new Date().toISOString(),
    });
  }

  if (noInstall) {
    console.log("Skipped bun install.");
  } else {
    runBunInstall();
  }
}

function usePublished(commandArgs: string[]) {
  const dryRun = commandArgs.includes("--dry-run");
  const noInstall = commandArgs.includes("--no-install") || dryRun;
  const pkg = readJson(rootPackagePath);
  const currentWorkspaces = getStringArray(pkg.workspaces, "package.json workspaces");
  const nextWorkspaces = currentWorkspaces.filter((entry) => !isExternalMcutWorkspace(entry));
  const nextOverrides = withoutLocalMcutOverrides(pkg.overrides);

  if (arraysEqual(currentWorkspaces, nextWorkspaces) && objectsEqual(pkg.overrides, nextOverrides)) {
    console.log("Studio is already using published @mcut packages.");
  } else {
    console.log(`${dryRun ? "Would restore" : "Restoring"} published @mcut packages.`);
    pkg.workspaces = nextWorkspaces;
    if (nextOverrides === undefined) {
      delete pkg.overrides;
    } else {
      pkg.overrides = nextOverrides;
    }
    if (!dryRun) {
      writeJson(rootPackagePath, pkg);
    }
  }

  restorePublishedPackageSpecsBackup(dryRun);

  if (!dryRun) {
    restorePublishedLockfileBackup();
    writeState({
      mode: "published",
      updatedAt: new Date().toISOString(),
    });
  }

  if (noInstall) {
    console.log("Skipped bun install.");
  } else {
    runBunInstall();
  }
}

function printStatus() {
  const currentMcut = getCurrentMcutWorkspacePath();
  if (currentMcut) {
    console.log(`mcut packages: local (${currentMcut})`);
  } else {
    const preview = getCurrentPreviewId();
    if (preview === "mixed") {
      console.log("mcut packages: mixed preview/published specs");
    } else if (preview) {
      console.log(`mcut packages: preview (pkg.pr.new PR #${preview})`);
    } else {
      console.log("mcut packages: published");
    }
  }

  const currentEnv = getCurrentEnv();
  console.log(`studio env: ${currentEnv}`);
}

function listEnvProfiles() {
  const profiles = discoverEnvProfiles();
  const current = getCurrentEnvProfilePath();

  if (profiles.length === 0) {
    console.log("No env profiles found in apps/studio.");
    console.log("Create one with `bun run mcut:dev env:new <name>`, then switch with `bun run mcut:dev env:use <name>`.");
    return;
  }

  for (const profile of profiles) {
    const marker = current && samePath(current, profile.path) ? "*" : " ";
    console.log(`${marker} ${profile.name}  ${path.relative(repoRoot, profile.path)}`);
  }
}

function useEnv(commandArgs: string[]) {
  const name = commandArgs.find((arg) => !arg.startsWith("-"));
  const force = commandArgs.includes("--force");

  if (!name) {
    fail("Usage: bun run mcut:dev env:use <name|path> [--force]");
  }

  const profilePath = resolveEnvProfile(name);
  const profileName = envProfileName(profilePath);

  if (existsSync(studioEnvLocalPath)) {
    const stat = lstatSync(studioEnvLocalPath);
    if (stat.isSymbolicLink()) {
      rmSync(studioEnvLocalPath);
    } else if (force) {
      const backupPath = path.join(studioDir, `.env.local.backup-${timestamp()}`);
      renameSync(studioEnvLocalPath, backupPath);
      console.log(`Backed up existing apps/studio/.env.local to ${path.relative(repoRoot, backupPath)}.`);
    } else {
      fail("apps/studio/.env.local already exists and is not a symlink. Pass --force to back it up and switch.");
    }
  }

  symlinkSync(path.relative(studioDir, profilePath), studioEnvLocalPath);
  writeState({
    ...readState(),
    envProfile: profileName,
    envProfilePath: profilePath,
    updatedAt: new Date().toISOString(),
  });

  console.log(`studio env: ${profileName} (${path.relative(repoRoot, profilePath)})`);
}

function clearEnv(commandArgs: string[]) {
  const force = commandArgs.includes("--force");

  if (!existsSync(studioEnvLocalPath)) {
    console.log("apps/studio/.env.local is already absent.");
    return;
  }

  const stat = lstatSync(studioEnvLocalPath);
  if (stat.isSymbolicLink()) {
    rmSync(studioEnvLocalPath);
    console.log("Removed apps/studio/.env.local symlink.");
    return;
  }

  if (!force) {
    fail("apps/studio/.env.local is a regular file. Pass --force to back it up and clear it.");
  }

  const backupPath = path.join(studioDir, `.env.local.backup-${timestamp()}`);
  renameSync(studioEnvLocalPath, backupPath);
  console.log(`Backed up apps/studio/.env.local to ${path.relative(repoRoot, backupPath)}.`);
}

function createEnvProfile(commandArgs: string[]) {
  const name = commandArgs.find((arg) => !arg.startsWith("-"));
  if (!name || name.includes("/") || name.includes("\\")) {
    fail("Usage: bun run mcut:dev env:new <name>");
  }

  const profilePath = path.join(studioDir, `.env.${name}.local`);
  if (existsSync(profilePath)) {
    fail(`${path.relative(repoRoot, profilePath)} already exists.`);
  }

  let contents = "";
  if (existsSync(studioEnvLocalPath)) {
    const stat = lstatSync(studioEnvLocalPath);
    const sourcePath = stat.isSymbolicLink()
      ? path.resolve(studioDir, readlinkSync(studioEnvLocalPath))
      : studioEnvLocalPath;
    contents = readFileSync(sourcePath, "utf8");
  }

  writeFileSync(profilePath, contents);
  console.log(`Created ${path.relative(repoRoot, profilePath)}.`);
}

function discoverWorktrees(): Worktree[] {
  const baseRepos = discoverBaseRepos();
  const worktrees: Worktree[] = [];

  for (const baseRepo of baseRepos) {
    const listed = listGitWorktrees(baseRepo);
    if (listed.length === 0) {
      worktrees.push({ path: baseRepo, baseRepo });
      continue;
    }

    for (const worktree of listed) {
      if (existsSync(worktree.path) && isMcutRoot(worktree.path)) {
        worktrees.push({ ...worktree, baseRepo });
      }
    }
  }

  return uniqueByPath(worktrees).sort((a, b) => a.path.localeCompare(b.path));
}

function discoverBaseRepos(): string[] {
  if (!existsSync(defaultReposDir)) {
    return [];
  }

  return readdirSync(defaultReposDir)
    .map((entry) => path.join(defaultReposDir, entry))
    .filter((entryPath) => {
      try {
        return lstatSync(entryPath).isDirectory() && isMcutRoot(entryPath);
      } catch {
        return false;
      }
    });
}

function listGitWorktrees(baseRepo: string): Worktree[] {
  const result = spawnSync("git", ["-C", baseRepo, "worktree", "list", "--porcelain"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return [];
  }

  const entries: Worktree[] = [];
  let current: Partial<Worktree> = { baseRepo };

  for (const line of result.stdout.split("\n")) {
    if (!line.trim()) {
      if (current.path) {
        entries.push(current as Worktree);
      }
      current = { baseRepo };
      continue;
    }

    const [key, ...rest] = line.split(" ");
    const value = rest.join(" ");
    if (key === "worktree") current.path = value;
    if (key === "branch") current.branch = value;
    if (key === "HEAD") current.head = value;
  }

  if (current.path) {
    entries.push(current as Worktree);
  }

  return entries;
}

function resolveMcutSelector(selector: string): string {
  const explicitPath = resolveMaybePath(selector);
  if (explicitPath) {
    return explicitPath;
  }

  const worktrees = discoverWorktrees();
  const matches = worktrees.filter((worktree) => {
    const aliases = [
      path.basename(worktree.path),
      worktree.branch ? shortBranch(worktree.branch) : undefined,
      worktree.branch?.replace(/^refs\/heads\//, ""),
    ].filter(Boolean);
    return aliases.includes(selector);
  });

  if (matches.length === 0) {
    fail(`No mcut worktree matched "${selector}". Run "bun run mcut:dev list".`);
  }

  if (matches.length > 1) {
    console.log(`"${selector}" is ambiguous:`);
    for (const match of matches) {
      const branch = match.branch ? shortBranch(match.branch) : "detached";
      console.log(`  ${path.basename(match.path)}  ${branch}  ${match.path}`);
    }
    fail("Pass an explicit path or a unique worktree/branch name.");
  }

  return matches[0].path;
}

function resolveMaybePath(selector: string): string | undefined {
  const expanded = selector.startsWith("~")
    ? path.join(process.env.HOME ?? "", selector.slice(1))
    : selector;
  const looksLikePath = expanded.startsWith("/") || expanded.startsWith(".") || existsSync(expanded);
  if (!looksLikePath) {
    return undefined;
  }
  return path.resolve(expanded);
}

function isMcutRoot(candidate: string): boolean {
  return requiredMcutPackages.every((pkg) =>
    existsSync(path.join(candidate, "packages", pkg, "package.json")),
  );
}

function validateMcutRoot(candidate: string) {
  if (!isMcutRoot(candidate)) {
    fail(`${candidate} does not look like an mcut repo with packages/{${requiredMcutPackages.join(",")}}.`);
  }
}

function withLocalMcutOverrides(value: unknown, mcutRoot: string): JsonObject {
  const overrides = isJsonObject(value) ? { ...value } : {};
  for (const key of Object.keys(overrides)) {
    if (key.startsWith("@mcut/")) {
      delete overrides[key];
    }
  }

  for (const packageName of discoverMcutPackageNames(mcutRoot)) {
    overrides[packageName] = "workspace:*";
  }

  return overrides;
}

function withoutLocalMcutOverrides(value: unknown): JsonObject | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }

  const overrides = { ...value };
  for (const key of Object.keys(overrides)) {
    if (key.startsWith("@mcut/")) {
      delete overrides[key];
    }
  }

  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function discoverMcutPackageNames(mcutRoot: string): string[] {
  const packagesDir = path.join(mcutRoot, "packages");
  return readdirSync(packagesDir)
    .map((entry) => path.join(packagesDir, entry, "package.json"))
    .filter((packageJsonPath) => existsSync(packageJsonPath))
    .map((packageJsonPath) => readJson(packageJsonPath).name)
    .filter((name): name is string => typeof name === "string" && name.startsWith("@mcut/"))
    .sort();
}

function isExternalMcutWorkspace(entry: string): boolean {
  if (entry === "apps/*" || entry === "skills/*") {
    return false;
  }

  const workspaceRoot = entry.endsWith("/*") ? entry.slice(0, -2) : entry;
  const absoluteRoot = path.resolve(repoRoot, workspaceRoot);
  const candidateRoot = path.basename(absoluteRoot) === "packages"
    ? path.dirname(absoluteRoot)
    : absoluteRoot;

  return isMcutRoot(candidateRoot);
}

function getCurrentMcutWorkspacePath(): string | undefined {
  const pkg = readJson(rootPackagePath);
  const workspaces = getStringArray(pkg.workspaces, "package.json workspaces");
  const external = workspaces.find((entry) => isExternalMcutWorkspace(entry));
  if (!external) {
    return undefined;
  }

  const workspaceRoot = external.endsWith("/*") ? external.slice(0, -2) : external;
  const absoluteRoot = path.resolve(repoRoot, workspaceRoot);
  return path.basename(absoluteRoot) === "packages" ? path.dirname(absoluteRoot) : absoluteRoot;
}

function discoverEnvProfiles(): Array<{ name: string; path: string }> {
  if (!existsSync(studioDir)) {
    return [];
  }

  return readdirSync(studioDir)
    .filter((name) => name.startsWith(".env.") || name.startsWith(".env.local."))
    .filter((name) => name !== ".env.local")
    .filter((name) => !name.includes(".backup-"))
    .map((fileName) => {
      const profilePath = path.join(studioDir, fileName);
      return { name: envProfileName(profilePath), path: profilePath };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function resolveEnvProfile(nameOrPath: string): string {
  const explicitPath = resolveMaybePath(nameOrPath);
  if (explicitPath) {
    if (!existsSync(explicitPath)) {
      fail(`${explicitPath} does not exist.`);
    }
    return explicitPath;
  }

  const candidates = [
    path.join(studioDir, `.env.${nameOrPath}.local`),
    path.join(studioDir, `.env.local.${nameOrPath}`),
    path.join(studioDir, `.env.${nameOrPath}`),
  ];

  const match = candidates.find((candidate) => existsSync(candidate));
  if (!match) {
    fail(`No env profile found for "${nameOrPath}". Create one with "bun run mcut:dev env:new ${nameOrPath}".`);
  }

  return match;
}

function envProfileName(profilePath: string): string {
  const fileName = path.basename(profilePath);
  if (fileName.startsWith(".env.local.")) {
    return fileName.slice(".env.local.".length);
  }
  if (fileName.startsWith(".env.") && fileName.endsWith(".local")) {
    return fileName.slice(".env.".length, -".local".length);
  }
  if (fileName.startsWith(".env.")) {
    return fileName.slice(".env.".length);
  }
  return fileName;
}

function getCurrentEnv(): string {
  if (!existsSync(studioEnvLocalPath)) {
    return "none";
  }

  const stat = lstatSync(studioEnvLocalPath);
  if (!stat.isSymbolicLink()) {
    return "custom apps/studio/.env.local";
  }

  const target = getCurrentEnvProfilePath();
  if (!target) {
    return "broken apps/studio/.env.local symlink";
  }

  return `${envProfileName(target)} (${path.relative(repoRoot, target)})`;
}

function getCurrentEnvProfilePath(): string | undefined {
  if (!existsSync(studioEnvLocalPath) || !lstatSync(studioEnvLocalPath).isSymbolicLink()) {
    return undefined;
  }

  return path.resolve(studioDir, readlinkSync(studioEnvLocalPath));
}

function runBunInstall() {
  const result = spawnSync("bun", ["install"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function backupPublishedLockfile() {
  if (!existsSync(lockfilePath) || getCurrentMcutWorkspacePath()) {
    return;
  }

  mkdirSync(path.dirname(publishedLockBackupPath), { recursive: true });
  copyFileSync(lockfilePath, publishedLockBackupPath);
}

function restorePublishedLockfileBackup() {
  if (!existsSync(publishedLockBackupPath)) {
    return;
  }

  copyFileSync(publishedLockBackupPath, lockfilePath);
}

function backupPublishedPackageSpecs() {
  const specs = collectMcutPackageSpecs();
  if (containsPreviewPackageSpec(specs)) {
    if (!existsSync(publishedPackageSpecsPath)) {
      fail("Cannot save published @mcut specs because package.json files already contain pkg.pr.new URLs.");
    }
    return;
  }

  mkdirSync(path.dirname(publishedPackageSpecsPath), { recursive: true });
  writeJson(publishedPackageSpecsPath, specs);
}

function restorePublishedPackageSpecsBackup(dryRun: boolean): boolean {
  if (!existsSync(publishedPackageSpecsPath)) {
    if (containsPreviewPackageSpec(collectMcutPackageSpecs())) {
      fail("Cannot restore published @mcut specs: missing .context/mcut-dev/package-specs.published.json.");
    }
    return false;
  }

  const specs = readJson(publishedPackageSpecsPath);
  let changed = false;

  for (const [relativeManifestPath, sectionSpecs] of Object.entries(specs)) {
    if (!isJsonObject(sectionSpecs)) {
      continue;
    }

    const manifestPath = path.join(repoRoot, relativeManifestPath);
    if (!existsSync(manifestPath)) {
      continue;
    }

    const pkg = readJson(manifestPath);
    for (const [sectionName, packageSpecs] of Object.entries(sectionSpecs)) {
      if (!isJsonObject(packageSpecs)) {
        continue;
      }

      const section = isJsonObject(pkg[sectionName]) ? { ...pkg[sectionName] } : {};
      for (const [packageName, spec] of Object.entries(packageSpecs)) {
        if (typeof spec !== "string" || section[packageName] === spec) {
          continue;
        }
        section[packageName] = spec;
        changed = true;
      }
      pkg[sectionName] = section;
    }

    if (changed && !dryRun) {
      writeJson(manifestPath, pkg);
    }
  }

  if (changed) {
    console.log(`${dryRun ? "Would restore" : "Restored"} published @mcut package specs.`);
  }

  return changed;
}

function writePreviewPackageSpecs(previewId: string) {
  for (const manifestPath of mcutConsumerPackagePaths) {
    if (!existsSync(manifestPath)) {
      continue;
    }

    const pkg = readJson(manifestPath);
    let changed = false;

    for (const sectionName of dependencySections) {
      if (!isJsonObject(pkg[sectionName])) {
        continue;
      }

      const section = { ...pkg[sectionName] };
      for (const packageName of Object.keys(section)) {
        if (!packageName.startsWith("@mcut/")) {
          continue;
        }
        const spec = previewPackageSpec(packageName, previewId);
        if (section[packageName] !== spec) {
          section[packageName] = spec;
          changed = true;
        }
      }
      pkg[sectionName] = section;
    }

    if (changed) {
      writeJson(manifestPath, pkg);
    }
  }
}

function collectMcutPackageSpecs(): JsonObject {
  const result: JsonObject = {};

  for (const manifestPath of mcutConsumerPackagePaths) {
    if (!existsSync(manifestPath)) {
      continue;
    }

    const pkg = readJson(manifestPath);
    const manifestSpecs: JsonObject = {};

    for (const sectionName of dependencySections) {
      if (!isJsonObject(pkg[sectionName])) {
        continue;
      }

      const sectionSpecs: JsonObject = {};
      for (const [packageName, spec] of Object.entries(pkg[sectionName])) {
        if (packageName.startsWith("@mcut/") && typeof spec === "string") {
          sectionSpecs[packageName] = spec;
        }
      }

      if (Object.keys(sectionSpecs).length > 0) {
        manifestSpecs[sectionName] = sectionSpecs;
      }
    }

    if (Object.keys(manifestSpecs).length > 0) {
      result[path.relative(repoRoot, manifestPath)] = manifestSpecs;
    }
  }

  return result;
}

function containsPreviewPackageSpec(specs: JsonObject): boolean {
  for (const sectionSpecs of Object.values(specs)) {
    if (!isJsonObject(sectionSpecs)) continue;
    for (const packageSpecs of Object.values(sectionSpecs)) {
      if (!isJsonObject(packageSpecs)) continue;
      for (const spec of Object.values(packageSpecs)) {
        if (typeof spec === "string" && isPreviewPackageSpec(spec)) {
          return true;
        }
      }
    }
  }
  return false;
}

function getCurrentPreviewId(): string | "mixed" | undefined {
  const specs = collectMcutPackageSpecs();
  const ids = new Set<string>();
  let sawPreview = false;
  let sawNonPreview = false;

  for (const sectionSpecs of Object.values(specs)) {
    if (!isJsonObject(sectionSpecs)) continue;
    for (const packageSpecs of Object.values(sectionSpecs)) {
      if (!isJsonObject(packageSpecs)) continue;
      for (const spec of Object.values(packageSpecs)) {
        if (typeof spec !== "string") continue;
        const previewId = previewIdFromPackageSpec(spec);
        if (previewId) {
          sawPreview = true;
          ids.add(previewId);
        } else {
          sawNonPreview = true;
        }
      }
    }
  }

  if (!sawPreview) {
    return undefined;
  }
  if (sawNonPreview || ids.size !== 1) {
    return "mixed";
  }
  return [...ids][0];
}

function parsePreviewId(selector: string): string {
  const normalized = selector.replace(/[/?#]+$/, "");
  const match = normalized.match(/(?:pull\/|#)?(\d+)$/);
  if (!match) {
    fail(`"${selector}" is not a PR number or pull request URL.`);
  }
  return match[1];
}

function previewPackageSpec(packageName: string, previewId: string): string {
  return `https://pkg.pr.new/${packageName}@${previewId}`;
}

function isPreviewPackageSpec(spec: string): boolean {
  return previewIdFromPackageSpec(spec) !== undefined;
}

function previewIdFromPackageSpec(spec: string): string | undefined {
  return spec.match(/^https:\/\/pkg\.pr\.new\/@mcut\/[^@/]+@(.+)$/)?.[1];
}

function readJson(filePath: string): JsonObject {
  return JSON.parse(readFileSync(filePath, "utf8")) as JsonObject;
}

function writeJson(filePath: string, value: JsonObject) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readState(): JsonObject {
  if (!existsSync(statePath)) {
    return {};
  }
  return readJson(statePath);
}

function writeState(value: JsonObject) {
  mkdirSync(path.dirname(statePath), { recursive: true });
  writeJson(statePath, value);
}

function getStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    fail(`${label} must be an array of strings.`);
  }
  return value as string[];
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueByPath(worktrees: Worktree[]): Worktree[] {
  const seen = new Set<string>();
  return worktrees.filter((worktree) => {
    const key = path.resolve(worktree.path);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function objectsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? undefined) === JSON.stringify(right ?? undefined);
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

function shortBranch(branch: string): string {
  return branch.replace(/^refs\/heads\//, "");
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
}

function printHelp() {
  console.log(`mcut Studio dev helper

Usage:
  bun run mcut:dev list
  bun run mcut:dev use <worktree-name|branch|path> [--no-install]
  bun run mcut:dev preview <pr-number> [--no-install]
  bun run mcut:dev published [--no-install]
  bun run mcut:dev status
  bun run mcut:dev env:list
  bun run mcut:dev env:new <name>
  bun run mcut:dev env:use <name|path> [--force]
  bun run mcut:dev env:clear [--force]

Discovery defaults to ${defaultReposDir}. Override it with MCUT_REPOS_DIR.`);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

main();
