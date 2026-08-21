import type { VscodeWebviewSurfaceKind } from "./protocol";

export type VscodeWebviewSessionBase = {
  documentUri: string;
  surfaceKind: VscodeWebviewSurfaceKind;
};

export const vscodeWebviewSessionKey = (
  documentUri: string,
  surfaceKind: VscodeWebviewSurfaceKind
): string => JSON.stringify([documentUri, surfaceKind]);

export class VscodeWebviewSessionRegistry<T extends VscodeWebviewSessionBase> {
  private readonly byKey = new Map<string, T>();

  get(documentUri: string, surfaceKind: VscodeWebviewSurfaceKind): T | undefined {
    return this.byKey.get(vscodeWebviewSessionKey(documentUri, surfaceKind));
  }

  set(session: T): void {
    this.byKey.set(vscodeWebviewSessionKey(session.documentUri, session.surfaceKind), session);
  }

  delete(documentUri: string, surfaceKind: VscodeWebviewSurfaceKind): boolean {
    return this.byKey.delete(vscodeWebviewSessionKey(documentUri, surfaceKind));
  }

  forDocument(documentUri: string): T[] {
    return [...this.byKey.values()].filter((session) => session.documentUri === documentUri);
  }

  values(): IterableIterator<T> {
    return this.byKey.values();
  }

  valuesForSurface(surfaceKind: VscodeWebviewSurfaceKind): T[] {
    return [...this.byKey.values()].filter((session) => session.surfaceKind === surfaceKind);
  }

  clear(): void {
    this.byKey.clear();
  }
}
