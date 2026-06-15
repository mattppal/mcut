import { docsLayoutOptions } from "@/lib/docs-layout";
import { source } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      {...docsLayoutOptions}
      tree={source.pageTree}
      sidebar={{ defaultOpenLevel: 1 }}
      containerProps={{ className: "bg-background" }}
    >
      {children}
    </DocsLayout>
  );
}
