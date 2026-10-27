import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import frozen from "../../test/fixtures/issue-1460/cases.json";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { evaluateElementsReference } from "../geometry/evaluationEngine";
import { OutputPreviewApp } from "./OutputPreviewApp";
import type { VscodeWebviewApi } from "./protocol";

// Supporting DOM coverage uses real compiler/planner/reference results. The
// retained crossSurfaceProjection test independently exercises real Rust stdio.
vi.mock("../output/outputCore", async () => {
  const actual = await vi.importActual<typeof import("../output/outputCore")>("../output/outputCore");
  return {
    ...actual,
    evaluateOutputPlan: (input: Parameters<typeof actual.evaluateOutputPlan>[0]) =>
      actual.evaluateOutputPlan({ ...input, evaluate: evaluateElementsReference })
  };
});

const b4 = frozen.find(c => c.id === "B4")!;
const numbers = (text: string) => (text.match(/[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
const near = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 8);
const pair = (actual: number[], expected: number[]) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((n, i) => near(n, expected[i]));
};
const message = (data: unknown) => act(() => { window.dispatchEvent(new MessageEvent("message", { data })); });
const viewportRect = { x: 0, y: 0, top: 0, left: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) } as DOMRect;

afterEach(() => {
  cleanup();
  useCadDocumentStore.setState(initialCadDocumentState());
  vi.restoreAllMocks();
});

describe("Issue 1460 B4 ordinary/highlight multiline presentation", () => {
  it.each([
    { angle: 0, mirror: false },
    { angle: 0, mirror: true },
    { angle: 90, mirror: false },
    { angle: 37, mirror: true }
  ])("keeps glyphs and baselines coherent at $angle degrees, mirror=$mirror", async ({ angle, mirror }) => {
    // Same retained B4 source/plan discriminator; explicit amendment-authorized
    // repair verification variants, no additional discovery units or geometry.
    const source = b4.source.replace("at: (31, -23)", `at: (31, -23), angle: ${angle}, mirror: ${mirror}`);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(viewportRect);
    const api: VscodeWebviewApi = { postMessage: vi.fn() };
    useCadDocumentStore.getState().commitText(source, "test");
    render(<OutputPreviewApp api={api} />);
    message({ type: "replaceTextDocument", sourceText: source, documentVersion: 1460 });
    const selectText = (layer: string) => document.querySelector(`text[data-output-preview-layer="${layer}"]`);
    await waitFor(() => expect(selectText("geometry")?.textContent).toBe("AlphaBeta"));
    message({ type: "outputPreviewReveal", requestId: 1460, documentVersion: 1460, normalizedSourceOffset: source.indexOf("print P(") + 2 });
    await waitFor(() => expect(selectText("reveal-highlight")?.textContent).toBe("AlphaBeta"));

    const regular = selectText("geometry")!;
    const highlight = selectText("reveal-highlight")!;
    expect(highlight.getAttribute("transform")).toBe(regular.getAttribute("transform"));
    const [tx, ty, rotation, sx, sy] = numbers(regular.getAttribute("transform")!);
    const zoom = Math.abs(sx);
    expect(zoom).toBeGreaterThan(0);
    near(sy, zoom); near(sx, mirror ? -zoom : zoom); near(rotation, -angle);
    const radians = angle * Math.PI / 180;
    const cos = Math.cos(radians); const sin = Math.sin(radians);
    const place = (x: number, y: number) => {
      const mirroredX = mirror ? -x : x;
      return [31 + mirroredX * cos - y * sin, -23 + mirroredX * sin + y * cos];
    };
    const anchor = place(12, 18);
    const worldStart = place(5, 2);
    const path = document.querySelector('path[data-output-preview-layer="geometry"]')!;
    const screenPath = numbers(path.getAttribute("d")!);
    // Nonzero placement and current viewport offsets: align the independently
    // placed label anchor to the neighboring real joined path in screen pixels.
    near(tx, screenPath[0] + (anchor[0] - worldStart[0]) * zoom);
    near(ty, screenPath[1] - (anchor[1] - worldStart[1]) * zoom);
    const vertices = [place(5, 2), place(245, 2), place(245, 2), place(245, 42)];
    pair(screenPath, vertices.flatMap(p => [tx + (p[0] - anchor[0]) * zoom, ty - (p[1] - anchor[1]) * zoom]));
    expect(document.querySelectorAll('[data-output-preview-layer="page-fill"]')).not.toHaveLength(0);

    for (const node of [regular, highlight]) {
      const lines = [...node.querySelectorAll("tspan")];
      expect(lines.map(line => line.textContent)).toEqual(["Alpha", "Beta"]);
      expect(lines.map(line => Number(line.getAttribute("y")))).toEqual([0, 6]);
      expect(lines.map(line => Number(line.getAttribute("x")))).toEqual([0, 0]);
      near(Number(node.getAttribute("font-size")), 5);
      // Apply the actual SVG transform to glyph ascent and actual tspan advance.
      const glyphUp = [-sy * sin, -sy * cos];
      const deltaY = Number(lines[1].getAttribute("y")) - Number(lines[0].getAttribute("y"));
      const secondBaseline = [deltaY * sy * sin, deltaY * sy * cos];
      pair(glyphUp, [-zoom * sin, -zoom * cos]);
      pair(secondBaseline, [6 * zoom * sin, 6 * zoom * cos]);
      pair([sx * cos, -sx * sin], [(mirror ? -1 : 1) * zoom * cos, -(mirror ? -1 : 1) * zoom * sin]);
    }
  }, 15000);
});
