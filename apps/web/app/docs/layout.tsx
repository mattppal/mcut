import { docsLayoutOptions } from "@/lib/docs-layout";
import { source } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { getLayoutTabs } from "fumadocs-ui/layouts/shared";
import type { ReactNode } from "react";

const tabs = [
  {
    title: "Docs",
    description: "Guides, concepts, recipes, and hand-written reference.",
    url: "/docs",
  },
  ...getLayoutTabs(source.pageTree, {
    transform: (tab) => ({
      ...tab,
      unlisted: false,
    }),
  }),
];

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      {...docsLayoutOptions}
      tree={source.pageTree}
      tabs={tabs}
    >
      {children}
    </DocsLayout>
  );
}
