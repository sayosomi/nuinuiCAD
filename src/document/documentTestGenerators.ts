import { expect } from "vitest";
import {
  compileDslDocument,
  serializeDocumentToDsl,
  type CompiledDslDocument,
  type DslDocumentData
} from "../dsl/dslDocument";
import type { CadElement, ElementId } from "../types/geometry";

// プロパティテスト用の文書生成器とランダム操作の解釈器(テスト専用)。
//
// 生成する文書の制約(オラクルを単純に保つための設計):
// * 要素名は文書全体で一意(照合の段階5が常に決定できる)。
// * 参照(offset)はトップレベルの点のみを対象にする。
// * 無名要素はトップレベルのみ・移動対象外。
// * ノイズ(コメント行・空行)はブロック外のトップレベル位置のみに注入する
//   (サブツリー削除・printLayoutブロック書き換えに巻き込まれない)。

export type GeneratedDocParams = {
  pointCount: number;
  groupCount: number;
  withIf: boolean;
  withFor: boolean;
  withLayout: boolean;
  unnamedCount: number;
  noiseEvery: number;
  /** バックスラッシュ継続(複数物理行)のstatementを1つ混ぜる(W2の回帰網羅用)。 */
  withContinuation: boolean;
};

export type GeneratedDoc = {
  source: string;
  /** 注入したコメント行(バイト不変を検証するマーカー)。 */
  noiseLines: string[];
};

export const generateDocumentSource = (params: GeneratedDocParams): GeneratedDoc => {
  const sections: string[][] = [];
  sections.push(["nui 4"]);
  sections.push([
    'color main ("#31322f", name: "基本線", default: true)',
    'color accent ("#b42318", name: "裁断線")'
  ]);
  sections.push([
    'role seam (name: "縫い代")',
    "view 通常 (default: true, seam: false)",
    "view 印刷 (default: true, seam: true)",
    "activeView 通常"
  ]);

  const elementLines: string[] = [];
  for (let index = 0; index < params.pointCount; index += 1) {
    elementLines.push(`point P${index} = coordinate(x: ${index * 10}, y: ${index * 3})`);
  }
  // 参照を1つ入れる(リネーム伝播の運動場)。
  if (params.pointCount >= 2) {
    elementLines.push("point Ref0 = offset(from: @P0, dx: 5, dy: 5)");
  }
  if (params.withContinuation) {
    // nui 4の縦型call(未閉`(`による複数物理行statement)を1つ混ぜる。palette側で
    // 定義済みの"main"色を参照する(パースはcolorIdの存在検証をしない)。
    elementLines.push("point PC = coordinate(");
    elementLines.push("  x: 5,");
    elementLines.push("  y: 5,");
    elementLines.push("  color: main");
    elementLines.push(")");
  }
  for (let index = 0; index < params.groupCount; index += 1) {
    elementLines.push(`group G${index} {`);
    elementLines.push(`  point GP${index}a = coordinate(x: ${index}, y: 1)`);
    elementLines.push(`  point GP${index}b = coordinate(x: ${index}, y: 2)`);
    elementLines.push("}");
  }
  if (params.withIf) {
    elementLines.push("if (true) {");
    elementLines.push("  point IT0 = coordinate(x: 100, y: 1)");
    elementLines.push("} else {");
    elementLines.push("  point IE0 = coordinate(x: 100, y: 2)");
    elementLines.push("}");
  }
  if (params.withFor) {
    elementLines.push("for i in range(from: 0, count: 3, step: 1) {");
    elementLines.push("  point FP0 = coordinate(x: @i * 10, y: 0)");
    elementLines.push("}");
  }
  for (let index = 0; index < params.unnamedCount; index += 1) {
    elementLines.push(`point = coordinate(x: ${900 + index}, y: ${index})`);
  }
  sections.push(elementLines);

  if (params.withLayout && params.groupCount > 0) {
    // Source outputs are canonicalized after the element section.
    sections.push([
      "layout L0(scale: 1) {",
      "  place @G0(origin: @G0, at: (0, 15), angle: 0, mirror: false)",
      "}",
      "print A4(layout: @L0, paper: a4, orientation: portrait, margin: 10, overlap: 10)"
    ]);
  }

  const rawLines = sections
    .filter((section) => section.length > 0)
    .flatMap((section, index) => (index === 0 ? section : ["", ...section]));

  // トップレベル(ブロック外・未閉`(`の外)の行間にだけノイズを注入する。
  const noiseLines: string[] = [];
  const withNoise: string[] = [];
  let depth = 0;
  let parenDepth = 0;
  let noiseCounter = 0;
  rawLines.forEach((line, index) => {
    withNoise.push(line);
    const trimmed = line.trim();
    if (trimmed === "}") depth -= 1;
    else if (trimmed.startsWith("} else")) depth += 0;
    else if (trimmed.endsWith("{")) depth += 1;
    for (const char of trimmed) {
      if (char === "(" || char === "[") parenDepth += 1;
      else if (char === ")" || char === "]") parenDepth -= 1;
    }
    // 縦型callの引数行の直後に空行を挟むと継続が壊れる(空行/構造行が未閉呼び出しを
    // 打ち切る)ため、未閉`(`/`[`が残っている間は注入対象から外す。
    if (
      depth === 0 &&
      parenDepth === 0 &&
      index > 0 &&
      params.noiseEvery > 0 &&
      index % params.noiseEvery === 0
    ) {
      const marker = `// noise-${(noiseCounter += 1)}`;
      noiseLines.push(marker);
      withNoise.push(marker);
      if (noiseCounter % 2 === 0) withNoise.push("");
    }
  });

  return { source: withNoise.join("\n"), noiseLines };
};

