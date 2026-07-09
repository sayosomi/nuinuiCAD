import { defaultDocumentPalette } from "../palette/palette";
import { resolveElementName } from "../model/elementNames";
import { DEFAULT_VISIBILITY_PROFILE_ID, defaultVisibilityProfile } from "../model/visibilityProfiles";
import type {
  CadElement,
  CadElementType,
  DocumentPalette,
  ElementId,
  NumericVariable,
  PrintLayout,
  VisibilityProfile,
  VisibilityRole
} from "../types/geometry";
import { compileDslToElements } from "./dslCompiler";
import { formatNumericValueForDsl, shortestDslTokensById } from "./dslExpressionFormat";
import { parseDsl } from "./dslParser";
import {
  documentDslRefs,
  serializeElementStatement,
  serializeVisibilitySettingsLines,
  type DslSerializerRefs
} from "./dslSerializer";
import type { DslDiagnostic } from "./dslTypes";
import { DSL_INDENT, formatDslName, quoteDslString } from "./dslTokens";

// `nui 1` を先頭に持つ、文書全体を無損失に表すDSLテキストへの変換ファサード。
// 保存形式はまだJSON(Phase 1d以降で `.nui` に切り替え)。ここではテキスト
// ⇄ 構造化データの往復のみを扱い、ストア・UI・保存形式には触れない。

export type DslDocumentData = {
  elements: CadElement[];
  palette: DocumentPalette;
  visibilityRoles: VisibilityRole[];
  visibilityProfiles: VisibilityProfile[];
  activeVisibilityProfileId: string;
  printLayouts: PrintLayout[];
  activePrintLayoutId: string;
  evaluationLimitIndex: number;
};

export type SerializeDslDocumentOptions = {
  headerComment?: string;
};

export type ParseDslDocumentResult = {
  document: DslDocumentData | null;
  diagnostics: DslDiagnostic[];
};

const DSL_VERSION = 1;

const versionDiagnostic = (line: number, message: string): DslDiagnostic => ({
  severity: "error",
  line,
  column: 1,
  message
});

// ==== パレット ====

const serializePaletteLines = (palette: DocumentPalette): string[] =>
  palette.colors.map((color) =>
    [
      "color",
      formatDslName(color.id),
      quoteDslString(color.hex),
      `name=${quoteDslString(color.name)}`,
      ...(color.id === palette.defaultColorId ? ["default"] : [])
    ].join(" ")
  );

// ==== 印刷レイアウト ====

const resolveGroupToken = (elements: CadElement[], groupId: ElementId): string => {
  const target = elements.find((element) => element.id === groupId);
  if (!target || !target.name.trim()) return groupId;
  const resolution = resolveElementName({ token: target.name, elements });
  if (resolution.status === "resolved" && resolution.element.id === groupId) {
    return formatDslName(target.name);
  }
  const qualified = shortestDslTokensById(elements).get(groupId);
  return qualified ? formatDslName(qualified) : groupId;
};

const printLayoutBlockLines = (
  layout: PrintLayout,
  displayName: string,
  elements: CadElement[],
  visibilityProfiles: VisibilityProfile[]
): string[] => {
  const profileName = layout.visibilityProfileId
    ? visibilityProfiles.find((profile) => profile.id === layout.visibilityProfileId)?.name ??
      layout.visibilityProfileId
    : undefined;
  const numeric = (value: Parameters<typeof formatNumericValueForDsl>[0], localVars: NumericVariable[] = []) =>
    formatNumericValueForDsl(value, elements, localVars);

  const header = [
    "printLayout",
    formatDslName(displayName),
    `output=${layout.outputKind}`,
    ...(profileName ? [`view=${formatDslName(profileName)}`] : []),
    `paper=${layout.paperSizeId}`,
    `orientation=${layout.orientation}`,
    `columns=${numeric(layout.columns)}`,
    `rows=${numeric(layout.rows)}`,
    `overlap=${numeric(layout.overlapMm)}`,
    `scale=${numeric(layout.scale)}`,
    `canvas=(${numeric(layout.svgCanvasWidthMm)}, ${numeric(layout.svgCanvasHeightMm)})`,
    "{"
  ].join(" ");

  const localVars = layout.numericVariables ?? [];
  const memberLines: string[] = [];
  for (const variable of localVars) {
    memberLines.push(
      `${DSL_INDENT}layoutVar ${formatDslName(variable.name)} = ${numeric(variable.value, localVars)}`
    );
  }
  for (const placement of layout.placements) {
    memberLines.push(
      [
        `${DSL_INDENT}place`,
        resolveGroupToken(elements, placement.groupId),
        `at=(${numeric(placement.x, localVars)}, ${numeric(placement.y, localVars)})`,
        `angle=${numeric(placement.angleDeg, localVars)}`,
        `mirrorX=${placement.mirrorX}`
      ].join(" ")
    );
  }

  return [header, ...memberLines, "}"];
};

