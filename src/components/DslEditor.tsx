import { useMemo, useRef } from "react";
import type { RefObject } from "react";
import type { UIEvent } from "react";
import type { DslExportOrigin } from "../dsl/dslDependencyClosure";
import { highlightDslSource } from "../dsl/dslHighlight";

type DslEditorProps = {
  source: string;
  onSourceChange: (source: string) => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
};

type LineMeta = {
  origin: DslExportOrigin | null;
  warnings: string[];
};

const exportCommentPattern =
  /^#\s*@dsl-export:\s*(selected|group-content|parent|dependency)(?:\s+warning=([a-z,-]+))?/;

const lineMetaForSource = (source: string): LineMeta[] => {
  let pending: LineMeta | null = null;
  return source.split(/\r?\n/).map((line) => {
    const match = line.match(exportCommentPattern);
    if (match) {
      pending = {
        origin: match[1] as DslExportOrigin,
        warnings: match[2]?.split(",").filter(Boolean) ?? []
      };
      return pending;
    }
    if (pending && line.trim()) {
      const meta = pending;
      pending = null;
      return meta;
    }
    return { origin: null, warnings: [] };
  });
};

const lineClassName = (meta: LineMeta) =>
  [
    "dsl-highlight-line",
    meta.origin ? `dsl-export-${meta.origin}` : "",
    ...meta.warnings.map((warning) => `dsl-export-warning-${warning}`)
  ].filter(Boolean).join(" ");

export const DslEditor = ({ source, onSourceChange, textareaRef }: DslEditorProps) => {
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const lines = useMemo(() => highlightDslSource(source), [source]);
  const lineMeta = useMemo(() => lineMetaForSource(source), [source]);

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
          <span className={lineClassName(lineMeta[line.lineNumber - 1])} key={line.lineNumber}>
            {line.lineNumber}
          </span>
        ))}
      </div>
      <div className="dsl-code-layer">
        <pre ref={highlightRef} className="dsl-highlight" aria-hidden="true">
          {lines.map((line) => (
            <span className={lineClassName(lineMeta[line.lineNumber - 1])} key={line.lineNumber}>
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
