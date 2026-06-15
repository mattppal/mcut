import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export const docsLayoutOptions: Omit<BaseLayoutProps, "children"> = {
  nav: {
    title: "mcut",
    url: "/",
  },
  githubUrl: "https://github.com/mattppal/mcut",
  links: [
    {
      text: "Docs",
      url: "/docs",
      active: "nested-url",
    },
    {
      text: "Packages",
      url: "https://github.com/mattppal/mcut/tree/main/packages",
      external: true,
    },
  ],
};
