import { createAssemblyAIProvider } from "@mcut/transcription-assemblyai";

export const maxDuration = 300;

export async function POST(request: Request) {
  if (!process.env.ASSEMBLYAI_API_KEY) {
    return Response.json(
      {
        error:
          "Transcription is not configured: set ASSEMBLYAI_API_KEY in the server environment.",
      },
      { status: 503 },
    );
  }

  const formData = await request.formData();
  const audio = formData.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return Response.json(
      { error: 'Expected multipart form data with a non-empty "audio" file.' },
      { status: 400 },
    );
  }
  const language = formData.get("language");

  try {
    const provider = createAssemblyAIProvider();
    const result = await provider.transcribe(
      { audio, mimeType: audio.type || "audio/wav" },
      typeof language === "string" && language ? { language } : undefined,
    );
    return Response.json(result);
  } catch (error) {
    console.error("transcription failed", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Transcription failed." },
      { status: 502 },
    );
  }
}
