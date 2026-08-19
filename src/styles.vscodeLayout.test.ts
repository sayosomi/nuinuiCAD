/// <reference types="node" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

const ruleBody = (selector: string): string => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = stylesheet.match(new RegExp(`^${escapedSelector}\\s*\\{([\\s\\S]*?)^\\}`, "m"));

  expect(match, `Expected ${selector} rule in src/styles.css`).not.toBeNull();
  return match?.[1] ?? "";
};

describe("shared stylesheet host layout ownership", () => {
  it("keeps the desktop minimum on .app-shell and lets Canvas webviews shrink", () => {
    expect(ruleBody("body")).not.toMatch(/min-width:\s*1180px/);
    expect(ruleBody(".app-shell")).toMatch(/min-width:\s*1180px/);

    const canvasWorkspace = ruleBody(".canvas-workspace");
    expect(canvasWorkspace).toMatch(/min-width:\s*0/);
    expect(canvasWorkspace).toMatch(/overflow:\s*hidden/);
  });
});
