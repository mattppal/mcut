import type { Metadata } from "next";

export const editorMetadata: Metadata = {
  title: "mcut editor",
  description: "Build a multi-track composition, auto-caption it, export an MP4 - all in the browser.",
};

export async function EditorPage() {
  const { EditorClient } = await import("./editor-client");

  return <EditorClient />;
}
