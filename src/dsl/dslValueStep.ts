import {
  defaultNumericParameterStep,
  findParameterDefinition,
  getNumericParameterStep
} from "../parameters/parameterDefinitions";
import type { CadElement } from "../types/geometry";
import { resolveParameterTargetAt, type DslParameterSpanContext } from "./dslParameterSpans";
import type { DslSpan } from "./dslTypes";

export type DslValueStepDirection = -1 | 1;

export type DslValueStepResult = {
  parameterKey: string;
  from: number;
  to: number;
  insert: string;
  selection: DslSpan;
};

const numericLiteral = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

type Decimal = {
  sign: 1 | -1;
  digits: string;
  scale: number;
};

const decimalFromText = (text: string): Decimal | null => {
  const match = text.match(/^([+-]?)(?:(\d+)(?:\.(\d+))?|\.(\d+))(?:e([+-]?\d+))?$/i);
  if (!match) return null;

  const sign = match[1] === "-" ? -1 : 1;
  const integer = match[2] ?? "0";
  const fraction = match[3] ?? match[4] ?? "";
  const exponent = Number(match[5] ?? "0");
  if (!Number.isInteger(exponent)) return null;
  let digits = `${integer}${fraction}`.replace(/^0+/, "") || "0";
  let scale = fraction.length - exponent;
  if (scale < 0) {
    digits += "0".repeat(-scale);
    scale = 0;
  }
  return { sign, digits, scale };
};

const decimalFromStep = (step: number) =>
  Number.isFinite(step) && step > 0 ? decimalFromText(`${step}`) : null;

const scaleDecimal = (decimal: Decimal, scale: number) => {
  if (scale < decimal.scale) return null;
  return BigInt(decimal.sign) * BigInt(decimal.digits) * (10n ** BigInt(scale - decimal.scale));
};

const formatDecimal = (value: bigint, scale: number) => {
  if (value === 0n) return "0";
  const sign = value < 0n ? "-" : "";
  let digits = (value < 0n ? -value : value).toString();
  if (scale > 0) {
    digits = digits.padStart(scale + 1, "0");
    digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, "");
  }
  return `${sign}${digits}`;
};

/** Adds a positive finite step without introducing binary floating-point artifacts. */
export const stepDslNumericLiteral = (
  literal: string,
  step: number,
  direction: DslValueStepDirection
) => {
  if (!numericLiteral.test(literal)) return null;
  const value = decimalFromText(literal);
  const amount = decimalFromStep(step);
  if (!value || !amount) return null;
  const scale = Math.max(value.scale, amount.scale);
  const scaledValue = scaleDecimal(value, scale);
  const scaledAmount = scaleDecimal(amount, scale);
  if (scaledValue === null || scaledAmount === null) return null;
  const next = formatDecimal(scaledValue + BigInt(direction) * scaledAmount, scale);
  return Number.isFinite(Number(next)) ? next : null;
};

const choiceAfterStep = (
  value: string,
  options: readonly string[],
  direction: DslValueStepDirection
) => {
  const index = options.indexOf(value);
  if (index < 0 || options.length === 0) return null;
  return options[(index + direction + options.length) % options.length] ?? null;
};

/**
 * Resolves and rewrites one editor-native value without parsing parameter mappings
 * independently. Parameter/span semantics are owned by resolveParameterTargetAt.
 */
export const resolveDslValueStep = (
  lineText: string,
  element: CadElement,
  selection: DslSpan,
  direction: DslValueStepDirection,
  context: DslParameterSpanContext = {}
): DslValueStepResult | null => {
  const target = resolveParameterTargetAt(lineText, element, selection, context);
  if (!target) return null;
  if (selection.start !== selection.end &&
    (selection.start !== target.start || selection.end !== target.end)) return null;

  const value = lineText.slice(target.start, target.end);
  const definition = findParameterDefinition(element, target.parameterKey);
  let insert: string | null = null;
  if (!definition || definition.kind === "number") {
    insert = stepDslNumericLiteral(
      value,
      definition ? getNumericParameterStep(element, definition.key) : defaultNumericParameterStep,
      direction
    );
  } else if (definition.kind === "boolean") {
    insert = value === "true" ? "false" : value === "false" ? "true" : null;
  } else if (definition.kind === "choice" && definition.choiceOptions) {
    insert = choiceAfterStep(value, definition.choiceOptions, direction);
  }
  if (insert === null || insert === value) return null;
  return {
    parameterKey: target.parameterKey,
    from: target.start,
    to: target.end,
    insert,
    selection: { start: target.start, end: target.start + insert.length }
  };
};
