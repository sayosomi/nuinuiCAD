import { describe, expect, it, vi } from "vitest";

import {
  handoffOutputPreviewHistory,
  type OutputPreviewHistoryHandoff
} from "./outputPreviewHistory";

const handoffFor = (overrides: Partial<OutputPreviewHistoryHandoff> = {}) => {
  let current = true;
  let active = true;
  let open = true;
  let version = 7;
  const calls: string[] = [];
  const handoff: OutputPreviewHistoryHandoff = {
    isSessionCurrent: () => current,
    isPanelActive: () => active,
    isDocumentOpen: () => open,
    documentVersion: () => version,
    activateMatchingSource: vi.fn(async () => {
      calls.push("activate-source");
      return true;
    }),
    executeNativeHistory: vi.fn(async (direction) => {
      calls.push(`native-${direction}`);
    }),
    restorePreviewFocus: vi.fn(() => {
      calls.push("restore-preview");
    }),
    ...overrides
  };
  return {
    handoff,
    calls,
    setCurrent: (value: boolean) => { current = value; },
    setVersion: (value: number) => { version = value; }
  };
};

describe("Output Preview native history handoff", () => {
  it("activates the matching source, executes native Undo, then restores Preview focus", async () => {
    const fixture = handoffFor();

    await handoffOutputPreviewHistory("undo", fixture.handoff);

    expect(fixture.calls).toEqual(["activate-source", "native-undo", "restore-preview"]);
  });

  it("passes Redo through the same native history path", async () => {
    const fixture = handoffFor();

    await handoffOutputPreviewHistory("redo", fixture.handoff);

    expect(fixture.calls).toEqual(["activate-source", "native-redo", "restore-preview"]);
  });

  it("fails closed before source activation for an inactive or stale Preview session", async () => {
    const inactive = handoffFor({ isPanelActive: () => false });
    await handoffOutputPreviewHistory("undo", inactive.handoff);
    expect(inactive.calls).toEqual([]);

    const stale = handoffFor({ isSessionCurrent: () => false });
    await handoffOutputPreviewHistory("undo", stale.handoff);
    expect(stale.calls).toEqual([]);

    const closed = handoffFor({ isDocumentOpen: () => false });
    await handoffOutputPreviewHistory("undo", closed.handoff);
    expect(closed.calls).toEqual([]);
  });

  it("does not execute native history when no matching source editor can be activated", async () => {
    const fixture = handoffFor({ activateMatchingSource: vi.fn(async () => false) });

    await handoffOutputPreviewHistory("undo", fixture.handoff);

    expect(fixture.handoff.executeNativeHistory).not.toHaveBeenCalled();
    expect(fixture.handoff.restorePreviewFocus).toHaveBeenCalledTimes(1);
  });

  it("restores the still-live Preview when source activation fails", async () => {
    const fixture = handoffFor({
      activateMatchingSource: vi.fn(async () => {
        throw new Error("source activation failed");
      })
    });

    await handoffOutputPreviewHistory("undo", fixture.handoff);

    expect(fixture.handoff.executeNativeHistory).not.toHaveBeenCalled();
    expect(fixture.handoff.restorePreviewFocus).toHaveBeenCalledTimes(1);
  });

  it("refuses a version change during focus handoff and returns to the still-live Preview", async () => {
    const fixture = handoffFor();
    fixture.handoff.activateMatchingSource = vi.fn(async () => {
      fixture.calls.push("activate-source");
      fixture.setVersion(8);
      return true;
    });

    await handoffOutputPreviewHistory("undo", fixture.handoff);

    expect(fixture.calls).toEqual(["activate-source", "restore-preview"]);
    expect(fixture.handoff.executeNativeHistory).not.toHaveBeenCalled();
  });

  it("does not resurrect a Preview disposed while the source is being activated", async () => {
    const fixture = handoffFor();
    fixture.handoff.activateMatchingSource = vi.fn(async () => {
      fixture.calls.push("activate-source");
      fixture.setCurrent(false);
      return true;
    });

    await handoffOutputPreviewHistory("undo", fixture.handoff);

    expect(fixture.calls).toEqual(["activate-source"]);
    expect(fixture.handoff.executeNativeHistory).not.toHaveBeenCalled();
    expect(fixture.handoff.restorePreviewFocus).not.toHaveBeenCalled();
  });

  it("restores Preview focus after a native history failure when the session is still valid", async () => {
    const fixture = handoffFor({
      executeNativeHistory: vi.fn(async () => {
        throw new Error("native history failed");
      })
    });

    await handoffOutputPreviewHistory("undo", fixture.handoff);

    expect(fixture.handoff.restorePreviewFocus).toHaveBeenCalledTimes(1);
  });
});