// ==== ランダム操作 ====

export type RandomOp = {
  kind:
    | "updateAttr"
    | "rename"
    | "insert"
    | "deleteLeaf"
    | "deleteReferencedTarget"
    | "deleteSubtree"
    | "ungroup"
    | "move"
    | "reparent"
    | "paletteEdit"
    | "stopMove"
    | "profileToggle"
    | "layoutEdit";
  a: number;
  b: number;
};

const ANCHOR_KEYS = [
  "startPoint",
  "endPoint",
  "centerPoint",
  "fromPoint",
  "basePoint",
  "splitPoint",
  "point",
  "point1",
  "point2",
  "point3",
  "axisPoint1",
  "axisPoint2",
  "anchor",
  "originPoint"
];
const LINE_KEYS = ["line1Id", "line2Id", "baseLineId", "lineId"];

export const referencedElementIds = (elements: CadElement[]): Set<ElementId> => {
  const ids = new Set<ElementId>();
  const addAnchor = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const anchor = value as { mode?: string; pointId?: ElementId; elementId?: ElementId };
    if (anchor.mode === "reference" && anchor.pointId) ids.add(anchor.pointId);
    if (anchor.mode === "derived" && anchor.elementId) ids.add(anchor.elementId);
  };
  for (const element of elements) {
    const record = element as unknown as Record<string, unknown>;
    for (const key of ANCHOR_KEYS) addAnchor(record[key]);
    for (const key of LINE_KEYS) {
      const value = record[key];
      if (typeof value === "string") ids.add(value);
    }
    const endpoints = ["endpoint", "endpoint1", "endpoint2"];
    for (const key of endpoints) {
      const value = record[key] as { lineId?: ElementId } | undefined;
      if (value?.lineId) ids.add(value.lineId);
    }
    const baseLineIds = record.baseLineIds;
    if (Array.isArray(baseLineIds)) for (const id of baseLineIds) ids.add(id as ElementId);
  }
  return ids;
};

const CONTAINER_TYPES = new Set(["group", "conditionalGroup", "forGroup"]);
const isContainer = (element: CadElement) => CONTAINER_TYPES.has(element.type);

const isCanonicalDocumentCompilable = (document: DslDocumentData): boolean => {
  const compiled = compileDslDocument(serializeDocumentToDsl(document, 4));
  return compiled.document !== null && !compiled.diagnostics.some((diagnostic) => diagnostic.severity === "error");
};

const descendantIds = (elements: CadElement[], rootId: ElementId): Set<ElementId> => {
  const ids = new Set<ElementId>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const element of elements) {
      if (ids.has(element.id)) continue;
      if (element.parentGroupId === rootId || (element.parentGroupId && ids.has(element.parentGroupId))) {
        ids.add(element.id);
        changed = true;
      }
    }
  }
  return ids;
};

let generatedNameCounter = 0;

const makeFreePoint = (name: string, x: number, y: number): CadElement => {
  const statement = name ? `point ${name} = coordinate(x: ${x}, y: ${y})` : `point = coordinate(x: ${x}, y: ${y})`;
  const compiled = compileDslDocument(`nui 4\n${statement}`);
  expect(compiled.document, "generator fragment must compile").not.toBeNull();
  return compiled.document!.elements[0];
};

export type AppliedOp = {
  document: DslDocumentData;
  /** このステップで挿入された要素のID(照合では新規IDになるのが正)。 */
  insertedIds: ElementId[];
  description: string;
};

