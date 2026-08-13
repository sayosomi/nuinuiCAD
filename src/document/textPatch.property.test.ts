import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { expectSemanticallyEqualDocuments } from "../dsl/dslDocumentTestUtils";
import { parseDsl } from "../dsl/dslParser";
import type { CadElementType } from "../types/geometry";
import {
  applyRandomOp,
  compileOrFail,
  generateDocumentSource,
  type GeneratedDocParams,
  type RandomOp
} from "./documentTestGenerators";
import { reconcileStatements } from "./statementReconciler";
import { applyLineSplices, buildTextPatch } from "./textPatch";

const paramsArb: fc.Arbitrary<GeneratedDocParams> = fc.record({
  pointCount: fc.integer({ min: 2, max: 6 }),
  groupCount: fc.integer({ min: 0, max: 2 }),
  withIf: fc.boolean(),
  withFor: fc.boolean(),
  withLayout: fc.boolean(),
  unnamedCount: fc.integer({ min: 0, max: 2 }),
  noiseEvery: fc.integer({ min: 2, max: 5 }),
  withContinuation: fc.boolean()
});

const opArb: fc.Arbitrary<RandomOp> = fc.record({
  kind: fc.constantFrom(
    "updateAttr",
    "rename",
    "insert",
    "deleteLeaf",
    "deleteReferencedTarget",
    "deleteSubtree",
    "ungroup",
    "move",
    "reparent",
    "paletteEdit",
    "stopMove",
    "profileToggle",
    "layoutEdit"
  ),
  a: fc.nat({ max: 1000 }),
  b: fc.nat({ max: 1000 })
});

const FC_OPTIONS = { seed: 20260709, numRuns: 30 };

