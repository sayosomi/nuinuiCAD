import { elementActivityValues, type ElementActivity } from "../model/elementActivity";
import { unquoteDslString } from "./dslTokens";

export const invalidElementActivityMessage = "state は visible/hidden/disabled のいずれかで指定してください。";

export const parseElementActivityLiteral = (value: string): ElementActivity | null => {
  const token = unquoteDslString(value);
  return elementActivityValues.includes(token as ElementActivity) ? token as ElementActivity : null;
};
