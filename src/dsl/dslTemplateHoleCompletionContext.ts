// Pure, catalog-free template hole completion context (Task 39). Detects
// whether the cursor sits inside an in-progress (not yet closed) `{...}`
// hole of a `label(text: "...")` value and, if so, the hole's content span -
// nothing more. See docs/typed-variables/tasks/39-typed-value-completion.md
// and docs/typed-variables/tasks/26-text-template-analysis.md.
//
// Reuses Task 26's own scanTextTemplateLiteral unmodified, bounding the scan
// to end exactly at the cursor (never at the value's real closing quote):
// an in-progress hole is, by construction, not yet closed within that
// bounded range, so the scanner reports it as its own
// "unterminated-interpolation" error - precisely the signal this module
// needs, with no new scanning logic and no possibility of drifting from
// Task 26's escape/brace rules (`\{`/`\}` literal handling, one-hole-deep
// nesting rejection, etc. all still apply exactly as scanned).

import { scanTextTemplateLiteral } from "../scalars/textTemplateScan";
import type { DslSpan } from "./dslTypes";

/**
 * `valueSpan` is the label element's already-resolved `text:` value span
 * (quotes included) - this function does not re-scan for it. Returns the raw
 * span of the open hole's inner content (excluding the braces) when `pos` is
 * inside one, or `null` when `pos` is in plain literal text, outside the
 * value entirely, or the scan hits any other error (a genuinely malformed
 * string/hole up to this point - nothing useful to complete there).
 */
export const templateHoleContentSpanAt = (lineText: string, valueSpan: DslSpan, pos: number): DslSpan | null => {
  if (pos < valueSpan.start || pos > valueSpan.end) return null;
  const scan = scanTextTemplateLiteral(lineText, { start: valueSpan.start, end: pos });
  if (scan.kind !== "error" || scan.issueCode !== "unterminated-interpolation" || scan.span.end !== pos) return null;
  return { start: scan.span.start + 1, end: pos };
};
