import { numericValueExpression } from "../geometry/numericExpressions";
import {
  createElementNameContext,
  elementQualifiedNameParts,
  resolveElementName
} from "../model/elementNames";
import type {
  CadElement,
  ElementId,
  LineEndpointReference,
  NumericValue,
  PointAnchor,
  VisibilityProfile,
  VisibilityRole
} from "../types/geometry";
import { formatNumericValueForDsl } from "./dslExpressionFormat";
import { formatDslReferencePath, formatDslReferenceToken } from "./dslReferenceTokens";
import { serializeElementStatementBlock, type SerializedStatement } from "./dslSerializeElement";
import type { SerializeDslOptions } from "./dslTypes";
import { DSL_INDENT, formatDslName, quoteDslString } from "./dslTokens";
import { NEW_DOCUMENT_DSL_MAJOR_VERSION, type DslMajorVersion } from "./dslVersion";

// 要素→DSL文の変換は、参照の書き方(生ID or 解決可能な名前トークン)を
// DslSerializerRefs として注入する。正準経路(dslDocument.ts の文書グラマーと
// textPatch.ts の行パッチ)は名前トークン解決の documentDslRefs を使う。
// serializeElementsToDsl は生ID参照のフラット書き出しで、現在は決定的な
// 出力が欲しいテストフィクスチャ・ゴールデン比較専用。
export type DslSerializerRefs = {
  token: (id: ElementId, source: CadElement) => string;
  anchor: (value: PointAnchor | null | undefined, source: CadElement) => string;
  endpoint: (value: LineEndpointReference, source: CadElement) => string;
  numeric: (value: NumericValue, source: CadElement) => string;
  name: (element: CadElement) => string;
  includeRecordIds: boolean;
  /** Selects v2 legacy `visible`/`enabled` flags vs. v3 `state:` canonical output. */
  majorVersion: DslMajorVersion;
};

const flatAnchor = (value: PointAnchor | null | undefined) => {
  if (!value) return "none";
  if (value.mode === "reference") return value.pointId;
  if (value.mode === "derived") return `${value.elementId}.${value.pointKey}`;
  return `(${numericValueExpression(value.x)}, ${numericValueExpression(value.y)})`;
};

export const flatRefs = (majorVersion: DslMajorVersion = NEW_DOCUMENT_DSL_MAJOR_VERSION): DslSerializerRefs => ({
  token: (id) => id,
  anchor: (value) => flatAnchor(value),
  endpoint: (value) => `${value.lineId}.${value.endpointKey}`,
  numeric: (value) => numericValueExpression(value),
  name: (element) => formatDslName(element.name || element.id),
  includeRecordIds: true,
  majorVersion
});

// 文書グラマー用: 参照を解決可能な名前トークンで書き、id= / parent= /
// branch= を出力しない(構造は後続のブロックシリアライザが担う)。
// 参照先が無名・消滅している場合は生IDトークンのまま出力し、決して例外を
// 投げない(再パース時に明示的な依存診断になる)。
export const documentDslRefs = (
  elements: CadElement[],
  majorVersion: DslMajorVersion = NEW_DOCUMENT_DSL_MAJOR_VERSION
): DslSerializerRefs => {
  const nameContext = createElementNameContext(elements);
  const elementsById = nameContext.elementsById;
  const token = (id: ElementId, source: CadElement) => {
    const target = elementsById.get(id);
    if (!target || !target.name.trim()) return formatDslReferenceToken(id);
    const resolution = resolveElementName({ token: target.name, elements, currentElement: source, context: nameContext });
    if (resolution.status === "resolved" && resolution.element.id === id) {
      return formatDslName(target.name);
    }
    return formatDslReferencePath({
      absolute: false,
      segments: elementQualifiedNameParts(target, elements, nameContext)
    });
  };
  const numeric = (value: NumericValue, source: CadElement) =>
    formatNumericValueForDsl(value, elements, source.numericVariables ?? [], source, nameContext, majorVersion);
  return {
    token,
    anchor: (value, source) => {
      if (!value) return "none";
      if (value.mode === "reference") return token(value.pointId, source);
      if (value.mode === "derived") return `${token(value.elementId, source)}.${value.pointKey}`;
      return `(${numeric(value.x, source)}, ${numeric(value.y, source)})`;
    },
    endpoint: (value, source) => `${token(value.lineId, source)}.${value.endpointKey}`,
    numeric,
    // 無名要素は名前トークンを一切出力しない(空文字列)。ID
    // フォールバックは「参照される側」(token関数)のみの役割で、
    // 「文自身の名前」には適用しない — さもないと無名要素が
    // 「IDという名前を持つ要素」として再パースされてしまう。
    name: (element) => (element.name.trim() ? formatDslName(element.name) : ""),
    includeRecordIds: false,
    majorVersion
  };
};