describe("textPatch プロパティ", () => {
  it("ランダム操作列: 各ステップでパース可能・意味的等価・ノイズ行バイト不変", () => {
    fc.assert(
      fc.property(paramsArb, fc.array(opArb, { minLength: 1, maxLength: 6 }), (params, ops) => {
        const generated = generateDocumentSource(params);
        let compiled = compileOrFail(generated.source);
        const trace: string[] = [];

        for (const op of ops) {
          const applied = applyRandomOp(compiled.document!, op);
          trace.push(applied.description);
          const splices = buildTextPatch({ old: compiled, newDocument: applied.document });
          const patched = applyLineSplices(compiled.sourceLines.join("\n"), splices);
          const reparsed = compileDslDocument(patched);
          expect(
            reparsed.diagnostics.filter((item) => item.severity === "error"),
            `step [${trace.join(" | ")}] must reparse:\n${patched}`
          ).toEqual([]);
          expectSemanticallyEqualDocuments(reparsed.document!, applied.document);

          for (const noise of generated.noiseLines) {
            expect(
              patched.split("\n").includes(noise),
              `noise line "${noise}" must survive step [${trace.join(" | ")}]:\n${patched}`
            ).toBe(true);
          }

          compiled = reparsed as ReturnType<typeof compileOrFail>;
          expect(compiled.statementMap).not.toBeNull();
        }
      }),
      FC_OPTIONS
    );
  });

  it("照合連鎖: パッチ適用後の再パースで生存要素のIDが全て継承される", () => {
    fc.assert(
      fc.property(paramsArb, fc.array(opArb, { minLength: 1, maxLength: 6 }), (params, ops) => {
        const generated = generateDocumentSource(params);
        let compiled = compileOrFail(generated.source);
        const trace: string[] = [];
        let idCounter = 0;
        const createId = (type: CadElementType) => `chain-${type}-${(idCounter += 1)}`;

        for (const op of ops) {
          const applied = applyRandomOp(compiled.document!, op);
          trace.push(applied.description);
          const splices = buildTextPatch({ old: compiled, newDocument: applied.document });
          const patched = applyLineSplices(compiled.sourceLines.join("\n"), splices);
          const normalized = patched.replace(/\r\n/g, "\n");
          const parsedNew = parseDsl(normalized);

          const result = reconcileStatements(
            {
              oldStatements: compiled.statements,
              oldLines: compiled.sourceLines,
              oldElementIds: compiled.statementMap!.elementIdByStatementIndex,
              oldStatementIds: compiled.statementMap!.statementIdByStatementIndex,
              newStatements: parsedNew.statements,
              newLines: normalized.split("\n")
            },
            { createId }
          );

          const reconciled = compileDslDocument(normalized, { assignedElementIds: result.assignedIds });
          expect(
            reconciled.diagnostics.filter((item) => item.severity === "error"),
            `step [${trace.join(" | ")}] must compile`
          ).toEqual([]);

          // 位置対応: 新モデルの i 番目の要素と再パース結果の i 番目の要素は
          // 同じ文書位置。旧文書から生き残った要素は同じIDを継承しているはず。
          const oldIds = new Set(compiled.document!.elements.map((element) => element.id));
          const insertedIds = new Set(applied.insertedIds);
          expect(reconciled.document!.elements.length).toBe(applied.document.elements.length);
          applied.document.elements.forEach((expected, index) => {
            const actual = reconciled.document!.elements[index];
            if (oldIds.has(expected.id) && !insertedIds.has(expected.id)) {
              expect(
                actual.id,
                `element ${expected.name || expected.id} (index ${index}) should inherit its ID after [${trace.join(" | ")}]`
              ).toBe(expected.id);
            }
          });
          // 継承率: 生存要素は全て継承、新規は挿入分のみ。
          expect(result.createdIds.size).toBe(insertedIds.size);

          // 次ステップの旧状態は「照合済みIDで再コンパイルした結果」。
          compiled = reconciled;
          expect(compiled.statementMap).not.toBeNull();
          // モデルの残りフィールド(palette等)も一致していること。
          expectSemanticallyEqualDocuments(compiled.document!, applied.document);
        }
      }),
      FC_OPTIONS
    );
  });

  it("要素IDだけでなく要素本体も位置対応で意味的に一致する(全文置換の健全性)", () => {
    // 全文置換相当: 生成文書Aから生成文書Bへの一括パッチも表現できる。
    fc.assert(
      fc.property(paramsArb, paramsArb, (paramsA, paramsB) => {
        const a = generateDocumentSource(paramsA);
        const b = generateDocumentSource({ ...paramsB, noiseEvery: 0 });
        const compiledA = compileOrFail(a.source);
        const compiledB = compileOrFail(b.source);
        const splices = buildTextPatch({ old: compiledA, newDocument: compiledB.document! });
        const patched = applyLineSplices(a.source, splices);
        const reparsed = compileDslDocument(patched);
        expect(reparsed.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
        expectSemanticallyEqualDocuments(reparsed.document!, compiledB.document!);
      }),
      { ...FC_OPTIONS, numRuns: 15 }
    );
  });
});

describe("statementReconciler プロパティ(補助)", () => {
  it("無変更テキストの再パースは全IDを段階1で継承する", () => {
    fc.assert(
      fc.property(paramsArb, (params) => {
        const generated = generateDocumentSource(params);
        const compiled = compileOrFail(generated.source);
        const parsedNew = parseDsl(generated.source);
        const result = reconcileStatements(
          {
            oldStatements: compiled.statements,
            oldLines: compiled.sourceLines,
            oldElementIds: compiled.statementMap!.elementIdByStatementIndex,
            oldStatementIds: compiled.statementMap!.statementIdByStatementIndex,
            newStatements: parsedNew.statements,
            newLines: generated.source.split("\n")
          },
          { createId: (type) => `unexpected-${type}` }
        );
        expect(result.createdIds.size).toBe(0);
        expect(result.vanishedIds).toEqual([]);
        expect(result.inheritedCount).toBe(compiled.statementMap!.statementIdByStatementIndex!.size);
        for (const stage of result.stageByNewStatementIndex.values()) expect(stage).toBe(1);
      }),
      FC_OPTIONS
    );
  });
});
