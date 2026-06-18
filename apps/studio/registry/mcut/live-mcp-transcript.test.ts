import { describe, expect, test } from "bun:test";
import { EditorEngine, getProjectTranscript, parseProject, type Project } from "@mcut/timeline";
import {
  ensureTranscriptForBridge,
  type EnsureTranscriptDeps,
} from "./live-mcp-transcript";

function project(options: { caption?: string } = {}): Project {
  return parseProject({
    id: "p-live-transcript",
    name: "Live transcript",
    width: 1920,
    height: 1080,
    fps: 30,
    assets: {
      "a-video": {
        id: "a-video",
        kind: "video",
        src: "blob:video",
        name: "talk.mp4",
        durationMs: 5000,
        width: 1920,
        height: 1080,
      },
    },
    tracks: [
      {
        id: "t-video",
        name: "Video",
        elements: [
          {
            id: "e-video",
            type: "video",
            assetId: "a-video",
            startMs: 1000,
            durationMs: 3000,
            trimStartMs: 0,
          },
        ],
      },
      ...(options.caption
        ? [
            {
              id: "t-captions",
              name: "Captions",
              elements: [
                {
                  id: "e-caption-old",
                  type: "caption",
                  startMs: 1100,
                  durationMs: 600,
                  text: options.caption,
                  words: [{ text: options.caption, startMs: 0, endMs: 500 }],
                },
              ],
            },
          ]
        : []),
    ],
  });
}

function multicamProject(): Project {
  return parseProject({
    id: "p-live-transcript-multicam",
    name: "Live transcript multicam",
    width: 1920,
    height: 1080,
    fps: 30,
    assets: {
      "a-screen": {
        id: "a-screen",
        kind: "video",
        src: "blob:screen",
        name: "screen.mp4",
        durationMs: 8000,
        width: 1920,
        height: 1080,
      },
      "a-camera": {
        id: "a-camera",
        kind: "video",
        src: "blob:camera",
        name: "camera.mp4",
        durationMs: 8000,
        width: 1920,
        height: 1080,
      },
    },
    layouts: [
      {
        id: "lay-camera",
        name: "Camera",
        slots: [{ source: "camera", rect: { x: 0, y: 0, w: 1, h: 1 } }],
      },
    ],
    tracks: [
      {
        id: "t-video",
        name: "Video",
        elements: [
          {
            id: "e-multicam",
            type: "multicam",
            startMs: 2000,
            durationMs: 4000,
            sources: [
              { key: "screen", assetId: "a-screen", trimStartMs: 0 },
              { key: "camera", assetId: "a-camera", trimStartMs: 600 },
            ],
            angles: [{ atMs: 0, layoutId: "lay-camera" }],
            audioSource: "camera",
          },
        ],
      },
    ],
  });
}

function deps(text = "Hello world"): EnsureTranscriptDeps {
  return {
    isLocalTranscriptionSupported: () => true,
    extractAudioToWav: async () => new Blob(["wav"], { type: "audio/wav" }),
    transcribeOnDevice: async () => ({
      text,
      words: [
        { text: "Hello", startMs: 100, endMs: 300 },
        { text: "world", startMs: 350, endMs: 700 },
      ],
      segments: [],
      durationMs: 1000,
    }),
  };
}

function depsWithSourceTimes(text = "Hello world"): EnsureTranscriptDeps {
  return {
    isLocalTranscriptionSupported: () => true,
    extractAudioToWav: async () => new Blob(["wav"], { type: "audio/wav" }),
    transcribeOnDevice: async () => ({
      text,
      words: [
        { text: "Hello", startMs: 700, endMs: 900 },
        { text: "world", startMs: 950, endMs: 1200 },
      ],
      segments: [],
      durationMs: 1400,
    }),
  };
}

describe("ensureTranscriptForBridge", () => {
  test("transcribes with local Whisper deps and applies word-timed captions", async () => {
    const engine = new EditorEngine({ project: project() });

    const result = await ensureTranscriptForBridge(engine, { language: "en" }, deps());
    const transcript = getProjectTranscript(engine.project, { includeWords: true });

    expect(result.applied).toBe(true);
    expect(result.source).toMatchObject({
      elementId: "e-video",
      assetId: "a-video",
      startMs: 1000,
      endMs: 4000,
      sourceStartMs: 0,
      sourceEndMs: 3000,
    });
    expect(transcript.text).toBe("Hello world");
    expect(transcript.captions[0]?.words).toEqual([
      { text: "Hello", startMs: 1100, endMs: 1300 },
      { text: "world", startMs: 1350, endMs: 1700 },
    ]);
  });

  test("preserves an existing overlapping transcript unless replace is true", async () => {
    const engine = new EditorEngine({ project: project({ caption: "Existing" }) });
    let called = false;

    const result = await ensureTranscriptForBridge(engine, {}, {
      ...deps(),
      transcribeOnDevice: async () => {
        called = true;
        throw new Error("should not transcribe");
      },
    });

    expect(result.applied).toBe(false);
    expect(called).toBe(false);
    expect(getProjectTranscript(engine.project).text).toBe("Existing");
  });

  test("transcribes a multicam clip from its pinned audio source", async () => {
    const engine = new EditorEngine({ project: multicamProject() });
    let extractedSrc = "";

    const result = await ensureTranscriptForBridge(engine, { elementId: "e-multicam" }, {
      ...depsWithSourceTimes(),
      extractAudioToWav: async (src) => {
        extractedSrc = src;
        return new Blob(["wav"], { type: "audio/wav" });
      },
    });
    const transcript = getProjectTranscript(engine.project, { includeWords: true });

    expect(extractedSrc).toBe("blob:camera");
    expect(result.applied).toBe(true);
    expect(result.source).toMatchObject({
      elementId: "e-multicam",
      assetId: "a-camera",
      assetName: "camera.mp4",
      startMs: 2000,
      endMs: 6000,
      sourceStartMs: 600,
      sourceEndMs: 4600,
    });
    expect(transcript.text).toBe("Hello world");
    expect(transcript.captions[0]?.words).toEqual([
      { text: "Hello", startMs: 2100, endMs: 2300 },
      { text: "world", startMs: 2350, endMs: 2600 },
    ]);
  });

  test("replace removes overlapping captions before applying the new transcript", async () => {
    const engine = new EditorEngine({ project: project({ caption: "Existing" }) });

    await ensureTranscriptForBridge(engine, { replace: true }, deps("Replacement"));
    const transcript = getProjectTranscript(engine.project);

    expect(transcript.captionCount).toBe(1);
    expect(transcript.text).toBe("Hello world");
  });

  test("fails clearly when local Whisper is unsupported", async () => {
    const engine = new EditorEngine({ project: project() });

    await expect(
      ensureTranscriptForBridge(engine, {}, {
        ...deps(),
        isLocalTranscriptionSupported: () => false,
      }),
    ).rejects.toThrow("Local Whisper transcription is not supported");
  });
});
