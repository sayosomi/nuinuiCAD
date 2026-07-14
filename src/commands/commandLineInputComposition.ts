let composing = false;

/** Composition state of the ephemeral CommandLineBar input, independent of CodeMirror. */
export const setCommandLineInputComposing = (next: boolean) => {
  composing = next;
};

export const isCommandLineInputComposing = () => composing;
