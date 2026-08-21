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

  get<K extends VscodeWebviewSurfaceKind>(
    documentUri: string,
    surfaceKind: K
  ): Extract<T, { surfaceKind: K }> | undefined {
    return this.byKey.get(vscodeWebviewSessionKey(documentUri, surfaceKind)) as Extract<T, { surfaceKind: K }> | undefined;
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

  valuesForSurface<K extends VscodeWebviewSurfaceKind>(surfaceKind: K): Extract<T, { surfaceKind: K }>[] {
    return [...this.byKey.values()].filter((session) => session.surfaceKind === surfaceKind) as Extract<T, { surfaceKind: K }>[];
  }

  clear(): void {
    this.byKey.clear();
  }
}
