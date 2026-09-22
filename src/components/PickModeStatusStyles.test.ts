import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
const pickModeStatusStart = stylesheet.indexOf(".pick-mode-status {");
const pickModeStatusEnd = stylesheet.indexOf(".canvas-viewport.is-point-dragging,", pickModeStatusStart);
const pickModeStatusStyles = stylesheet.slice(pickModeStatusStart, pickModeStatusEnd);
const pickModeChromeStart = stylesheet.indexOf(".canvas-pick-mode-chrome {");
const pickModeChromeEnd = stylesheet.indexOf(".pick-mode-status-title", pickModeChromeStart);
const pickModeChromeStyles = stylesheet.slice(pickModeChromeStart, pickModeChromeEnd);

describe("Pick Mode status stylesheet contract", () => {
  it("uses a Canvas-local top row without losing the bounded list", () => {
    expect(pickModeChromeStyles).toContain("position: absolute;");
    expect(pickModeChromeStyles).toContain("top: 0;");
    expect(pickModeChromeStyles).toContain("right: 0;");
    expect(pickModeChromeStyles).toContain("left: 0;");
    expect(pickModeChromeStyles).toContain("padding: 6px 10px;");
    expect(pickModeChromeStyles).toContain("background: var(--canvas-background);");
    expect(pickModeStatusStyles).not.toContain("position: fixed;");
    expect(pickModeStatusStyles).not.toContain("top: 10px;");
    expect(pickModeStatusStyles).not.toContain("left: 10px;");
    expect(pickModeStatusStyles).toContain("max-height: min(180px, 28vh);");
    expect(pickModeStatusStyles).toContain("overflow: auto;");
    expect(pickModeStatusStyles).not.toContain("bottom:");
    expect(pickModeStatusStyles).not.toContain("transform: translateX(-50%);");
    expect(pickModeStatusStyles).toContain("flex-wrap: wrap;");
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
