import { source } from "@/lib/source";
import { llms } from "fumadocs-core/source";

export const dynamic = "force-static";

export function GET() {
  return new Response(llms(source).index(), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
