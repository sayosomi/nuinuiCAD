import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
const pickModeStatusStart = stylesheet.indexOf(".pick-mode-status {");
const pickModeStatusEnd = stylesheet.indexOf(".canvas-viewport.is-point-dragging,", pickModeStatusStart);
const pickModeStatusStyles = stylesheet.slice(pickModeStatusStart, pickModeStatusEnd);

describe("Pick Mode status stylesheet contract", () => {
  it("anchors the panel at the top-left without losing the bounded list", () => {
    expect(pickModeStatusStyles).toContain("top: 10px;");
    expect(pickModeStatusStyles).toContain("left: 10px;");
    expect(pickModeStatusStyles).toContain("max-height: min(180px, 28vh);");
    expect(pickModeStatusStyles).toContain("overflow: auto;");
    expect(pickModeStatusStyles).not.toContain("bottom:");
    expect(pickModeStatusStyles).not.toContain("transform: translateX(-50%);");
  });

  it("uses the inherited Canvas semantic theme without owning a fixed palette", () => {
    expect(pickModeStatusStart).toBeGreaterThanOrEqual(0);
    expect(pickModeStatusEnd).toBeGreaterThan(pickModeStatusStart);

    for (const variable of [
      "--canvas-background",
      "--canvas-foreground",
      "--canvas-muted",
      "--canvas-accent"
    ]) {
      expect(pickModeStatusStyles).toContain(`var(${variable})`);
    }
    expect(pickModeStatusStyles).toContain("color-mix(in srgb, var(--canvas-accent)");
    expect(pickModeStatusStyles).not.toMatch(/#(?:0f766e|075e57|0b5f58|dff3ec|ffffff)\b/i);
    expect(pickModeStatusStyles).not.toMatch(/rgb\(/i);
  });
});