const PRINT_LAYOUT_PROMOTED_NAME_BASE = "レイアウト";

const serializePrintLayoutSection = (data: DslDocumentData): string[] => {
  const { printLayouts, activePrintLayoutId, elements, visibilityProfiles } = data;
  if (printLayouts.length === 0) return [];

  const activeLayout = printLayouts.find((layout) => layout.id === activePrintLayoutId);
  const activeIsFirst = printLayouts[0]?.id === activePrintLayoutId;

  let promotedName: string | undefined;
  if (activeLayout && !activeLayout.name.trim() && !activeIsFirst) {
    const usedNames = new Set(printLayouts.filter((layout) => layout.name.trim()).map((layout) => layout.name.trim()));
    let index = 1;
    while (usedNames.has(`${PRINT_LAYOUT_PROMOTED_NAME_BASE}${index}`)) index += 1;
    promotedName = `${PRINT_LAYOUT_PROMOTED_NAME_BASE}${index}`;
  }

  const lines: string[] = [];
  for (const layout of printLayouts) {
    const displayName = activeLayout && layout.id === activeLayout.id && promotedName ? promotedName : layout.name;
    lines.push(...printLayoutBlockLines(layout, displayName, elements, visibilityProfiles));
  }
  if (activeLayout && !activeIsFirst) {
    lines.push(`activePrintLayout ${formatDslName(promotedName ?? activeLayout.name)}`);
  }
  return lines;
};

// ==== 要素ツリー(ブレースブロック + @stop) ====

type BlockFrame = {
  elementId: ElementId;
  kind: "group" | "conditionalGroup" | "forGroup";
  branch: "then" | "else";
};

const containerKind = (type: CadElementType): BlockFrame["kind"] | null =>
  type === "group" || type === "conditionalGroup" || type === "forGroup" ? type : null;

const serializeElementTree = (
  elements: CadElement[],
  refs: DslSerializerRefs,
  evaluationLimitIndex: number
): string[] => {
  const lines: string[] = [];
  const stack: BlockFrame[] = [];
  const limit = Math.max(0, Math.min(evaluationLimitIndex, elements.length));
  let emitted = 0;

  const closeTo = (depth: number) => {
    while (stack.length > depth) {
      lines.push(`${DSL_INDENT.repeat(stack.length - 1)}}`);
      stack.pop();
    }
  };

  for (const element of elements) {
    if (emitted === limit) {
      lines.push(`${DSL_INDENT.repeat(stack.length)}@stop`);
    }

    const parentId = element.parentGroupId;
    const desiredBranch: "then" | "else" = element.conditionalBranch === "else" ? "else" : "then";
    const targetIdx = parentId ? stack.findIndex((frame) => frame.elementId === parentId) : -1;

    // 非連続な親子配置(並べ替え禁止の帰結として通常のブロック表現が
    // 不可能な場合)は、過渡期のフォールバックとして parent=/branch=
    // 属性付きのトップレベル文で無損失に出力する。Phase 1c以降は
    // テキストが正準になりブレースが構造を強制するため、この分岐へは
    // 到達しなくなる想定(Phase 5で `parent=` パース受理ごと削除)。
    let fallback = Boolean(parentId) && targetIdx === -1;
    if (!fallback && targetIdx >= 0) {
      const top = stack[targetIdx];
      if (top.kind === "conditionalGroup" && top.branch === "else" && desiredBranch === "then") {
        fallback = true;
      }
    }

    if (fallback) {
      closeTo(0);
      const parentToken = formatDslName(refs.token(parentId!, element));
      const branchSuffix = element.conditionalBranch === "else" ? " branch=else" : "";
      lines.push(`${serializeElementStatement(element, refs)} parent=${parentToken}${branchSuffix}`);
    } else {
      closeTo(targetIdx + 1);
      if (targetIdx >= 0) {
        const top = stack[targetIdx];
        if (top.kind === "conditionalGroup" && top.branch === "then" && desiredBranch === "else") {
          lines.push(`${DSL_INDENT.repeat(targetIdx)}} else {`);
          top.branch = "else";
        }
      }
      const kind = containerKind(element.type);
      lines.push(
        `${DSL_INDENT.repeat(stack.length)}${serializeElementStatement(element, refs)}${kind ? " {" : ""}`
      );
      if (kind) stack.push({ elementId: element.id, kind, branch: "then" });
    }

    emitted += 1;
  }

  closeTo(0);
  return lines;
};

