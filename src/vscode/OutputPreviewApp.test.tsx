import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { OutputPreviewApp } from "./OutputPreviewApp";
import type { VscodeWebviewApi } from "./protocol";

const api: VscodeWebviewApi = { postMessage: vi.fn() };

describe("Output Preview application", () => {
  afterEach(() => {
    cleanup();
    useCadDocumentStore.setState(initialCadDocumentState());
    vi.mocked(api.postMessage).mockReset();
  });

  it("opens with an explicit empty state when there are no current outputs", () => {
    useCadDocumentStore.setState(initialCadDocumentState());

    render(<OutputPreviewApp api={api} />);

    expect(screen.getByRole("status")).toHaveTextContent("No print or SVG outputs");
    expect(api.postMessage).toHaveBeenCalledWith({ type: "webviewReady" });
  });

  it("shows current-source errors instead of stale last-good output", () => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadDocumentStore.getState().commitText("nui 4\npoint A = coordinate(", "test");

    render(<OutputPreviewApp api={api} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Output Preview unavailable");
  });
});
