import { describe, expect, it } from "vitest";
import { compileDslDocument, type CompiledDslDocument, type DslDocumentData } from "../dsl/dslDocument";
import { dslTextForElements } from "../dsl/dslDocumentTestUtils";
import { isElementDslStatement, parseDsl } from "../dsl/dslParser";
import type { CadElementType } from "../types/geometry";
import { reconcileStatements, type ReconcileResult } from "./statementReconciler";

// 決定論的ID生成器(テスト再現性のため createCadElementId は使わない)。
const testIdFactory = () => {
  let counter = 0;
  return (type: CadElementType) => `new-${type}-${(counter += 1)}`;
};

const reconcileSources = (
  oldSource: string,
  newSource: string
): { old: CompiledDslDocument; next: CompiledDslDocument; result: ReconcileResult } => {
  const parsedOld = parseDsl(oldSource);
  const hasTypedDeclarations = parsedOld.statements.some(
    (statement) => statement.kind === "typedDeclaration" || statement.kind === "set"
  );
  let initialIdentity = 0;
  const initial = hasTypedDeclarations
    ? reconcileStatements({
      oldStatements: [],
      oldLines: [],
      oldElementIds: new Map(),
      oldStatementIds: new Map(),
      newStatements: parsedOld.statements,
      newLines: oldSource.split("\n")
    }, {
      createId: (type) => `initial-${type}-${++initialIdentity}`,
      createStatementId: () => `initial-statement-${++initialIdentity}`
    })
    : null;
  const old = compileDslDocument(oldSource, initial ? {
    assignedElementIds: initial.assignedIds,
    assignedStatementIds: initial.assignedIds,
    preparsed: parsedOld
  } : undefined);
  expect(old.statementMap, "old document must compile").not.toBeNull();
  const normalized = newSource.replace(/\r\n/g, "\n");
  const parsedNew = parseDsl(normalized);
  const result = reconcileStatements(
    {
      oldStatements: old.statements,
      oldLines: old.sourceLines,
      oldElementIds: old.statementMap!.elementIdByStatementIndex,
      oldStatementIds: old.statementMap!.statementIdByStatementIndex,
      newStatements: parsedNew.statements,
      newLines: normalized.split("\n")
    },
    { createId: testIdFactory() }
  );
  const next = compileDslDocument(normalized, {
    assignedElementIds: result.assignedIds,
    assignedStatementIds: result.assignedIds
  });
  expect(next.statementMap, "reconciled document must compile").not.toBeNull();
  return { old, next, result };
};

const idByName = (compiled: CompiledDslDocument, name: string) => {
  const element = compiled.document!.elements.find((item) => item.name === name);
  expect(element, `element ${name}`).toBeDefined();
  return element!.id;
};

const stageOfName = (compiled: CompiledDslDocument, result: ReconcileResult, name: string) => {
  const statementIndex = compiled.statements.findIndex(
    (statement) => isElementDslStatement(statement) && statement.name === name
  );
  expect(statementIndex, `statement ${name}`).toBeGreaterThanOrEqual(0);
  return result.stageByNewStatementIndex.get(statementIndex);
};

const reconcileElements = (
  oldElements: DslDocumentData["elements"],
  newElements: DslDocumentData["elements"]
) => reconcileSources(dslTextForElements(oldElements), dslTextForElements(newElements));