// 1つのランダム操作をモデルへ適用する。対象が見つからない操作は updateAttr に
// フォールバックし、必ず何らかの変更(または無変更)を決定論的に返す。
export const applyRandomOp = (document: DslDocumentData, op: RandomOp): AppliedOp => {
  const pick = <T>(items: T[], seed: number): T | undefined =>
    items.length === 0 ? undefined : items[seed % items.length];
  const referenced = referencedElementIds(document.elements);
  // printLayout の配置先グループも「参照されている」扱いにする(消すと
  // モデル自体が dangling になり、パッチではなく生成器の問題になる)。
  for (const layout of document.layouts) {
    for (const placement of layout.placements) referenced.add(placement.groupId);
  }
  const named = document.elements.filter((element) => element.name !== "");
  const unreferencedLeaves = document.elements.filter(
    (element) =>
      !isContainer(element) &&
      !referenced.has(element.id) &&
      element.name !== "" &&
      referencedElementIds([element]).size === 0
  );
  const plainGroups = document.elements.filter((element) => element.type === "group");

  const fallbackUpdate = (): AppliedOp => {
    // nui4's canonical if/for headers have no serialized common-attribute
    // slots. Keep the property generator focused on elements whose activity
    // can round-trip through the final syntax.
    const target = pick(document.elements.filter((element) => !["conditionalGroup", "forGroup"].includes(element.type)), op.a);
    if (!target) return { document, insertedIds: [], description: "noop" };
    return {
      document: {
        ...document,
        elements: document.elements.map((element) =>
          element.id === target.id
            ? ({ ...element, activity: element.activity === "disabled" ? "visible" : "disabled" } as CadElement)
            : element
        )
      },
      insertedIds: [],
      description: `updateAttr ${target.name || target.id}`
    };
  };

  switch (op.kind) {
    case "updateAttr":
      return fallbackUpdate();

    case "rename": {
      const target = pick(named, op.a);
      if (!target) return fallbackUpdate();
      let name = `R${(generatedNameCounter += 1)}`;
      while (document.elements.some((element) => element.name === name)) {
        name = `R${(generatedNameCounter += 1)}`;
      }
      return {
        document: {
          ...document,
          elements: document.elements.map((element) =>
            element.id === target.id ? ({ ...element, name } as CadElement) : element
          )
        },
        insertedIds: [],
        description: `rename ${target.name} -> ${name}`
      };
    }

    case "insert": {
      let name = `N${(generatedNameCounter += 1)}`;
      while (document.elements.some((element) => element.name === name)) {
        name = `N${(generatedNameCounter += 1)}`;
      }
      const point = makeFreePoint(name, op.a % 500, op.b % 500);
      const group = pick(plainGroups, op.b);
      if (group && op.a % 2 === 0) {
        // グループの先頭子として挿入(連続性を保つ)。
        const groupIndex = document.elements.findIndex((element) => element.id === group.id);
        const elements = [...document.elements];
        elements.splice(groupIndex + 1, 0, { ...point, parentGroupId: group.id } as CadElement);
        return {
          document: { ...document, elements, evaluationLimitIndex: elements.length },
          insertedIds: [point.id],
          description: `insert ${name} into ${group.name}`
        };
      }
      const elements = [...document.elements, point];
      return {
        document: { ...document, elements, evaluationLimitIndex: elements.length },
        insertedIds: [point.id],
        description: `insert ${name} at top`
      };
    }

    case "deleteLeaf": {
      const target = pick(unreferencedLeaves, op.a);
      if (!target) return fallbackUpdate();
      const elements = document.elements.filter((element) => element.id !== target.id);
      return {
        document: { ...document, elements, evaluationLimitIndex: elements.length },
        insertedIds: [],
        description: `deleteLeaf ${target.name}`
      };
    }

    case "deleteReferencedTarget": {
      const target = pick(
        document.elements.filter((element) =>
          !isContainer(element) && referenced.has(element.id)
        ),
        op.a
      );
      if (!target) return fallbackUpdate();
      const elements = document.elements.filter((element) => element.id !== target.id);
      return {
        document: { ...document, elements, evaluationLimitIndex: elements.length },
        insertedIds: [],
        description: `deleteReferencedTarget ${target.name || target.id}`
      };
    }

    case "deleteSubtree": {
      const target = pick(document.elements.filter(isContainer), op.a);
      if (!target) return fallbackUpdate();
      const removed = descendantIds(document.elements, target.id);
      removed.add(target.id);
      // 参照されている要素をサブツリーごと消すと dangling になるので避ける。
      if ([...removed].some((id) => referenced.has(id))) return fallbackUpdate();
      const elements = document.elements.filter((element) => !removed.has(element.id));
      return {
        document: { ...document, elements, evaluationLimitIndex: elements.length },
        insertedIds: [],
        description: `deleteSubtree ${target.name || target.id}`
      };
    }

    case "ungroup": {
      const target = pick(plainGroups.filter((group) => !referenced.has(group.id)), op.a);
      if (!target) return fallbackUpdate();
      const elements = document.elements
        .filter((element) => element.id !== target.id)
        .map((element) =>
          element.parentGroupId === target.id
            ? ({ ...element, parentGroupId: target.parentGroupId } as CadElement)
            : element
        );
      return {
        document: { ...document, elements, evaluationLimitIndex: elements.length },
        insertedIds: [],
        description: `ungroup ${target.name || target.id}`
      };
    }

    case "move": {
      const target = pick(
        unreferencedLeaves.filter((element) => element.parentGroupId === undefined),
        op.a
      );
      if (!target) return fallbackUpdate();
      const rest = document.elements.filter((element) => element.id !== target.id);
      const topLevelSlots = rest
        .map((element, index) => ({ element, index }))
        .filter((item) => item.element.parentGroupId === undefined);
      const slot = pick(topLevelSlots, op.b);
      const insertAt = slot ? slot.index : rest.length;
      const elements = [...rest.slice(0, insertAt), target, ...rest.slice(insertAt)];
      return {
        document: { ...document, elements },
        insertedIds: [],
        description: `move ${target.name}`
      };
    }

    case "reparent": {
      const target = pick(unreferencedLeaves, op.a);
      const group = pick(plainGroups.filter((element) => element.id !== target?.id), op.b);
      if (!target || !group || descendantIds(document.elements, target.id).has(group.id)) {
        return fallbackUpdate();
      }
      const rest = document.elements.filter((element) => element.id !== target.id);
      const groupIndex = rest.findIndex((element) => element.id === group.id);
      const elements = [...rest];
      elements.splice(groupIndex + 1, 0, {
        ...target,
        parentGroupId: group.id,
        conditionalBranch: undefined
      } as CadElement);
      const candidate = { ...document, elements };
      if (!isCanonicalDocumentCompilable(candidate)) return fallbackUpdate();
      return {
        document: candidate,
        insertedIds: [],
        description: `reparent ${target.name} into ${group.name}`
      };
    }

    case "paletteEdit": {
      const color = pick(document.palette.colors, op.a);
      if (!color) return fallbackUpdate();
      const hex = `#${(op.b % 0xffffff).toString(16).padStart(6, "0")}`;
      return {
        document: {
          ...document,
          palette: {
            ...document.palette,
            colors: document.palette.colors.map((item) =>
              item.id === color.id ? { ...item, hex } : item
            )
          }
        },
        insertedIds: [],
        description: `paletteEdit ${color.id}`
      };
    }

    case "stopMove":
      return {
        document: { ...document, evaluationLimitIndex: op.a % (document.elements.length + 1) },
        insertedIds: [],
        description: "stopMove"
      };

    case "profileToggle": {
      const profile = pick(document.visibilityProfiles, op.a);
      const role = pick(document.visibilityRoles, op.b);
      if (!profile || !role) return fallbackUpdate();
      return {
        document: {
          ...document,
          visibilityProfiles: document.visibilityProfiles.map((item) =>
            item.id === profile.id
              ? {
                  ...item,
                  roleVisibility: {
                    ...item.roleVisibility,
                    [role.id]: !(item.roleVisibility[role.id] ?? item.defaultRoleVisible)
                  }
                }
              : item
          )
        },
        insertedIds: [],
        description: `profileToggle ${profile.id}/${role.id}`
      };
    }

    case "layoutEdit": {
      const layout = pick(document.layouts, op.a);
      if (!layout) return fallbackUpdate();
      return {
        document: {
          ...document,
          layouts: document.layouts.map((item) =>
            item.id === layout.id ? { ...item, scale: (op.b % 6) + 1 } : item
          )
        },
        insertedIds: [],
        description: `layoutEdit ${layout.id}`
      };
    }
  }
};

export const compileOrFail = (source: string): CompiledDslDocument => {
  const compiled = compileDslDocument(source);
  expect(
    compiled.diagnostics.filter((item) => item.severity === "error"),
    `document must compile:\n${source}`
  ).toEqual([]);
  expect(compiled.document).not.toBeNull();
  expect(compiled.statementMap).not.toBeNull();
  return compiled;
};
