import type { VscodeWebviewSurfaceKind } from "./protocol";

export type VscodeWebviewSessionBase = {
  documentUri: string;
  surfaceKind: VscodeWebviewSurfaceKind;
};

export type VscodeWebviewSessionRegistryEvent =
  | { type: "set"; session: VscodeWebviewSessionBase }
  | { type: "delete"; session: VscodeWebviewSessionBase };

type VscodeWebviewSessionRegistryListener = (event: VscodeWebviewSessionRegistryEvent) => void;

const sessionRegistryListeners = new Set<VscodeWebviewSessionRegistryListener>();

export const onVscodeWebviewSessionRegistryEvent = (
  listener: VscodeWebviewSessionRegistryListener
): (() => void) => {
  sessionRegistryListeners.add(listener);
  return () => sessionRegistryListeners.delete(listener);
};

const publishSessionRegistryEvent = (event: VscodeWebviewSessionRegistryEvent): void => {
  for (const listener of sessionRegistryListeners) listener(event);
};

export const vscodeWebviewSessionKey = (
  documentUri: string,
  surfaceKind: VscodeWebviewSurfaceKind
): string => JSON.stringify([documentUri, surfaceKind]);

export class VscodeWebviewSessionRegistry<T extends VscodeWebviewSessionBase> {
  private readonly byKey = new Map<string, T>();

  get<K extends VscodeWebviewSurfaceKind>(
    documentUri: string,
    surfaceKind: K
  ): Extract<T, { surfaceKind: K }> | undefined {
    return this.byKey.get(vscodeWebviewSessionKey(documentUri, surfaceKind)) as Extract<T, { surfaceKind: K }> | undefined;
  }

  set(session: T): void {
    const key = vscodeWebviewSessionKey(session.documentUri, session.surfaceKind);
    const previous = this.byKey.get(key);
    if (previous === session) return;
    if (previous) publishSessionRegistryEvent({ type: "delete", session: previous });
    this.byKey.set(key, session);
    publishSessionRegistryEvent({ type: "set", session });
  }

  delete(documentUri: string, surfaceKind: VscodeWebviewSurfaceKind): boolean {
    const key = vscodeWebviewSessionKey(documentUri, surfaceKind);
    const session = this.byKey.get(key);
    if (!session) return false;
    const deleted = this.byKey.delete(key);
    if (deleted) publishSessionRegistryEvent({ type: "delete", session });
    return deleted;
  }

  forDocument(documentUri: string): T[] {
    return [...this.byKey.values()].filter((session) => session.documentUri === documentUri);
  }

  values(): IterableIterator<T> {
    return this.byKey.values();
  }

  valuesForSurface<K extends VscodeWebviewSurfaceKind>(surfaceKind: K): Extract<T, { surfaceKind: K }>[] {
    return [...this.byKey.values()].filter((session) => session.surfaceKind === surfaceKind) as Extract<T, { surfaceKind: K }>[];
  }

  clear(): void {
    const sessions = [...this.byKey.values()];
    this.byKey.clear();
    for (const session of sessions) publishSessionRegistryEvent({ type: "delete", session });
  }
}