describe("statementReconciler 仕様表", () => {
  it("inherits opaque identities for renamed module definitions and instances across insertion", () => {
    const oldSource = [
      "nui 4",
      "module M() {",
      "  point Inner = coordinate(x: 0, y: 0)",
      "}",
      "instance Instance = M()"
    ].join("\n");
    const newSource = [
      "nui 4",
      "point Unrelated = coordinate(x: 10, y: 10)",
      "module Renamed() {",
      "  point Inner = coordinate(x: 0, y: 0)",
      "}",
      "instance RenamedInstance = Renamed()"
    ].join("\n");
    const oldStatements = parseDsl(oldSource).statements;
    let nextId = 0;
    const first = reconcileStatements(
      {
        oldStatements: [],
        oldLines: [],
        oldElementIds: new Map(),
        oldStatementIds: new Map(),
        newStatements: oldStatements,
        newLines: oldSource.split("\n")
      },
      {
        createId: (type) => `element:${type}:${++nextId}`,
        createStatementId: (kind) => `statement:${kind}:${++nextId}`
      }
    );
    const newStatements = parseDsl(newSource).statements;
    const second = reconcileStatements({
      oldStatements,
      oldLines: oldSource.split("\n"),
      oldElementIds: first.assignedIds,
      oldStatementIds: first.assignedIds,
      newStatements,
      newLines: newSource.split("\n")
    }, { createId: (type) => `new-element:${type}`, createStatementId: (kind) => `new-statement:${kind}` });

    const oldModuleDefinitionIndex = oldStatements.findIndex((statement) => statement.kind === "moduleDefinition");
    const oldModuleInstanceIndex = oldStatements.findIndex((statement) => statement.kind === "moduleInstance");
    const newModuleDefinitionIndex = newStatements.findIndex((statement) => statement.kind === "moduleDefinition");
    const newModuleInstanceIndex = newStatements.findIndex((statement) => statement.kind === "moduleInstance");
    expect(second.assignedIds.get(newModuleDefinitionIndex)).toBe(first.assignedIds.get(oldModuleDefinitionIndex));
    expect(second.assignedIds.get(newModuleInstanceIndex)).toBe(first.assignedIds.get(oldModuleInstanceIndex));
  });

  it("属性編集(名前・型・位置不変)は段階2でID変化0", () => {
    const oldElements: DslDocumentData["elements"] = [
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "b", name: "B", type: "freePoint", activity: "visible", x: 1, y: 1 }
    ];
    const newElements: DslDocumentData["elements"] = [
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "b", name: "B", type: "freePoint", activity: "visible", x: 2, y: 2 }
    ];
    const { old, next, result } = reconcileElements(oldElements, newElements);
    expect(idByName(next, "A")).toBe(idByName(old, "A"));
    expect(idByName(next, "B")).toBe(idByName(old, "B"));
    expect(result.createdIds.size).toBe(0);
    expect(result.vanishedIds).toEqual([]);
    expect(stageOfName(next, result, "A")).toBe(1);
    expect(stageOfName(next, result, "B")).toBe(2);
  });

  it("リネーム(位置・型不変)は段階3でID維持", () => {
    const oldElements: DslDocumentData["elements"] = [
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "b", name: "B", type: "freePoint", activity: "visible", x: 1, y: 1 }
    ];
    const newElements: DslDocumentData["elements"] = [
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "b", name: "C", type: "freePoint", activity: "visible", x: 1, y: 1 }
    ];
    const { old, next, result } = reconcileElements(oldElements, newElements);
    expect(idByName(next, "C")).toBe(idByName(old, "B"));
    expect(result.createdIds.size).toBe(0);
    expect(result.vanishedIds).toEqual([]);
    expect(stageOfName(next, result, "C")).toBe(3);
  });

  it("同一スコープ内の行移動(内容不変)は段階2でID変化0", () => {
    const oldElements: DslDocumentData["elements"] = [
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "b", name: "B", type: "freePoint", activity: "visible", x: 1, y: 1 },
      { id: "c", name: "C", type: "freePoint", activity: "visible", x: 2, y: 2 }
    ];
    const newElements: DslDocumentData["elements"] = [
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "c", name: "C", type: "freePoint", activity: "visible", x: 2, y: 2 },
      { id: "b", name: "B", type: "freePoint", activity: "visible", x: 1, y: 1 }
    ];
    const { old, next, result } = reconcileElements(oldElements, newElements);
    expect(idByName(next, "B")).toBe(idByName(old, "B"));
    expect(idByName(next, "C")).toBe(idByName(old, "C"));
    expect(result.createdIds.size).toBe(0);
    expect(stageOfName(next, result, "B")).toBe(2);
  });

  it("無名要素の属性編集(位置不変)は段階3でID維持", () => {
    const oldElements: DslDocumentData["elements"] = [
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "u", name: "", type: "freePoint", activity: "visible", x: 5, y: 5 },
      { id: "b", name: "B", type: "freePoint", activity: "visible", x: 1, y: 1 }
    ];
    const newElements: DslDocumentData["elements"] = [
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "u", name: "", type: "freePoint", activity: "visible", x: 6, y: 6 },
      { id: "b", name: "B", type: "freePoint", activity: "visible", x: 1, y: 1 }
    ];
    const { old, next, result } = reconcileElements(oldElements, newElements);
    const oldUnnamed = old.document!.elements.find((item) => item.name === "")!;
    const newUnnamed = next.document!.elements.find((item) => item.name === "")!;
    expect(newUnnamed.id).toBe(oldUnnamed.id);
    expect(result.createdIds.size).toBe(0);
    expect(result.vanishedIds).toEqual([]);
  });

  it("無名要素の挿入は既存ID全継承+新規ID1件のみ", () => {
    const oldElements: DslDocumentData["elements"] = [
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "b", name: "B", type: "freePoint", activity: "visible", x: 1, y: 1 }
    ];
    const newElements: DslDocumentData["elements"] = [
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "u", name: "", type: "freePoint", activity: "visible", x: 9, y: 9 },
      { id: "b", name: "B", type: "freePoint", activity: "visible", x: 1, y: 1 }
    ];
    const { old, next, result } = reconcileElements(oldElements, newElements);
    expect(idByName(next, "A")).toBe(idByName(old, "A"));
    expect(idByName(next, "B")).toBe(idByName(old, "B"));
    expect(result.createdIds.size).toBe(1);
    expect(result.inheritedCount).toBe(2);
    const unnamed = next.document!.elements.find((item) => item.name === "")!;
    expect(unnamed.id).toBe("new-freePoint-1");
    expect(result.vanishedIds).toEqual([]);
  });

  it("無名要素の命名(昇格)は段階3でID維持", () => {
    const oldElements: DslDocumentData["elements"] = [
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "u", name: "", type: "freePoint", activity: "visible", x: 5, y: 5 }
    ];
    const newElements: DslDocumentData["elements"] = [
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "u", name: "named5", type: "freePoint", activity: "visible", x: 5, y: 5 }
    ];
    const { old, next, result } = reconcileElements(oldElements, newElements);
    const oldUnnamed = old.document!.elements.find((item) => item.name === "")!;
    expect(idByName(next, "named5")).toBe(oldUnnamed.id);
    expect(result.createdIds.size).toBe(0);
    expect(stageOfName(next, result, "named5")).toBe(3);
  });

  it("グループ跨ぎの移動(名前・型不変)は段階5でID維持", () => {
    const oldElements: DslDocumentData["elements"] = [
      { id: "g1", name: "G1", type: "group", activity: "visible" },
      { id: "p", name: "P", type: "freePoint", activity: "visible", x: 0, y: 0, parentGroupId: "g1" },
      { id: "g2", name: "G2", type: "group", activity: "visible" }
    ];
    const newElements: DslDocumentData["elements"] = [
      { id: "g1", name: "G1", type: "group", activity: "visible" },
      { id: "g2", name: "G2", type: "group", activity: "visible" },
      { id: "p", name: "P", type: "freePoint", activity: "visible", x: 0, y: 0, parentGroupId: "g2" }
    ];
    const { old, next, result } = reconcileElements(oldElements, newElements);
    expect(idByName(next, "P")).toBe(idByName(old, "P"));
    expect(idByName(next, "G1")).toBe(idByName(old, "G1"));
    expect(idByName(next, "G2")).toBe(idByName(old, "G2"));
    expect(result.createdIds.size).toBe(0);
    expect(stageOfName(next, result, "P")).toBe(5);
    // 親付け替えが実際にモデルへ反映されている。
    const p = next.document!.elements.find((item) => item.name === "P")!;
    expect(p.parentGroupId).toBe(idByName(next, "G2"));
  });

  it("branch切替(then⇄else)は段階5でID維持", () => {
    const oldElements: DslDocumentData["elements"] = [
      { id: "cond", name: "分岐", type: "conditionalGroup", activity: "visible", condition: { kind: "expression", expression: "true" } },
      { id: "c", name: "C", type: "freePoint", activity: "visible", x: 10, y: 10, parentGroupId: "cond", conditionalBranch: "then" },
      { id: "d", name: "D", type: "freePoint", activity: "visible", x: 20, y: 20, parentGroupId: "cond", conditionalBranch: "else" }
    ];
    const newElements: DslDocumentData["elements"] = [
      { id: "cond", name: "分岐", type: "conditionalGroup", activity: "visible", condition: { kind: "expression", expression: "true" } },
      { id: "d", name: "D", type: "freePoint", activity: "visible", x: 20, y: 20, parentGroupId: "cond", conditionalBranch: "else" },
      { id: "c", name: "C", type: "freePoint", activity: "visible", x: 10, y: 10, parentGroupId: "cond", conditionalBranch: "else" }
    ];
    const { old, next, result } = reconcileElements(oldElements, newElements);
    expect(idByName(next, "C")).toBe(idByName(old, "C"));
    expect(idByName(next, "D")).toBe(idByName(old, "D"));
    expect(result.createdIds.size).toBe(0);
    expect(stageOfName(next, result, "C")).toBe(5);
    const c = next.document!.elements.find((item) => item.name === "C")!;
    expect(c.conditionalBranch).toBe("else");
  });

  it("グループのリネームは本体が段階3・子は段階1でID変化0", () => {
    const oldElements: DslDocumentData["elements"] = [
      { id: "g", name: "G", type: "group", activity: "visible" },
      { id: "p", name: "P", type: "freePoint", activity: "visible", x: 0, y: 0, parentGroupId: "g" },
      { id: "q", name: "Q", type: "freePoint", activity: "visible", x: 1, y: 1, parentGroupId: "g" }
    ];
    const newElements: DslDocumentData["elements"] = [
      { id: "g", name: "H", type: "group", activity: "visible" },
      { id: "p", name: "P", type: "freePoint", activity: "visible", x: 0, y: 0, parentGroupId: "g" },
      { id: "q", name: "Q", type: "freePoint", activity: "visible", x: 1, y: 1, parentGroupId: "g" }
    ];
    const { old, next, result } = reconcileElements(oldElements, newElements);
    expect(idByName(next, "H")).toBe(idByName(old, "G"));
    expect(idByName(next, "P")).toBe(idByName(old, "P"));
    expect(idByName(next, "Q")).toBe(idByName(old, "Q"));
    expect(result.createdIds.size).toBe(0);
    expect(stageOfName(next, result, "H")).toBe(3);
    expect(stageOfName(next, result, "P")).toBe(1);
  });

  it("リネーム+行移動の同時実行は新規ID(許容制約)", () => {
    const oldElements: DslDocumentData["elements"] = [
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "b", name: "B", type: "freePoint", activity: "visible", x: 1, y: 1 },
      { id: "c", name: "C", type: "freePoint", activity: "visible", x: 2, y: 2 }
    ];
    const newElements: DslDocumentData["elements"] = [
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "c", name: "C", type: "freePoint", activity: "visible", x: 2, y: 2 },
      { id: "b", name: "D", type: "freePoint", activity: "visible", x: 1, y: 1 }
    ];
    const { old, next, result } = reconcileElements(oldElements, newElements);
    expect(idByName(next, "A")).toBe(idByName(old, "A"));
    expect(idByName(next, "C")).toBe(idByName(old, "C"));
    expect(idByName(next, "D")).not.toBe(idByName(old, "B"));
    expect(result.createdIds.size).toBe(1);
    expect(result.vanishedIds).toEqual([idByName(old, "B")]);
    expect(stageOfName(next, result, "D")).toBe(6);
  });

  it("型の変更は新規ID", () => {
    const oldElements: DslDocumentData["elements"] = [
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "b", name: "B", type: "freePoint", activity: "visible", x: 1, y: 1 }
    ];
    const newElements: DslDocumentData["elements"] = [
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      {
        id: "b",
        name: "B",
        type: "group",
        activity: "visible"
      }
    ];
    const { old, next, result } = reconcileElements(oldElements, newElements);
    expect(idByName(next, "B")).not.toBe(idByName(old, "B"));
    expect(result.createdIds.size).toBe(1);
    expect(result.vanishedIds).toEqual([idByName(old, "B")]);
  });

  it("コメントのみの行内編集はID変化0", () => {
    const oldSource = ["nui 4", "point A = coordinate(x: 0, y: 0) // 旧コメント", "point B = coordinate(x: 1, y: 1)"].join("\n");
    const newSource = ["nui 4", "point A = coordinate(x: 0, y: 0) // 新コメント", "point B = coordinate(x: 1, y: 1)"].join("\n");
    const { old, next, result } = reconcileSources(oldSource, newSource);
    expect(idByName(next, "A")).toBe(idByName(old, "A"));
    expect(result.createdIds.size).toBe(0);
  });

  it("ネスト無名グループ内の属性編集は blk: キー経由でID維持", () => {
    const oldElements: DslDocumentData["elements"] = [
      { id: "g", name: "", type: "group", activity: "visible" },
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0, parentGroupId: "g" },
      { id: "b", name: "B", type: "freePoint", activity: "visible", x: 1, y: 1, parentGroupId: "g" }
    ];
    const newElements: DslDocumentData["elements"] = [
      { id: "g", name: "", type: "group", activity: "visible" },
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0, parentGroupId: "g" },
      { id: "b", name: "B", type: "freePoint", activity: "visible", x: 3, y: 3, parentGroupId: "g" }
    ];
    const { old, next, result } = reconcileElements(oldElements, newElements);
    expect(idByName(next, "B")).toBe(idByName(old, "B"));
    expect(result.createdIds.size).toBe(0);
    expect(stageOfName(next, result, "B")).toBe(2);
  });

  it("全文置換でも名前+型+スコープが一致する要素はID継承する", () => {
    const oldElements: DslDocumentData["elements"] = [
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "b", name: "B", type: "freePoint", activity: "visible", x: 1, y: 1 },
      { id: "c", name: "C", type: "freePoint", activity: "visible", x: 2, y: 2 }
    ];
    const newElements: DslDocumentData["elements"] = [
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 10, y: 10 },
      { id: "b", name: "B", type: "freePoint", activity: "visible", x: 11, y: 11 },
      { id: "c", name: "C", type: "freePoint", activity: "visible", x: 12, y: 12 },
      { id: "d", name: "D", type: "freePoint", activity: "visible", x: 13, y: 13 }
    ];
    const { old, next, result } = reconcileElements(oldElements, newElements);
    expect(idByName(next, "A")).toBe(idByName(old, "A"));
    expect(idByName(next, "B")).toBe(idByName(old, "B"));
    expect(idByName(next, "C")).toBe(idByName(old, "C"));
    expect(result.createdIds.size).toBe(1);
    expect(stageOfName(next, result, "D")).toBe(6);
  });

  it("削除された要素は vanishedIds に旧文書順で載る", () => {
    const oldElements: DslDocumentData["elements"] = [
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "b", name: "B", type: "freePoint", activity: "visible", x: 1, y: 1 },
      { id: "c", name: "C", type: "freePoint", activity: "visible", x: 2, y: 2 }
    ];
    const newElements: DslDocumentData["elements"] = [
      { id: "b", name: "B", type: "freePoint", activity: "visible", x: 1, y: 1 }
    ];
    const { old, result } = reconcileElements(oldElements, newElements);
    expect(result.vanishedIds).toEqual([idByName(old, "A"), idByName(old, "C")]);
  });

  it("旧文書が空なら全て新規ID", () => {
    const oldSource = "nui 4";
    const newSource = dslTextForElements([
      { id: "a", name: "A", type: "freePoint", activity: "visible", x: 0, y: 0 },
      { id: "b", name: "B", type: "freePoint", activity: "visible", x: 1, y: 1 }
    ]);
    const { result } = reconcileSources(oldSource, newSource);
    expect(result.inheritedCount).toBe(0);
    expect(result.createdIds.size).toBe(2);
  });
});

