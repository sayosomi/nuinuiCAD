import { useMemo, useRef } from "react";
import type { RefObject } from "react";
import type { UIEvent } from "react";
import { highlightDslSource } from "../dsl/dslHighlight";

type DslEditorProps = {
  source: string;
  onSourceChange: (source: string) => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
};

export const DslEditor = ({ source, onSourceChange, textareaRef }: DslEditorProps) => {
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const lines = useMemo(() => highlightDslSource(source), [source]);

  const syncScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    const { scrollLeft, scrollTop } = event.currentTarget;
    if (highlightRef.current) {
      highlightRef.current.scrollLeft = scrollLeft;
      highlightRef.current.scrollTop = scrollTop;
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = scrollTop;
    }
  };

  return (
    <div className="dsl-editor-shell">
      <div ref={gutterRef} className="dsl-line-numbers" aria-hidden="true">
        {lines.map((line) => (
          <span key={line.lineNumber}>{line.lineNumber}</span>
        ))}
      </div>
      <div className="dsl-code-layer">
        <pre ref={highlightRef} className="dsl-highlight" aria-hidden="true">
          {lines.map((line) => (
            <span className="dsl-highlight-line" key={line.lineNumber}>
              {line.tokens.map((token, index) => (
                <span className={`dsl-token-${token.kind}`} key={`${line.lineNumber}-${index}`}>
                  {token.text}
                </span>
              ))}
              {"\n"}
            </span>
          ))}
        </pre>
        <textarea
          ref={textareaRef}
          className="dsl-editor-input"
          value={source}
          spellCheck={false}
          onChange={(event) => onSourceChange(event.currentTarget.value)}
          onScroll={syncScroll}
          aria-label="DSLソース"
        />
      </div>
    </div>
  );
};