/** SerializedStatement を実物理行群へ整形する(header / 引数行 / close)。
 * `indent` は header/close 行の基底インデント。引数行は `indent + DSL_INDENT`。 */
export const serializedStatementLines = (statement: SerializedStatement, indent: string): string[] =>
  statement.close
    ? [
        `${indent}${statement.header}`,
        ...statement.args.map((arg, index) =>
          `${indent}${DSL_INDENT}${arg.text}${statement.argumentSeparator === "comma" && index < statement.args.length - 1 ? "," : ""}`
        ),
        `${indent}${statement.close}`
      ]
    : [`${indent}${statement.header}`];

// 生ID参照のフラット書き出し(決定的な出力が欲しいテストフィクスチャ・
// ゴールデン比較専用)。グループ/if/for のブレース構造(子の入れ子)は
// 出力しない — 階層は id=/parent=/branch= のフラット属性で表現する。
export const serializeElementsToDsl = (
  elements: CadElement[],
  options: SerializeDslOptions = {}
) => {
  // Test-fixture-only helper predating version-aware output; always v2 flat form.
  const refs = flatRefs(NEW_DOCUMENT_DSL_MAJOR_VERSION);
  return [
    ...visibilitySettingsDsl(options),
    ...elements.flatMap((element) => serializedStatementLines(serializeElementStatementBlock(element, refs), ""))
  ].join("\n");
};

// role/view/activeView の行単位シリアライザ。フラット出力
// (visibilitySettingsDsl)・文書グラマー(dslDocument.ts)・行パッチ
// (src/document/textPatch.ts)から共有される。
export const serializeRoleLine = (role: VisibilityRole): string =>
  `role ${formatDslName(role.id)} (name: ${quoteDslString(role.name)})`;

export const serializeViewLine = (
  profile: VisibilityProfile,
  roles: VisibilityRole[],
  majorVersion: DslMajorVersion = NEW_DOCUMENT_DSL_MAJOR_VERSION
): string => {
  const knownRoleIds = new Set(roles.map((role) => role.id));
  const roleArgs = [
    ...roles.map((role) =>
      `${formatDslName(role.id)}: ${profile.roleVisibility[role.id] ?? profile.defaultRoleVisible}`
    ),
    ...Object.entries(profile.roleVisibility)
      .filter(([roleId]) => !knownRoleIds.has(roleId))
      .map(([roleId, visible]) => `${formatDslName(roleId)}: ${visible}`)
  ];
  // トークンは表示名を優先するため、id が表示名から再導出できない場合は
  // 明示的な id: を添えて往復させる(v1 の id= フォールバックと同じ契約)。
  const args = [
    ...(profile.id === profile.name ? [] : [`id: ${formatDslName(profile.id)}`]),
    `default: ${profile.defaultRoleVisible}`,
    ...roleArgs
  ];
  return `view ${formatDslName(profile.name || profile.id)} (${args.join(majorVersion >= 3 ? ", " : " ")})`;
};

export const serializeActiveViewLine = (activeProfileId: string): string =>
  `activeView ${formatDslName(activeProfileId)}`;

export const serializeVisibilitySettingsLines = (
  roles: VisibilityRole[],
  profiles: VisibilityProfile[],
  activeProfileId: string | undefined,
  majorVersion: DslMajorVersion = NEW_DOCUMENT_DSL_MAJOR_VERSION
): string[] => [
  ...roles.map(serializeRoleLine),
  ...profiles.map((profile) => serializeViewLine(profile, roles, majorVersion)),
  ...(activeProfileId ? [serializeActiveViewLine(activeProfileId)] : [])
];

const visibilitySettingsDsl = (options: SerializeDslOptions) => {
  const printLayouts = options.printLayouts ?? [];
  const lines: string[] = [
    ...serializeVisibilitySettingsLines(
      options.visibilityRoles ?? [],
      options.visibilityProfiles ?? [],
      options.activeVisibilityProfileId
    )
  ];
  for (const layout of printLayouts) {
    if (!layout.visibilityProfileId) continue;
    lines.push(
      `printLayout ${formatDslName(layout.name.trim() || layout.id)} (output: ${layout.outputKind} view: ${formatDslName(layout.visibilityProfileId)})`
    );
  }
  return lines.length > 0 ? [...lines, ""] : [];
};