// v2では継続はバックスラッシュではなく未閉`(`/`[`の深さで決まる。このdescribe
// 全体が「statementの複数物理行検知(全行結合による段階判定)」を主題として
// 検証するため、正準の縦型call形(手書きリテラル)のまま残す。
describe("statementReconciler 複数行statement(縦型call)", () => {
  it("引数行だけの編集は段階1の無変更扱いにならず、IDは継承される", () => {
    const oldSource = [
      "nui 4",
      "point A = coordinate(",
      "  x: 0,",
      "  y: 0,",
      "  color: main",
      ")",
      "point B = coordinate(x: 1, y: 1)"
    ].join("\n");
    const newSource = [
      "nui 4",
      "point A = coordinate(",
      "  x: 0,",
      "  y: 0,",
      "  color: accent",
      ")",
      "point B = coordinate(x: 1, y: 1)"
    ].join("\n");
    const { old, next, result } = reconcileSources(oldSource, newSource);
    expect(idByName(next, "A")).toBe(idByName(old, "A"));
    expect(idByName(next, "B")).toBe(idByName(old, "B"));
    expect(result.createdIds.size).toBe(0);
    expect(result.vanishedIds).toEqual([]);
    // 先頭物理行だけを見ていた旧実装では継続行(引数行)の変更が検知されず
    // 「段階1で無変更」になってしまっていた。全行結合により段階1では一致
    // しなくなり、別段階(完全キーマッチ)でID継承されることを確認する。
    expect(stageOfName(next, result, "A")).not.toBe(1);
    expect(stageOfName(next, result, "A")).toBe(2);
  });

  it("複数行statementが完全不変なら段階1でID継承・変化なし", () => {
    const oldSource = [
      "nui 4",
      "point A = coordinate(",
      "  x: 0,",
      "  y: 0,",
      "  color: main",
      ")",
      "point B = coordinate(x: 1, y: 1)"
    ].join("\n");
    const newSource = [
      "nui 4",
      "point A = coordinate(",
      "  x: 0,",
      "  y: 0,",
      "  color: main",
      ")",
      "point B = coordinate(x: 2, y: 2)"
    ].join("\n");
    const { old, next, result } = reconcileSources(oldSource, newSource);
    expect(idByName(next, "A")).toBe(idByName(old, "A"));
    expect(idByName(next, "B")).toBe(idByName(old, "B"));
    expect(result.createdIds.size).toBe(0);
    expect(result.vanishedIds).toEqual([]);
    expect(stageOfName(next, result, "A")).toBe(1);
  });

  it("複数行statementと単一行statementの順序入れ替えでもID対応にずれや重複がない", () => {
    const oldSource = [
      "nui 4",
      "point A = coordinate(",
      "  x: 0,",
      "  y: 0,",
      "  color: main",
      ")",
      "point B = coordinate(x: 1, y: 1)",
      "point C = coordinate(x: 2, y: 2)"
    ].join("\n");
    const newSource = [
      "nui 4",
      "point C = coordinate(x: 2, y: 2)",
      "point B = coordinate(x: 1, y: 1)",
      "point A = coordinate(",
      "  x: 0,",
      "  y: 0,",
      "  color: main",
      ")"
    ].join("\n");
    const { old, next, result } = reconcileSources(oldSource, newSource);
    // LCSの有効な選択次第でどのstatementが段階1に残るかは変わり得るため、段階は
    // 断定せず、名前→ID対応が旧新で一貫していること・新規/消滅がないこと・ID重複が
    // ないことのみを検証する。
    expect(idByName(next, "A")).toBe(idByName(old, "A"));
    expect(idByName(next, "B")).toBe(idByName(old, "B"));
    expect(idByName(next, "C")).toBe(idByName(old, "C"));
    expect(result.createdIds.size).toBe(0);
    expect(result.vanishedIds).toEqual([]);
    const assignedIdValues = [...result.assignedIds.values()];
    expect(new Set(assignedIdValues).size).toBe(assignedIdValues.length);
  });

  it("複数行statementのリネームは単一行と同じID継承規則の回帰(段階は断定しない)", () => {
    const oldSource = [
      "nui 4",
      "point A = coordinate(",
      "  x: 0,",
      "  y: 0,",
      "  color: main",
      ")",
      "point B = coordinate(x: 1, y: 1)"
    ].join("\n");
    const newSource = [
      "nui 4",
      "point Arenamed = coordinate(",
      "  x: 0,",
      "  y: 0,",
      "  color: main",
      ")",
      "point B = coordinate(x: 1, y: 1)"
    ].join("\n");
    const { old, next, result } = reconcileSources(oldSource, newSource);
    expect(idByName(next, "Arenamed")).toBe(idByName(old, "A"));
    expect(idByName(next, "B")).toBe(idByName(old, "B"));
    expect(result.createdIds.size).toBe(0);
    expect(result.vanishedIds).toEqual([]);
  });
});

