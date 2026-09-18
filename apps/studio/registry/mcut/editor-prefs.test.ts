import { describe, expect, test } from "bun:test";
import { parseEditorPrefs } from "./editor-prefs";

describe("parseEditorPrefs", () => {
  test("stored prefs parse to the exact object", () => {
    expect(
      parseEditorPrefs('{"pxPerMs":0.1,"snapEnabled":false,"autoCrossfade":true,"theme":"light","previewQuality":720}'),
    ).toEqual({
      pxPerMs: 0.1,
      snapEnabled: false,
      autoCrossfade: true,
      theme: "light",
      previewQuality: 720,
    });
  });

  test("a wrong-typed pref is dropped so the provider default applies, siblings survive", () => {
    expect(
      parseEditorPrefs('{"pxPerMs":"wide","snapEnabled":"yes","theme":"sepia","previewQuality":-1,"autoCrossfade":true}'),
    ).toEqual({ autoCrossfade: true });
  });

  test("nothing stored, unparsable JSON, and a non-object all read as no prefs", () => {
    expect(parseEditorPrefs(null)).toEqual({});
    expect(parseEditorPrefs("{not json")).toEqual({});
    expect(parseEditorPrefs("[0.1]")).toEqual({});
  });
});
