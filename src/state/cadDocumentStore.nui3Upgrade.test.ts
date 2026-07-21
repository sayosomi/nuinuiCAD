import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setElementActivity } from "../commands/selectionCommands";
import { registerSourceEditSession } from "../editor/sourceEditSession";
import { initialCadDocumentState, useCadDocumentStore } from "./cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "./cadUiStore";

describe("cadDocumentStore upgradeDslMajorVersion", () => {
  let unregister = () => {};

  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
  });

  afterEach(() => unregister());

  it("splices only the header digit for an LF document and produces exactly one Undo step", () => {
    const source = "nui 2\npoint A = coordinate(x: 0 y: 0)";
    useCadDocumentStore.getState().commitText(source, "test");
    const pastBeforeLength = useCadDocumentStore.getState().past.length;

    const result = useCadDocumentStore.getState().upgradeDslMajorVersion(3);

    expect(result).toEqual({ status: "applied" });
    const state = useCadDocumentStore.getState();
    expect(state.sourceText).toBe("nui 3\npoint A = coordinate(x: 0 y: 0)");
    expect(state.past.length).toBe(pastBeforeLength + 1);
    expect(useCadUiStore.getState().commandErrorMessage).toBeNull();

    useCadDocumentStore.getState().undo();
    expect(useCadDocumentStore.getState().sourceText).toBe(source);
  });

  it("preserves CRLF line endings and BOM/leading-comment bytes exactly", () => {
    const source = "﻿# keep this\r\nnui 2\r\npoint A = coordinate(x: 0 y: 0)\r\n";
    useCadDocumentStore.getState().commitText(source, "test");

    const result = useCadDocumentStore.getState().upgradeDslMajorVersion(3);

    expect(result).toEqual({ status: "applied" });
    expect(useCadDocumentStore.getState().sourceText).toBe(
      "﻿# keep this\r\nnui 3\r\npoint A = coordinate(x: 0 y: 0)\r\n"
    );
  });

  it("compiles and evaluates identically under nui 3 for legacy var/activity syntax", () => {
    const source = "nui 2\nvar Global = 12\npoint A = coordinate(x: 0 y: 0 visible: false)";
    useCadDocumentStore.getState().commitText(source, "test");

    useCadDocumentStore.getState().upgradeDslMajorVersion(3);

    const state = useCadDocumentStore.getState();
    expect(state.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(state.elements).toMatchObject([
      { name: "Global", type: "variable" },
      { name: "A", type: "freePoint", x: 0, y: 0 }
    ]);
  });

  it("is a silent no-op with no command error message when already nui 3", () => {
    useCadDocumentStore.getState().commitText("nui 2\npoint A = coordinate(x: 0 y: 0)", "test");
    useCadDocumentStore.getState().upgradeDslMajorVersion(3);
    const pastAfterUpgrade = useCadDocumentStore.getState().past.length;

    const result = useCadDocumentStore.getState().upgradeDslMajorVersion(3);

    expect(result).toEqual({ status: "noop" });
    expect(useCadDocumentStore.getState().past.length).toBe(pastAfterUpgrade);
    expect(useCadUiStore.getState().commandErrorMessage).toBeNull();
  });

  it("still upgrades the header when an unrelated element statement elsewhere is fatal", () => {
    const source = [
      "nui 2",
      "point A = coordinate(x: 0 y: 0)",
      "point B = coordinate(x: 10 y: 0)",
      "point Both = between(start: A end: B distance: 4 ratio: 0.25)"
    ].join("\n");
    useCadDocumentStore.getState().commitText(source, "test");
    expect(useCadDocumentStore.getState().docText).not.toBe(useCadDocumentStore.getState().sourceText);

    const result = useCadDocumentStore.getState().upgradeDslMajorVersion(3);

    expect(result).toEqual({ status: "applied" });
    const state = useCadDocumentStore.getState();
    expect(state.sourceText).toBe(source.replace("nui 2", "nui 3"));
    expect(state.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(true);
  });

  it("rejects with a message when the header itself is malformed", () => {
    useCadDocumentStore.getState().commitText("not a header\npoint A = coordinate(x: 0 y: 0)", "test");
    expect(useCadDocumentStore.getState().sourceText).toBe("not a header\npoint A = coordinate(x: 0 y: 0)");

    const result = useCadDocumentStore.getState().upgradeDslMajorVersion(3);

    expect(result).toEqual({ status: "rejected", reason: "unrecognized-header" });
    expect(useCadUiStore.getState().commandErrorMessage).toContain("nui <バージョン>");
  });

  it("rejects with the IME-guard message while composition is in progress, without touching sourceText", () => {
    const before = useCadDocumentStore.getState().sourceText;
    const flush = vi.fn(() => "blocked-composition" as const);
    unregister = registerSourceEditSession({
      hasPendingText: () => true,
      isComposing: () => true,
      flush
    });

    const result = useCadDocumentStore.getState().upgradeDslMajorVersion(3);

    expect(flush).toHaveBeenCalledWith("command");
    expect(result).toEqual({ status: "rejected", reason: "composition" });
    expect(useCadDocumentStore.getState().sourceText).toBe(before);
    expect(useCadUiStore.getState().commandErrorMessage).toContain("日本語入力");
  });
});

describe("cadDocumentStore v3 state: serialization", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
  });

  it("regenerates the changed statement as state: when an activity command runs on a nui 3 document", () => {
    useCadDocumentStore.getState().commitText("nui 3\npoint A = coordinate(x: 0 y: 0)", "test");
    const elementId = useCadDocumentStore.getState().elements[0].id;

    setElementActivity(elementId, "hidden");

    const state = useCadDocumentStore.getState();
    expect(state.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(state.sourceText).toContain("state: hidden");
    expect(state.sourceText).not.toContain("visible:");
    expect(state.sourceText).not.toContain("enabled:");
  });

  it("leaves a hand-written state: byte-for-byte on open, without normalizing", () => {
    const source = "nui 3\npoint A = coordinate(x: 0 y: 0 state: hidden)";
    useCadDocumentStore.getState().commitText(source, "test");

    const state = useCadDocumentStore.getState();
    expect(state.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(state.sourceText).toBe(source);
  });
});