describe("statementReconciler ストレス", () => {
  const buildLargeElements = (count: number): DslDocumentData["elements"] =>
    Array.from({ length: count }, (_, index) => ({
      id: `old-${index}`,
      name: `P${index}`,
      type: "freePoint" as const,
      activity: "visible",
      x: index,
      y: index % 97
    }));

  // v2の正準出力は縦型callで複数物理行に跨るため、対象statementの1物理行
  // だけを文字列置換すると残りの引数行が孤立して不正なテキストになる。
  // 対象要素だけを差し替えた要素配列から生成し直すことで、置換対象以外は
  // buildLargeSourceと1バイトも変わらない新テキストを安全に作る。
  it("1000文の属性編集1行はID変化0", () => {
    const elements = buildLargeElements(1000);
    const oldSource = dslTextForElements(elements);
    const newSource = dslTextForElements(
      elements.map((element) => (element.name === "P500" ? { ...element, x: 500, y: 42 } : element))
    );
    expect(newSource).not.toBe(oldSource);
    const { result } = reconcileSources(oldSource, newSource);
    expect(result.inheritedCount).toBe(elements.length);
    expect(result.createdIds.size).toBe(0);
    expect(result.vanishedIds).toEqual([]);
  });

  it("1000文のリネーム1件はID変化0", () => {
    const elements = buildLargeElements(1000);
    const oldSource = dslTextForElements(elements);
    const newSource = dslTextForElements(
      elements.map((element) => (element.name === "P500" ? { ...element, name: "Q500renamed" } : element))
    );
    expect(newSource).not.toBe(oldSource);
    const { result } = reconcileSources(oldSource, newSource);
    expect(result.inheritedCount).toBe(elements.length);
    expect(result.createdIds.size).toBe(0);
    expect(result.vanishedIds).toEqual([]);
  });
});

