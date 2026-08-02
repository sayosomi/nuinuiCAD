import { useState } from "react";
import type { FormEvent } from "react";
import { commitPendingImageImport } from "../commands/imageCreationCommands";
import { initialImageScale } from "../geometry/imageScale";
import type { PendingImageImport } from "../state/cadUiStore";
import { useCadUiStore } from "../state/cadUiStore";

const positiveNumber = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const formatNumber = (value: number) =>
  Number.isInteger(value) ? `${value}` : `${Math.round(value * 1000) / 1000}`;

export const ImageImportDialog = () => {
  const pendingImageImport = useCadUiStore((state) => state.pendingImageImport);
  const imageImportError = useCadUiStore((state) => state.imageImportError);

  if (!pendingImageImport && !imageImportError) return null;

  const close = () => {
    useCadUiStore.getState().setPendingImageImport(null);
    useCadUiStore.getState().setImageImportError(null);
  };

  return (
    <div
      className="image-import-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
    >
      <section
        className="image-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="画像読み込み設定"
      >
        <div className="shortcut-overlay-header">
          <div>
            <h2>画像読み込み設定</h2>
            <p>{pendingImageImport?.displayName ?? "画像を読み込めません"}</p>
          </div>
          <button type="button" onClick={close}>閉じる</button>
        </div>

        {imageImportError && !pendingImageImport ? (
          <p className="image-import-error">{imageImportError}</p>
        ) : null}

        {pendingImageImport ? (
          <ImageImportForm
            key={pendingImageImport.sourcePath}
            pendingImageImport={pendingImageImport}
            close={close}
          />
        ) : null}
      </section>
    </div>
  );
};

type ImageImportFormProps = {
  pendingImageImport: PendingImageImport;
  close: () => void;
};

const ImageImportForm = ({
  pendingImageImport,
  close
}: ImageImportFormProps) => {
  const [sourceDpiInput, setSourceDpiInput] = useState(formatNumber(pendingImageImport.sourceDpi));
  const [targetPixelsPerMmInput, setTargetPixelsPerMmInput] = useState(
    formatNumber(pendingImageImport.targetPixelsPerMm)
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();

    const sourceDpi = positiveNumber(sourceDpiInput);
    const targetPixelsPerMm = positiveNumber(targetPixelsPerMmInput);
    if (!sourceDpi || !targetPixelsPerMm) {
      setValidationError("DPIとpx/mmは0より大きい数値で入力してください。");
      return;
    }

    const committed = commitPendingImageImport({
      sourcePath: pendingImageImport.sourcePath,
      displayName: pendingImageImport.displayName,
      naturalWidthPx: pendingImageImport.naturalWidthPx,
      naturalHeightPx: pendingImageImport.naturalHeightPx,
      sourceDpi,
      targetPixelsPerMm,
      sourceInsertion: pendingImageImport.sourceInsertion
    });
    if (committed) close();
  };

  const sourceDpi = positiveNumber(sourceDpiInput);
  const targetPixelsPerMm = positiveNumber(targetPixelsPerMmInput);
  const initialScale =
    sourceDpi && targetPixelsPerMm ? initialImageScale(sourceDpi, targetPixelsPerMm) : null;

  return (
    <form className="image-import-form" onSubmit={submit}>
      <div className="image-import-summary">
        <span>{pendingImageImport.naturalWidthPx} x {pendingImageImport.naturalHeightPx}px</span>
        <span>
          {pendingImageImport.detectedDpi
            ? `画像DPI ${formatNumber(pendingImageImport.detectedDpi)}`
            : "画像DPIなし"}
        </span>
      </div>
      <label>
        <span>DPI</span>
        <input
          value={sourceDpiInput}
          inputMode="decimal"
          onChange={(event) => {
            setSourceDpiInput(event.target.value);
            setValidationError(null);
          }}
        />
      </label>
      <label>
        <span>読み込み時の基準解像度 px/mm</span>
        <input
          value={targetPixelsPerMmInput}
          inputMode="decimal"
          onChange={(event) => {
            setTargetPixelsPerMmInput(event.target.value);
            setValidationError(null);
          }}
        />
      </label>
      {initialScale ? (
        <p className="image-import-note">初期倍率 {formatNumber(initialScale)}</p>
      ) : null}
      {validationError ? <p className="image-import-error">{validationError}</p> : null}
      <div className="image-import-actions">
        <button type="button" onClick={close}>キャンセル</button>
        <button type="submit">読み込む</button>
      </div>
    </form>
  );
};
