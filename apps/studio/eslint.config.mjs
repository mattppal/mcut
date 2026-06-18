import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Guardrails for the editor's design tokens (see globals.css). Bans the
 * ad-hoc values the UI foundation pass replaced so they don't creep back in.
 */
const BANNED_CLASS_PATTERNS = [
  {
    pattern: /\btext-\[\d+(?:\.\d+)?px\]/,
    message: "Use text-2xs (micro labels) or text-xs (small body) instead of arbitrary pixel sizes.",
  },
  {
    pattern: /\b(?:bg|text|border|ring|outline|fill|stroke)-(?:black|white)(?:\/\d+)?(?=[\s"'`]|$)/,
    message:
      "Use the theme-constant overlay tokens (bg-overlay/NN, text-overlay-foreground/NN) for scrims and text on media.",
  },
  {
    pattern:
      /\b(?:bg|text|border|ring)-(?:sky|emerald|amber|violet|rose|indigo|fuchsia|blue|green|red|purple|pink|cyan|teal|lime|orange|yellow)-\d{2,3}\b/,
    message: "Use semantic tokens (clip-type vars, --snap-guide, primary/destructive) instead of raw palette classes.",
  },
];

const uiConventionsPlugin = {
  rules: {
    "no-adhoc-classes": {
      meta: {
        type: "problem",
        docs: { description: "Enforce mcut design-token conventions in editor UI code" },
        schema: [],
      },
      create(context) {
        const check = (node, value) => {
          if (typeof value !== "string") return;
          for (const { pattern, message } of BANNED_CLASS_PATTERNS) {
            const match = value.match(pattern);
            if (match) context.report({ node, message: `"${match[0]}": ${message}` });
          }
        };
        return {
          Literal(node) {
            check(node, node.value);
          },
          TemplateElement(node) {
            check(node, node.value.raw);
          },
        };
      },
    },
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["registry/mcut/**/*.{ts,tsx}"],
    plugins: { "mcut-ui": uiConventionsPlugin },
    rules: { "mcut-ui/no-adhoc-classes": "error" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored third-party registry components (Kibo UI).
    "components/kibo-ui/**",
  ]),
]);

export default eslintConfig;
