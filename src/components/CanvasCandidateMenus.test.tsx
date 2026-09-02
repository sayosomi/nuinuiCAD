import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CanvasCandidateMenus } from "./CanvasCandidateMenus";
import { webviewCanvasPresentationFor } from "../vscode/webviewCanvasPresentation";
import type { VscodeWebviewPresentation } from "../vscode/webviewPresentation";

const japanesePresentation: VscodeWebviewPresentation = {
  locale: "ja",
  strings: {
    "canvas.candidate.point": "点選択候補"
  },
  diagnosticTemplates: {}
};

describe("Canvas Webview presentation", () => {
  it("localizes candidate accessibility copy while preserving authored candidate names", () => {
    render(
      <CanvasCandidateMenus
        measurementCandidateMenu={null}
        pointPickCandidateMenu={{
          screen: { x: 10, y: 20 },
          candidates: [{
            anchor: { mode: "coordinate", x: 1, y: 2 },
            label: "AuthoredPoint",
            screen: { x: 10, y: 20 }
          }]
        }}
        linePickCandidateMenu={null}
        overlapCandidateSession={null}
        hoverIdentityCandidatePopup={null}
        viewportSize={{ width: 400, height: 300 }}
        onApplyMeasurementCandidate={vi.fn()}
        onApplyPointPickCandidate={vi.fn()}
        onApplyLinePickCandidate={vi.fn()}
        onActivateOverlapCandidate={vi.fn()}
        onFocusCanvas={vi.fn()}
        presentation={webviewCanvasPresentationFor(japanesePresentation)}
      />
    );

    expect(screen.getByRole("menu", { name: "点選択候補" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "AuthoredPoint" })).toBeInTheDocument();
  });
});
