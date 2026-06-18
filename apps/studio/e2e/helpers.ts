import { expect, type Page } from "@playwright/test";

/** Console/page errors collected per test — assert empty at the end. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text().slice(0, 200));
  });
  return errors;
}

/** Open the studio and dismiss the session-restore prompt if one appears. */
export async function openEditor(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page
    .getByText("Discard")
    .click({ timeout: 1500 })
    .catch(() => {});
}

/** Import a generated PNG through the media bin's hidden file input. */
export async function importPng(page: Page, name = "fixture.png"): Promise<void> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createLinearGradient(0, 0, 640, 360);
    gradient.addColorStop(0, "#0ea5e9");
    gradient.addColorStop(1, "#a855f7");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 640, 360);
    return canvas.toDataURL("image/png");
  });
  await page.setInputFiles('input[type="file"]', {
    name,
    mimeType: "image/png",
    buffer: Buffer.from(dataUrl.split(",")[1]!, "base64"),
  });
  await expect(page.getByTitle(new RegExp(name))).toBeVisible();
}

/** Record a short webm (canvas + oscillator) in-page and import it. */
export async function importWebm(page: Page, name = "fixture.webm"): Promise<void> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext("2d")!;
    const audio = new AudioContext();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    gain.gain.value = 0.3;
    const destination = audio.createMediaStreamDestination();
    oscillator.connect(gain).connect(destination);
    oscillator.frequency.value = 220;
    oscillator.start();

    const stream = canvas.captureStream(30);
    destination.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.start(100);

    let frame = 0;
    const interval = setInterval(() => {
      frame++;
      ctx.fillStyle = `hsl(${(frame * 5) % 360} 70% 45%)`;
      ctx.fillRect(0, 0, 640, 360);
      ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.arc(40 + ((frame * 9) % 560), 180, 40, 0, Math.PI * 2);
      ctx.fill();
    }, 33);

    await new Promise((resolve) => setTimeout(resolve, 2200));
    clearInterval(interval);
    recorder.stop();
    await new Promise((resolve) => (recorder.onstop = resolve as () => void));
    oscillator.stop();
    const blob = new Blob(chunks, { type: "video/webm" });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
  await page.setInputFiles('input[type="file"]', {
    name,
    mimeType: "video/webm",
    buffer: Buffer.from(base64, "base64"),
  });
  await expect(page.getByTitle(new RegExp(name))).toBeVisible({ timeout: 10_000 });
}

/**
 * Drag a media-bin card onto a timeline lane. Lane geometry is measured
 * AFTER the drag starts: the phantom "new track" lane mounts on drag start
 * and shifts every row down.
 */
export async function dragAssetToLane(
  page: Page,
  cardTitle: RegExp,
  options: { laneIndex?: number; offsetX?: number } = {},
): Promise<void> {
  const card = page.getByTitle(cardTitle).first();
  const cardBox = (await card.boundingBox())!;
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(cardBox.x + 70, cardBox.y + 90, { steps: 5 });
  await page.waitForTimeout(200);
  const lane = page.locator("[data-mcut-lane]").nth(options.laneIndex ?? 0);
  const laneBox = (await lane.boundingBox())!;
  const targetX = laneBox.x + (options.offsetX ?? 120);
  const targetY = laneBox.y + laneBox.height / 2;
  await page.mouse.move(targetX, targetY, { steps: 10 });
  // Jiggle so remeasured droppable rects apply before the drop.
  await page.mouse.move(targetX + 1, targetY + 1);
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/** Non-black pixel count of the preview canvas (animation/visibility checks). */
export async function previewPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("[data-mcut-player] canvas")!;
    const ctx = canvas.getContext("2d")!;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonBlack = 0;
    for (let i = 0; i < data.length; i += 64) {
      if (data[i]! > 60 || data[i + 1]! > 60 || data[i + 2]! > 60) nonBlack++;
    }
    return nonBlack;
  });
}

export const clip = (page: Page) => page.locator("[data-mcut-clip]");

/**
 * Open a left-rail tab idempotently. Clicking the active tab collapses the
 * panel, so blind clicks (and role-name lookups that collide with inspector
 * section headers) are unsafe — target the rail directly and skip when the
 * tab is already open.
 */
export async function openLeftTab(
  page: Page,
  tab: "media" | "text" | "animate" | "captions",
): Promise<void> {
  const button = page.locator(`[data-rail-tab="${tab}"]`);
  if ((await button.getAttribute("aria-pressed")) !== "true") await button.click();
}
