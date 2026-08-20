import { useSyncExternalStore } from "react";
import {
  initialCadDocumentState,
  useCadDocumentStore
} from "./cadDocumentStore";
import type { CadDocumentState } from "./cadDocumentStore";
import {
  initialCadUiState,
  useCadUiStore
} from "./cadUiStore";
import type { CadUiState } from "./cadUiStore";

export type {
  ActiveLinePickTarget,
  ActiveNumericReferencePickTarget,
  ActivePickCursor,
  ActivePointPickTarget,
  CanvasViewport
} from "./cadUiStore";
export {
  DEFAULT_CANVAS_VIEWPORT,
  MAX_CANVAS_ZOOM,
  MIN_CANVAS_ZOOM,
  useCadUiStore
} from "./cadUiStore";
export type { CadDocumentState } from "./cadDocumentStore";
export { useCadDocumentStore } from "./cadDocumentStore";

export type CadState = CadDocumentState & CadUiState;

const splitState = (partial: Partial<CadState>) => {
  const documentState: Partial<CadDocumentState> = {};
  const uiState: Partial<CadUiState> = {};
  const documentKeys = new Set(Object.keys(initialCadDocumentState()));
  const uiKeys = new Set(Object.keys(initialCadUiState()));

  for (const [key, value] of Object.entries(partial)) {
    if (documentKeys.has(key)) {
      Object.assign(documentState, { [key]: value });
    }
    if (uiKeys.has(key)) {
      Object.assign(uiState, { [key]: value });
    }
  }

  return { documentState, uiState };
};

const facadeActions = {
  setSelectedElementId: (id: Parameters<CadUiState["setSelectedElementId"]>[0]) => {
    useCadUiStore.getState().setSelectedElementId(id);
    useCadUiStore.getState().clearPickMode();
  },
  setSelectedElementIds: (
    ids: Parameters<CadUiState["setSelectedElementIds"]>[0],
    primaryId?: Parameters<CadUiState["setSelectedElementIds"]>[1]
  ) => {
    useCadUiStore.getState().setSelectedElementIds(ids, primaryId);
    useCadUiStore.getState().clearPickMode();
  },
  setSelectedElementRange: (
    anchorId: Parameters<CadUiState["setSelectedElementRange"]>[0],
    targetId: Parameters<CadUiState["setSelectedElementRange"]>[1]
  ) => {
    useCadUiStore.getState().setSelectedElementRange(anchorId, targetId);
    useCadUiStore.getState().clearPickMode();
  },
};

const mergedState = (): CadState => ({
  ...useCadDocumentStore.getState(),
  ...useCadUiStore.getState(),
  ...facadeActions
});

const subscribe = (listener: () => void) => {
  const unsubscribeDocument = useCadDocumentStore.subscribe(listener);
  const unsubscribeUi = useCadUiStore.subscribe(listener);
  return () => {
    unsubscribeDocument();
    unsubscribeUi();
  };
};

type CadStoreFacade = {
  <T>(selector: (state: CadState) => T): T;
  getState: () => CadState;
  setState: (partial: Partial<CadState> | ((state: CadState) => Partial<CadState>)) => void;
  subscribe: (listener: () => void) => () => void;
};

const useCadStoreHook = <T,>(selector: (state: CadState) => T): T =>
  useSyncExternalStore(
    subscribe,
    () => selector(mergedState()),
    () => selector(mergedState())
  );

export const useCadStore = Object.assign(useCadStoreHook, {
  getState: mergedState,
  setState: (partial: Partial<CadState> | ((state: CadState) => Partial<CadState>)) => {
    const nextPartial = typeof partial === "function" ? partial(mergedState()) : partial;
    const { documentState, uiState } = splitState(nextPartial);

    if (Object.keys(documentState).length > 0) {
      useCadDocumentStore.setState(documentState);
    }
    if (Object.keys(uiState).length > 0) {
      useCadUiStore.setState(uiState);
    }
  },
  subscribe
}) satisfies CadStoreFacade;
