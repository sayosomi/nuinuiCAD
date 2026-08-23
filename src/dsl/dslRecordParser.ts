import { matchingDslDelimiter, scanCallArgs, scanDslNesting, type ScannedArg } from "./dslArgScanner";
import type { DslRecordField, DslSpan } from "./dslTypes";
import { isBareDslIdentifierChar } from "./dslTokens";
import { parseDslScalarType, type DslTypeDiagnostic } from "./dslTypeParser";

export type DslRecordDiagnostic = DslTypeDiagnostic;

export type DslRecordDefinitionStatement = {
  kind: "recordDefinition";
  name: string;
  nameSpan: DslSpan | null;
  keywordSpan: DslSpan;
  fields: readonly DslRecordField[];
  payloadSpans: Record<string, DslSpan>;
  attrs: [];
  opensBlock: false;
};

export type DslRecordParseResult = {
  statement: DslRecordDefinitionStatement | null;
  diagnostics: DslRecordDiagnostic[];
};

const whitespace = /\s/;

const trimSpan = (source: string, start: number, end: number): DslSpan => {
  while (start < end && whitespace.test(source[start]!)) start += 1;
  while (end > start && whitespace.test(source[end - 1]!)) end -= 1;
  return { start, end };
};

const isBareIdentifier = (text: string) => text.length > 0 && [...text].every((character) => isBareDslIdentifierChar(character));

const topLevelEquals = (source: string, span: DslSpan): number => {
  const nesting = scanDslNesting(source, span);
  for (let index = span.start; index < span.end; index += 1) {
    if (source[index] === "=" && nesting.topLevelPositions.has(index)) return index;
  }
  return -1;
};

const fieldType = (
  source: string,
  typeSpan: DslSpan,
  diagnostics: DslRecordDiagnostic[]
): Pick<DslRecordField, "type" | "choiceOptionSpans" | "numericTypeOptions"> => {
  const text = source.slice(typeSpan.start, typeSpan.end);
  if (text === "point" || text === "line" || text === "path") {
    diagnostics.push({
      message: `record field に geometry 型「${text}」は使用できません。v1 field は scalar 型のみです。`,
      span: typeSpan,
      code: "record-field-geometry-unsupported"
    });
    return { type: null, choiceOptionSpans: [] };
  }
  if (text.includes("[") || text.includes("]")) {
    diagnostics.push({
      message: "record field の array 型は v1 では使用できません。",
      span: typeSpan,
      code: "record-field-array-unsupported"
    });
    return { type: null, choiceOptionSpans: [] };
  }
  if (isBareIdentifier(text) && !["number", "string", "boolean", "choice"].includes(text)) {
    diagnostics.push({
      message: `record field に nested record 型「${text}」は使用できません。v1 field は scalar 型のみです。`,
      span: typeSpan,
      code: "record-field-nested-unsupported"
    });
    return { type: null, choiceOptionSpans: [] };
  }
  const before = diagnostics.length;
  const parsed = parseDslScalarType(source, typeSpan, diagnostics, {
    acceptedTypeDescription: "number/string/boolean/choice(...)"
  });
  for (let index = before; index < diagnostics.length; index += 1) {
    if (diagnostics[index]?.code === "unknown-type") diagnostics[index] = { ...diagnostics[index]!, code: "record-field-invalid-type" };
  }
  return {
    type: parsed.declaredType,
    choiceOptionSpans: parsed.choiceOptionSpans,
    ...(parsed.numericTypeOptions ? { numericTypeOptions: parsed.numericTypeOptions } : {})
  };
};

