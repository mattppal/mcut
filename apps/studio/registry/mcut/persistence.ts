import { parseProject, type AssetRef, type Project } from "@mcut/timeline";
import {
  isMediaStoreSupported,
  loadMediaBlob,
  pruneMediaBlobs,
  saveMediaBlob,
} from "@mcut/media";

const DB_NAME = "mcut-editor";
const DB_VERSION = 2;
const KV_STORE = "kv";
const ASSET_STORE = "assets";
const PROJECT_STORE = "projects";
const LEGACY_PROJECT_KEY = "project";
const ACTIVE_PROJECT_KEY = "activeProjectId";

interface StoredAsset {
  id: string;
  blob: Blob;
}

interface StoredProject {
  id: string;
  name: string;
  createdMs: number;
  updatedMs: number;
  durationMs: number;
  assetCount: number;
  thumbnail?: Blob;
  project: unknown;
}

export type ProjectListEntry = Omit<StoredProject, "project">;

function projectDurationMs(project: Project): number {
  let end = 0;
  for (const track of project.tracks) {
    for (const element of track.elements) {
      end = Math.max(end, element.startMs + element.durationMs);
    }
  }
  return end;
}

function hasContent(project: Project): boolean {
  return (
    Object.keys(project.assets).length > 0 ||
    project.tracks.some((track) => track.elements.length > 0)
  );
}

