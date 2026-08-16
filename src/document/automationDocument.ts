import {
  compileCanonicalText,
  compileFreshCanonicalText,
  type CanonicalDocumentValue,
  type TextCompileResult
} from "./canonicalDocument";

export type AutomationDocumentState = CanonicalDocumentValue & {
  revision: number;
  compiledRevision: number;
  status: TextCompileResult["status"];
};

export class AutomationDocument {
  private state: AutomationDocumentState;

  private constructor(state: AutomationDocumentState) {
    this.state = state;
  }

  static fromSource(sourceText: string): AutomationDocument {
    const compiled = compileFreshCanonicalText(sourceText);
    return new AutomationDocument({
      ...compiled,
      revision: 0,
      compiledRevision: 0
    });
  }

  getSource(): string {
    return this.state.sourceText;
  }

  getState(): AutomationDocumentState {
    return this.state;
  }

  replaceSource(nextSource: string): void {
    if (nextSource === this.state.sourceText) return;

    const previous = this.state;
    const compiled = compileCanonicalText(previous, nextSource);
    this.state = {
      ...compiled,
      revision: previous.revision + 1,
      compiledRevision:
        compiled.doc === previous.doc
          ? previous.compiledRevision
          : previous.compiledRevision + 1
    };
  }
}
