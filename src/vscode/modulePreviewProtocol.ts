export type VscodeModulePreviewTarget = {
  type: "modulePreviewTarget";
  documentVersion: number;
  normalizedSourceOffset: number;
};

export type VscodeModulePreviewTargetUnavailable = {
  type: "modulePreviewTargetUnavailable";
  documentVersion: number;
};

export type VscodeExtensionToModulePreviewMessage =
  | VscodeModulePreviewTarget
  | VscodeModulePreviewTargetUnavailable;
