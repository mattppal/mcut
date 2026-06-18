import { describe, expect, test } from "bun:test";
import { parseGoogleFontCss, weightDescriptorMatches } from "./font-css";

const CSS2_SAMPLE = `
/* latin-ext */
@font-face {
  font-family: 'Inter';
  font-style: italic;
  font-weight: 100 900;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/v20/ext.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+1EA0-1EF9;
}
/* latin */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/v20/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+2000-206F;
}
`;

describe("parseGoogleFontCss", () => {
  test("extracts one face per @font-face block with descriptors", () => {
    const faces = parseGoogleFontCss(CSS2_SAMPLE);
    expect(faces).toEqual([
      {
        url: "https://fonts.gstatic.com/s/inter/v20/ext.woff2",
        weight: "100 900",
        style: "italic",
        unicodeRange: "U+0100-02BA, U+1EA0-1EF9",
      },
      {
        url: "https://fonts.gstatic.com/s/inter/v20/latin.woff2",
        weight: "100 900",
        style: "normal",
        unicodeRange: "U+0000-00FF, U+2000-206F",
      },
    ]);
  });

  test("handles quoted urls and static weights", () => {
    const faces = parseGoogleFontCss(
      `@font-face { font-family: 'Anton'; font-style: normal; font-weight: 400; src: url("https://x/y.woff2"); }`,
    );
    expect(faces).toEqual([{ url: "https://x/y.woff2", weight: "400", style: "normal" }]);
  });

  test("skips blocks without a src url and tolerates junk", () => {
    expect(parseGoogleFontCss(`@font-face { font-family: 'X'; }`)).toEqual([]);
    expect(parseGoogleFontCss("")).toEqual([]);
    expect(parseGoogleFontCss("body { color: red }")).toEqual([]);
  });
});

describe("weightDescriptorMatches", () => {
  test("single weights match exactly", () => {
    expect(weightDescriptorMatches("400", 400)).toBe(true);
    expect(weightDescriptorMatches("400", 700)).toBe(false);
  });

  test("variable ranges cover contained weights", () => {
    expect(weightDescriptorMatches("100 900", 550)).toBe(true);
    expect(weightDescriptorMatches("200 700", 100)).toBe(false);
  });

  test("missing or malformed descriptors match everything", () => {
    expect(weightDescriptorMatches(undefined, 400)).toBe(true);
    expect(weightDescriptorMatches("bold", 400)).toBe(true);
  });
});
