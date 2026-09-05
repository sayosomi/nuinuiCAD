import type { AutomationDocument } from "../document/automationDocument";

const documentBySession = new WeakMap<object, AutomationDocument>();

export const registerNuiLanguageSessionDocument = (
  session: object,
  document: AutomationDocument
): void => {
  documentBySession.set(session, document);
};

export const documentForNuiLanguageSession = (
  session: object
): AutomationDocument | undefined => documentBySession.get(session);
