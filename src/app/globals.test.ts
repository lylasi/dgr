import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("page-enter animation", () => {
  it("does not retain a transform that re-anchors fixed dialogs", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    const rule = /\.page-enter\s*\{([^}]*)\}/.exec(css)?.[1] || "";

    expect(rule).toContain("animation: page-enter 220ms ease backwards");
    expect(rule).not.toMatch(/\b(?:both|forwards)\b/);
  });
});
