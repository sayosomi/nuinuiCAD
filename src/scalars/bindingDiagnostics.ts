// Formats BindingAnalysis issues into human-readable messages. This module
// never computes new analysis data (spans, related ids, codes) - it only
// resolves binding names via `analysis.catalog` and builds message strings.
// See docs/typed-variables/tasks/13-binding-diagnostics-initializer-graph.md.

import type { DslSpan } from "../dsl/dslTypes";
import type { BindingId } from "./bindingCatalog";
import type { BindingAnalysis, BindingIssue, BindingIssueCode } from "./bindingAnalysis";

export type BindingDiagnosticMessage = {
  code: BindingIssueCode;
  bindingId: BindingId;
  span: DslSpan | null;
  message: string;
  /** `issue.relatedBindingIds` resolved to names, excluding the issue's own binding. */
  relatedBindingNames: readonly string[];
};

const nameOf = (analysis: BindingAnalysis, id: BindingId): string => analysis.catalog.bindingsById.get(id)?.name ?? id;

const relatedNamesExcludingSelf = (analysis: BindingAnalysis, issue: BindingIssue): readonly string[] =>
  issue.relatedBindingIds.filter((id) => id !== issue.bindingId).map((id) => nameOf(analysis, id));

const messageFor = (analysis: BindingAnalysis, issue: BindingIssue): string => {
  switch (issue.code) {
    case "duplicate-binding": {
      if (issue.origin.kind === "declaration") {
        return `"${nameOf(analysis, issue.bindingId)}" は同じスコープ内で複数回宣言されています。`;
      }
      return `"${issue.origin.reference.name}" は複数の宣言と一致するため一意に解決できません。`;
    }
    case "binding-cycle": {
      const name = nameOf(analysis, issue.bindingId);
      const cycleNames = issue.relatedBindingIds.map((id) => nameOf(analysis, id));
      return cycleNames.length > 1
        ? `"${name}" は循環参照しています: ${cycleNames.join(" → ")}`
        : `"${name}" は自身の初期化チェーンを通じて自分自身を参照しています。`;
    }
    case "self-initialization":
      return `"${nameOf(analysis, issue.bindingId)}" は自身の初期化式内で自分自身を参照していますが、外側に同名のbindingがありません。`;
    case "undefined-binding": {
      const referencedName = issue.origin.kind === "reference" ? issue.origin.reference.name : nameOf(analysis, issue.bindingId);
      return `未定義の変数 "${referencedName}" を参照しています。`;
    }
    case "forward-binding-reference": {
      const referencedName = issue.origin.kind === "reference" ? issue.origin.reference.name : nameOf(analysis, issue.bindingId);
      return `"${referencedName}" はこの位置より後で宣言されているため、まだ参照できません。`;
    }
  }
};

export const formatBindingIssue = (analysis: BindingAnalysis, issue: BindingIssue): BindingDiagnosticMessage => ({
  code: issue.code,
  bindingId: issue.bindingId,
  span: issue.span,
  message: messageFor(analysis, issue),
  relatedBindingNames: relatedNamesExcludingSelf(analysis, issue)
});

export const buildBindingDiagnosticMessages = (analysis: BindingAnalysis): readonly BindingDiagnosticMessage[] =>
  analysis.issues.map((issue) => formatBindingIssue(analysis, issue));
