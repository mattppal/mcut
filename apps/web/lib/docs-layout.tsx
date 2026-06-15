import { BrandMark } from "@/components/brand-mark";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export const docsLayoutOptions: Omit<BaseLayoutProps, "children"> = {
  nav: {
    title: <BrandMark wordmark className="text-2xl tracking-wide" />,
    url: "/",
  },
  links: [
    {
      text: "Docs",
      url: "/docs",
      active: "nested-url",
    },
    {
      text: "GitHub",
      url: "https://github.com/mattppal/mcut",
      external: true,
    },
    {
      text: "Packages",
      url: "https://github.com/mattppal/mcut/tree/main/packages",
      external: true,
    },
  ],
  searchToggle: {
    enabled: false,
  },
  themeSwitch: {
    enabled: false,
  },
};
