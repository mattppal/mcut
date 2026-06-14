"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "@/lib/hugeicons";
import { Button } from "@/components/ui/button";

const COMMANDS = [
  {
    comment: "core SDK",
    command:
      "bun add @mcut/timeline @mcut/editor @mcut/compositor @mcut/media @mcut/react @mcut/transcription",
  },
  {
    comment: "caption providers",
    command:
      "bun add @mcut/transcription-assemblyai @mcut/transcription-local @mcut/transcription-ai-sdk ai",
  },
  {
    comment: "CLI",
    command: "bunx mcut --help",
  },
] as const;

function CopyButton({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
      aria-label="Copy command"
      onClick={async () => {
        await navigator.clipboard.writeText(command);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
    </Button>
  );
}

export function InstallCommands() {
  return (
    <section className="flex flex-col gap-4 border-y py-5 font-mono text-xs leading-relaxed">
      {COMMANDS.map(({ comment, command }) => (
        <div key={comment} className="flex items-center justify-between gap-4">
          <pre className="command-scroll min-w-0 flex-1 overflow-x-auto pb-1 pr-3">
            <span className="text-muted-foreground">
              # {comment}
              {"\n"}
            </span>
            {command}
          </pre>
          <CopyButton command={command} />
        </div>
      ))}
    </section>
  );
}