describe("statementReconciler と typed declaration", () => {
  const pointLines = () =>
    Array.from({ length: 50 }, (_, index) => `point P${index} = coordinate(x: ${index}, y: ${index % 7})`);
  const declarationLines = () => Array.from({ length: 50 }, (_, index) => `const V${index}: number = ${index}`);

  it("declarations inherit opaque identities without entering elements", () => {
    const oldSource = ["nui 4", ...declarationLines(), ...pointLines()].join("\n");
    const newSource = ["nui 4", ...declarationLines(), "const extra: number = 999", ...pointLines()].join("\n");
    const { result } = reconcileSources(oldSource, newSource);
    expect(result.inheritedCount).toBe(100);
    expect(result.createdIds.size).toBe(1);
    expect(result.vanishedIds).toEqual([]);
  });

  it("a declaration positioned between two elements does not affect either element's identity", () => {
    const oldSource = ["nui 4", "point A = coordinate(x: 0, y: 0)", "point B = coordinate(x: 1, y: 1)"].join("\n");
    const newSource = [
      "nui 4",
      "point A = coordinate(x: 0, y: 0)",
      "const between: string = \"x\"",
      "point B = coordinate(x: 1, y: 1)"
    ].join("\n");
    const { old, next, result } = reconcileSources(oldSource, newSource);
    expect(result.inheritedCount).toBe(2);
    expect(result.createdIds.size).toBe(1);
    expect(idByName(next, "A")).toBe(idByName(old, "A"));
    expect(idByName(next, "B")).toBe(idByName(old, "B"));
  });
});