const fieldFromArg = (
  source: string,
  arg: ScannedArg,
  diagnostics: DslRecordDiagnostic[]
): DslRecordField | null => {
  if (arg.key === null || !arg.keySpan) {
    diagnostics.push({
      message: "record field は `名前: 型` の形式で指定してください。",
      span: arg.valueSpan,
      code: "record-field-invalid-shape"
    });
    return null;
  }
  if (arg.optionalSpan) {
    diagnostics.push({
      message: "optional record field は v1 では使用できません。",
      span: arg.optionalSpan,
      code: "record-field-optional-unsupported"
    });
  }

  const equals = topLevelEquals(source, arg.valueSpan);
  const typeSpan = trimSpan(source, arg.valueSpan.start, equals >= 0 ? equals : arg.valueSpan.end);
  if (equals >= 0) {
    const defaultSpan = trimSpan(source, equals + 1, arg.valueSpan.end);
    diagnostics.push({
      message: "record field default は v1 では使用できません。",
      span: defaultSpan.start < defaultSpan.end ? defaultSpan : { start: equals, end: equals + 1 },
      code: "record-field-default-unsupported"
    });
  }
  if (typeSpan.start === typeSpan.end) {
    diagnostics.push({
      message: "record field には scalar 型注釈が必要です。",
      span: arg.valueSpan,
      code: "record-field-missing-type"
    });
    return {
      kind: "recordField",
      name: arg.key,
      nameSpan: arg.keySpan,
      type: null,
      typeSpan: null,
      choiceOptionSpans: []
    };
  }

  const parsedType = fieldType(source, typeSpan, diagnostics);
  return {
    kind: "recordField",
    name: arg.key,
    nameSpan: arg.keySpan,
    type: parsedType.type,
    typeSpan,
    choiceOptionSpans: parsedType.choiceOptionSpans,
    ...(parsedType.numericTypeOptions ? { numericTypeOptions: parsedType.numericTypeOptions } : {})
  };
};

export const parseDslRecordDefinitionStatement = (logicalText: string): DslRecordParseResult => {
  const diagnostics: DslRecordDiagnostic[] = [];
  if (!logicalText.startsWith("record") || (logicalText.length > "record".length && !whitespace.test(logicalText["record".length]!))) {
    return { statement: null, diagnostics };
  }

  const keywordSpan: DslSpan = { start: 0, end: "record".length };
  const afterKeyword = trimSpan(logicalText, keywordSpan.end, logicalText.length);
  const open = logicalText.indexOf("(", afterKeyword.start);
  const nameSpan = trimSpan(logicalText, afterKeyword.start, open >= 0 ? open : logicalText.length);
  const nameText = logicalText.slice(nameSpan.start, nameSpan.end);
  const name = isBareIdentifier(nameText) ? nameText : "";
  const validNameSpan = name ? nameSpan : null;
  if (!name) {
    diagnostics.push({
      message: "record definition には裸の識別子名が必要です。",
      span: nameSpan.start < nameSpan.end ? nameSpan : keywordSpan,
      code: "record-invalid-name"
    });
  }

  if (open < 0) {
    diagnostics.push({
      message: "record definition には field list の「(」が必要です。",
      span: { start: logicalText.length, end: logicalText.length },
      code: "record-missing-field-list"
    });
  }
  const close = open >= 0 ? matchingDslDelimiter(logicalText, open) : -1;
  if (open >= 0 && close < 0) {
    diagnostics.push({
      message: "record field list の「(」が閉じられていません。",
      span: { start: open, end: open + 1 },
      code: "record-unclosed-field-list"
    });
  }
  if (close >= 0) {
    const trailing = trimSpan(logicalText, close + 1, logicalText.length);
    if (trailing.start < trailing.end) {
      diagnostics.push({
        message: "record definition の field list の後に余分なトークンがあります。",
        span: trailing,
        code: "record-trailing-token"
      });
    }
  }

  const fieldsSpan: DslSpan = {
    start: open >= 0 ? open + 1 : logicalText.length,
    end: close >= 0 ? close : logicalText.length
  };
  const scanned = scanCallArgs(logicalText, fieldsSpan, { allowOptionalKeys: true });
  diagnostics.push(...scanned.errors.map((error) => ({ message: error.message, span: error.span, ...(error.code ? { code: error.code } : {}) })));
  const fields = scanned.args.flatMap((arg) => {
    const field = fieldFromArg(logicalText, arg, diagnostics);
    return field ? [field] : [];
  });
  const firstByName = new Map<string, DslRecordField>();
  for (const field of fields) {
    const first = firstByName.get(field.name);
    if (first) {
      diagnostics.push({
        message: `record field「${field.name}」が重複しています。`,
        span: field.nameSpan,
        code: "record-field-duplicate"
      });
    } else {
      firstByName.set(field.name, field);
    }
  }

  return {
    statement: {
      kind: "recordDefinition",
      name,
      nameSpan: validNameSpan,
      keywordSpan,
      fields,
      payloadSpans: {
        ...(validNameSpan ? { name: validNameSpan } : {}),
        ...(open >= 0 && close >= 0 ? { fields: fieldsSpan } : {})
      },
      attrs: [],
      opensBlock: false
    },
    diagnostics
  };
};