// ==== ファサード ====

export const serializeDocumentToDsl = (
  data: DslDocumentData,
  options: SerializeDslDocumentOptions = {}
): string => {
  const refs = documentDslRefs(data.elements);
  const sections: string[][] = [
    [`nui ${DSL_VERSION}`, ...(options.headerComment ? [`# ${options.headerComment}`] : [])],
    serializePaletteLines(data.palette),
    serializeVisibilitySettingsLines(data.visibilityRoles, data.visibilityProfiles, data.activeVisibilityProfileId),
    serializePrintLayoutSection(data),
    serializeElementTree(data.elements, refs, data.evaluationLimitIndex)
  ];
  return sections
    .filter((section) => section.length > 0)
    .map((section) => section.join("\n"))
    .join("\n\n");
};

export const parseDslDocument = (source: string): ParseDslDocumentResult => {
  const normalized = source.replace(/\r\n/g, "\n");
  const parsed = parseDsl(normalized);

  const diagnostics: DslDiagnostic[] = [];
  const versionStatements = parsed.statements.filter((statement) => statement.kind === "version");
  const firstStatement = parsed.statements[0];

  if (!firstStatement) {
    diagnostics.push(versionDiagnostic(1, "文書が空です。先頭に `nui 1` が必要です。"));
  } else if (firstStatement.kind !== "version") {
    diagnostics.push(versionDiagnostic(firstStatement.line, "文書の先頭は `nui <バージョン>` である必要があります。"));
  } else {
    const value = Number(firstStatement.value.trim());
    if (!Number.isInteger(value) || value <= 0) {
      diagnostics.push(versionDiagnostic(firstStatement.line, `不正なDSLバージョンです: ${firstStatement.value}`));
    } else if (value !== DSL_VERSION) {
      diagnostics.push(
        versionDiagnostic(firstStatement.line, `未対応のDSLバージョンです: ${value}(対応: ${DSL_VERSION})`)
      );
    }
  }
  for (const extra of versionStatements.slice(1)) {
    diagnostics.push(versionDiagnostic(extra.line, "`nui` は文書の先頭に1つだけ書けます。"));
  }

  const compiled = compileDslToElements(normalized, { elements: [], mode: "document" });
  const allDiagnostics = [...diagnostics, ...compiled.diagnostics];

  if (allDiagnostics.some((item) => item.severity === "error")) {
    return { document: null, diagnostics: allDiagnostics };
  }

  const visibilityProfiles = compiled.visibilityProfiles?.length
    ? compiled.visibilityProfiles
    : [defaultVisibilityProfile()];
  const printLayouts = compiled.printLayouts ?? [];

  const document: DslDocumentData = {
    elements: compiled.elements,
    palette: compiled.palette ?? defaultDocumentPalette(),
    visibilityRoles: compiled.visibilityRoles ?? [],
    visibilityProfiles,
    activeVisibilityProfileId:
      compiled.activeVisibilityProfileId ?? visibilityProfiles[0]?.id ?? DEFAULT_VISIBILITY_PROFILE_ID,
    printLayouts,
    activePrintLayoutId: compiled.activePrintLayoutId ?? printLayouts[0]?.id ?? "",
    evaluationLimitIndex: compiled.evaluationLimitIndex ?? compiled.elements.length
  };

  return { document, diagnostics: allDiagnostics };
};