describe("statementReconciler と set statement", () => {
  it("a set statement inherits an opaque identity across an unrelated edit", () => {
    const oldSource = ["nui 4", "let x: number = 1", "set x = 2", "point A = coordinate(x: 0, y: 0)"].join("\n");
    const newSource = ["nui 4", "let x: number = 1", "set x = 2", "point A = coordinate(x: 0, y: 1)"].join("\n");
    const { old, next, result } = reconcileSources(oldSource, newSource);
    const oldSetIndex = old.statements.findIndex((statement) => statement.kind === "set");
    const newSetIndex = next.statements.findIndex((statement) => statement.kind === "set");
    expect(oldSetIndex).toBeGreaterThanOrEqual(0);
    expect(newSetIndex).toBeGreaterThanOrEqual(0);
    expect(old.statementMap!.statementIdByStatementIndex!.get(oldSetIndex)).toBe(
      next.statementMap!.statementIdByStatementIndex!.get(newSetIndex)
    );
    expect(result.vanishedIds).toEqual([]);
  });

  it("a newly-added set statement gets its own fresh identity, not a fabricated one", () => {
    const oldSource = ["nui 4", "let x: number = 1"].join("\n");
    const newSource = ["nui 4", "let x: number = 1", "set x = 2"].join("\n");
    const { next, result } = reconcileSources(oldSource, newSource);
    const newSetIndex = next.statements.findIndex((statement) => statement.kind === "set");
    expect(result.createdIds.has(newSetIndex)).toBe(true);
    expect(next.statementMap!.statementIdByStatementIndex!.get(newSetIndex)).toBeDefined();
  });

  it("a set statement positioned between two elements does not affect either element's identity", () => {
    const oldSource = ["nui 4", "let x: number = 1", "point A = coordinate(x: 0, y: 0)", "point B = coordinate(x: 1, y: 1)"].join(
      "\n"
    );
    const newSource = [
      "nui 4",
      "let x: number = 1",
      "point A = coordinate(x: 0, y: 0)",
      "set x = 2",
      "point B = coordinate(x: 1, y: 1)"
    ].join("\n");
    const { old, next, result } = reconcileSources(oldSource, newSource);
    expect(result.createdIds.size).toBe(1);
    expect(idByName(next, "A")).toBe(idByName(old, "A"));
    expect(idByName(next, "B")).toBe(idByName(old, "B"));
  });

  it("changing a `set n` line into a `let n` declaration of the same name never inherits the set's identity", () => {
    // identityKindOf must distinguish "set" from "typedDeclaration" so a
    // rename-detection pass can never confuse the two kinds sharing a name.
    const oldSource = ["nui 4", "let n: number = 1", "set n = 2"].join("\n");
    const newSource = ["nui 4", "let n: number = 1", "let n: number = 3"].join("\n");
    const { old, next, result } = reconcileSources(oldSource, newSource);
    const oldSetIndex = old.statements.findIndex((statement) => statement.kind === "set");
    const vanishedSetId = old.statementMap!.statementIdByStatementIndex!.get(oldSetIndex);
    const newDeclarationIndex = next.statements.findIndex(
      (statement, index) => statement.kind === "typedDeclaration" && index !== 1
    );
    expect(vanishedSetId).toBeDefined();
    expect(result.vanishedIds).toContain(vanishedSetId);
    expect(next.statementMap!.statementIdByStatementIndex!.get(newDeclarationIndex)).not.toBe(vanishedSetId);
  });
});