function toStoredProject(project: Project, previous?: StoredProject): StoredProject {
  const now = Date.now();
  return {
    id: project.id,
    name: project.name,
    createdMs: previous?.createdMs ?? now,
    updatedMs: now,
    durationMs: projectDurationMs(project),
    assetCount: Object.keys(project.assets).length,
    thumbnail: previous?.thumbnail,
    project: JSON.parse(JSON.stringify(project)),
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const tx = request.transaction!;
      if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
      if (!db.objectStoreNames.contains(ASSET_STORE)) {
        db.createObjectStore(ASSET_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(PROJECT_STORE)) {
        db.createObjectStore(PROJECT_STORE, { keyPath: "id" });
        const kv = tx.objectStore(KV_STORE);
        const read = kv.get(LEGACY_PROJECT_KEY);
        read.onsuccess = () => {
          const raw = read.result;
          if (!raw) return;
          try {
            const project = parseProject(raw);
            tx.objectStore(PROJECT_STORE).put(toStoredProject(project));
            kv.put(project.id, ACTIVE_PROJECT_KEY);
            kv.delete(LEGACY_PROJECT_KEY);
          } catch {
            kv.delete(LEGACY_PROJECT_KEY);
          }
        };
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function getRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function saveProjectSnapshot(project: Project): Promise<void> {
  if (!hasContent(project)) return;
  const db = await openDb();
  let keepHashes = new Set<string>();
  try {
    const previousTx = db.transaction(PROJECT_STORE, "readonly");
    const previous = (await getRequest(previousTx.objectStore(PROJECT_STORE).get(project.id))) as
      | StoredProject
      | undefined;

    const saveTx = db.transaction([KV_STORE, PROJECT_STORE], "readwrite");
    saveTx.objectStore(PROJECT_STORE).put(toStoredProject(project, previous));
    saveTx.objectStore(KV_STORE).put(project.id, ACTIVE_PROJECT_KEY);
    await txDone(saveTx);

    const refsTx = db.transaction([PROJECT_STORE, ASSET_STORE], "readonly");
    const projectStore = refsTx.objectStore(PROJECT_STORE);
    const assetStore = refsTx.objectStore(ASSET_STORE);
    const [stored, keys] = await Promise.all([
      getRequest(projectStore.getAll()) as Promise<StoredProject[]>,
      getRequest(assetStore.getAllKeys()),
    ]);
    const refs = collectReferencedAssets(stored);
    keepHashes = refs.keepHashes;
    const staleKeys = keys.filter((key) => !refs.keepAssetIds.has(String(key)));
    if (staleKeys.length > 0) {
      const pruneTx = db.transaction(ASSET_STORE, "readwrite");
      const pruneStore = pruneTx.objectStore(ASSET_STORE);
      for (const key of staleKeys) pruneStore.delete(key);
      await txDone(pruneTx);
    }
  } finally {
    db.close();
  }
  await pruneMediaBlobs(keepHashes).catch(() => 0);
}

function collectReferencedAssets(
  stored: StoredProject[],
): { keepAssetIds: Set<string>; keepHashes: Set<string> } {
  const keepAssetIds = new Set<string>();
  const keepHashes = new Set<string>();
  for (const record of stored) {
    const assets = (record.project as Project | undefined)?.assets ?? {};
    for (const [id, asset] of Object.entries(assets)) {
      keepAssetIds.add(id);
      if (asset.hash) keepHashes.add(asset.hash);
    }
  }
  return { keepAssetIds, keepHashes };
}

export async function saveAssetBlob(asset: AssetRef | string, blob: Blob): Promise<void> {
  const assetId = typeof asset === "string" ? asset : asset.id;
  const hash = typeof asset === "string" ? undefined : asset.hash;
  if (hash && isMediaStoreSupported()) {
    const stored = await saveMediaBlob(hash, blob).catch(() => false);
    if (stored) return;
  }
  const db = await openDb();
  try {
    const tx = db.transaction(ASSET_STORE, "readwrite");
    tx.objectStore(ASSET_STORE).put({ id: assetId, blob } satisfies StoredAsset);
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function listProjects(): Promise<ProjectListEntry[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(PROJECT_STORE, "readonly");
    const stored = (await getRequest(tx.objectStore(PROJECT_STORE).getAll())) as StoredProject[];
    return stored
      .map((record) => ({
        id: record.id,
        name: record.name,
        createdMs: record.createdMs,
        updatedMs: record.updatedMs,
        durationMs: record.durationMs,
        assetCount: record.assetCount,
        ...(record.thumbnail ? { thumbnail: record.thumbnail } : {}),
      }))
      .sort((a, b) => b.updatedMs - a.updatedMs);
  } catch {
    return [];
  } finally {
    db.close();
  }
}

export interface RestoredSession {
  project: Project;
  missingAssetIds: string[];
}

export async function loadProject(id: string): Promise<RestoredSession | null> {
  const db = await openDb();
  try {
    const projectTx = db.transaction(PROJECT_STORE, "readonly");
    const record = (await getRequest(projectTx.objectStore(PROJECT_STORE).get(id))) as
      | StoredProject
      | undefined;
    if (!record) return null;
    const project = parseProject(record.project);
    if (!hasContent(project)) return null;

    const assetTx = db.transaction(ASSET_STORE, "readonly");
    const stored = (await getRequest(assetTx.objectStore(ASSET_STORE).getAll())) as StoredAsset[];
    const blobs = new Map(stored.map((s) => [s.id, s.blob]));
    const missingAssetIds: string[] = [];
    const assets = { ...project.assets };
    for (const [assetId, asset] of Object.entries(assets)) {
      const blob =
        (asset.hash ? await loadMediaBlob(asset.hash).catch(() => null) : null) ??
        blobs.get(assetId);
      if (blob) {
        assets[assetId] = { ...asset, src: URL.createObjectURL(blob) };
      } else if (asset.src.startsWith("blob:")) {
        missingAssetIds.push(assetId);
      }
    }
    return { project: { ...project, assets }, missingAssetIds };
  } catch {
    return null;
  } finally {
    db.close();
  }
}

async function getActiveProjectId(): Promise<string | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(KV_STORE, "readonly");
    const id = await getRequest(tx.objectStore(KV_STORE).get(ACTIVE_PROJECT_KEY));
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

export async function loadSavedSession(): Promise<RestoredSession | null> {
  const activeId = await getActiveProjectId();
  if (activeId) {
    const restored = await loadProject(activeId);
    if (restored) return restored;
  }
  const [newest] = await listProjects();
  return newest ? loadProject(newest.id) : null;
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  let keepHashes = new Set<string>();
  try {
    const activeTx = db.transaction(KV_STORE, "readonly");
    const activeId = await getRequest(activeTx.objectStore(KV_STORE).get(ACTIVE_PROJECT_KEY));

    const deleteTx = db.transaction([KV_STORE, PROJECT_STORE], "readwrite");
    deleteTx.objectStore(PROJECT_STORE).delete(id);
    if (activeId === id) deleteTx.objectStore(KV_STORE).delete(ACTIVE_PROJECT_KEY);
    await txDone(deleteTx);

    const refsTx = db.transaction([PROJECT_STORE, ASSET_STORE], "readonly");
    const projectStore = refsTx.objectStore(PROJECT_STORE);
    const assetStore = refsTx.objectStore(ASSET_STORE);
    const [stored, keys] = await Promise.all([
      getRequest(projectStore.getAll()) as Promise<StoredProject[]>,
      getRequest(assetStore.getAllKeys()),
    ]);
    const refs = collectReferencedAssets(stored);
    keepHashes = refs.keepHashes;
    const staleKeys = keys.filter((key) => !refs.keepAssetIds.has(String(key)));
    if (staleKeys.length > 0) {
      const pruneTx = db.transaction(ASSET_STORE, "readwrite");
      const pruneStore = pruneTx.objectStore(ASSET_STORE);
      for (const key of staleKeys) pruneStore.delete(key);
      await txDone(pruneTx);
    }
  } finally {
    db.close();
  }
  await pruneMediaBlobs(keepHashes).catch(() => 0);
}

export async function saveProjectThumbnail(id: string, thumbnail: Blob): Promise<void> {
  const db = await openDb();
  try {
    const readTx = db.transaction(PROJECT_STORE, "readonly");
    const record = (await getRequest(readTx.objectStore(PROJECT_STORE).get(id))) as
      | StoredProject
      | undefined;
    if (!record) return;
    const writeTx = db.transaction(PROJECT_STORE, "readwrite");
    writeTx.objectStore(PROJECT_STORE).put({ ...record, thumbnail });
    await txDone(writeTx);
  } finally {
    db.close();
  }
}

export async function clearSavedSession(): Promise<void> {
  const activeId = await getActiveProjectId();
  if (activeId) await deleteProject(activeId);
}
