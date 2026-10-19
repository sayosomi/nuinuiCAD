import { expect, it } from "vitest";
import { getParameterDefinitions, getParameterValue, setParameterValue, resolveParameterValueSpan } from "@nuinuicad/nui-language";
import type { CadElement } from "../src/types/geometry";
import { reductions } from "./fixtures/issue-stage7/reductions";

it("projects only inline coordinates and updates a vertex without changing siblings or the source", () => {
  const element: CadElement = { id:"p", type:"polyline", name:"Out", activity:"visible", closed:false,
    points:[{ mode:"reference", pointId:"A" }, { mode:"coordinate", x:7, y:9 }] };
  expect(getParameterDefinitions(element).filter(d => d.kind === "number").map(d => d.key)).toEqual(["points:1:x", "points:1:y"]);
  const updated = setParameterValue(element, "points:1:x", { kind:"expression", expression:"@Origin + 3" });
  expect(getParameterValue(updated, "points:1:x")).toEqual({ kind:"expression", expression:"@Origin + 3" });
  expect(getParameterValue(element, "points:1:x")).toBe(7);
  expect(getParameterValue(updated, "points:1:y")).toBe(9);
  expect(getParameterValue(updated, "points:0")).toEqual(element.points[0]);
  expect(setParameterValue(element, "points:9:x", 4)).toBe(element);
  expect(getParameterValue(element, "points:-1:x")).toBeUndefined();
});

it("retains exact source spans for each coordinate in the existing F5 reducer", () => {
  const line = reductions.find(r => r.id === "R-polyline-inline")!.source.split("\n").find(line => line.includes("export line Out"))!.replace(/^export /, "");
  const element: CadElement = { id:"p", type:"polyline", name:"Out", activity:"visible", closed:false,
    points:[{ mode:"coordinate", x:7, y:2 }, { mode:"coordinate", x:10, y:6 }] };
  for (const [key, expected] of [["points:0:x","@Origin"], ["points:0:y","2"], ["points:1:x","@Origin + 3"], ["points:1:y","6"]]) {
    const span = resolveParameterValueSpan(line, element, key)!;
    expect(span).not.toBeNull();
    expect(line.slice(span.start, span.end)).toBe(expected);
  }
});
