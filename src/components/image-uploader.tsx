import { Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactCrop, {
  type Crop,
  centerCrop,
  makeAspectCrop,
} from "react-image-crop";
import { getPublicUrl } from "#/lib/storage";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Image processing failed.";
}

interface Props {
  aspect?: number;
  currentKey: string | null;
  maxHeight: number;
  maxWidth: number;
  // Emits the cropped File once the user commits a crop, or null when
  // the user clicks Remove. The parent decides when to actually upload.
  onChange: (file: File | null) => void;
}

export function ImageUploader({
  currentKey,
  aspect,
  maxWidth,
  maxHeight,
  onChange,
}: Props) {
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [cleared, setCleared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Preview URL for the cropped File. Revoked on cleanup so we don't leak.
  const previewUrl = useMemo(
    () => (pickedFile ? URL.createObjectURL(pickedFile) : null),
    [pickedFile]
  );
  useEffect(
    () => () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    },
    [previewUrl]
  );

  const savedUrl = cleared || pickedFile ? null : getPublicUrl(currentKey);
  const displayUrl = previewUrl ?? savedUrl;
  const hasContent = Boolean(pickedFile || (!cleared && currentKey));

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setSourceUrl(reader.result as string);
      setCrop(null);
      setError(null);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const { width, height } = e.currentTarget;
    if (aspect) {
      setCrop(
        centerCrop(
          makeAspectCrop({ unit: "%", width: 80 }, aspect, width, height),
          width,
          height
        )
      );
    } else {
      setCrop({
        unit: "%",
        x: 10,
        y: 10,
        width: 80,
        height: 80,
      });
    }
  }

  async function onConfirmCrop() {
    if (!(imgRef.current && crop)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const blob = await renderCropToWebpBlob(
        imgRef.current,
        crop,
        maxWidth,
        maxHeight
      );
      const file = new File([blob], "upload.webp", { type: "image/webp" });
      setPickedFile(file);
      setCleared(false);
      setSourceUrl(null);
      setCrop(null);
      onChange(file);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function onCancelCrop() {
    setSourceUrl(null);
    setCrop(null);
    setError(null);
  }

  function onRemove() {
    setPickedFile(null);
    setCleared(true);
    setError(null);
    onChange(null);
  }

  return (
    <div>
      {sourceUrl ? (
        <div className="space-y-2">
          <ReactCrop
            aspect={aspect}
            crop={crop ?? undefined}
            keepSelection
            onChange={(c) => setCrop(c)}
          >
            {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: react-image-crop requires onLoad to measure the image */}
            <img
              alt=""
              onLoad={onImageLoad}
              ref={imgRef}
              src={sourceUrl}
              style={{ maxHeight: 400 }}
            />
          </ReactCrop>
          <div className="flex gap-2">
            <button
              className="bg-brand px-3 py-1.5 text-sm text-white disabled:opacity-50"
              disabled={busy || !crop}
              onClick={() => void onConfirmCrop()}
              type="button"
            >
              {busy ? "Processing..." : "Use image"}
            </button>
            <button
              className="border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
              disabled={busy}
              onClick={onCancelCrop}
              type="button"
            >
              Cancel
            </button>
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {displayUrl ? (
            <img
              alt="Current"
              className="max-h-48 border border-neutral-200 object-contain dark:border-neutral-800"
              src={displayUrl}
            />
          ) : (
            <p className="text-neutral-500 text-sm">No image set.</p>
          )}
          <div className="flex gap-2">
            <button
              className="border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700/50"
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              {hasContent ? "Replace image" : "Upload image"}
            </button>
            {hasContent && (
              <button
                className="inline-flex items-center gap-1 border border-red-300 px-3 py-1.5 text-red-700 text-sm hover:bg-red-50 dark:hover:bg-red-950"
                onClick={onRemove}
                type="button"
              >
                <Trash2 className="h-4 w-4" /> Remove
              </button>
            )}
          </div>
          <input
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={onPickFile}
            ref={fileInputRef}
            type="file"
          />
          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>
      )}
    </div>
  );
}

async function renderCropToWebpBlob(
  img: HTMLImageElement,
  crop: Crop,
  maxWidth: number,
  maxHeight: number
): Promise<Blob> {
  const scaleX = img.naturalWidth / img.width;
  const scaleY = img.naturalHeight / img.height;
  const pxCrop =
    crop.unit === "%"
      ? {
          x: (crop.x / 100) * img.width,
          y: (crop.y / 100) * img.height,
          width: (crop.width / 100) * img.width,
          height: (crop.height / 100) * img.height,
        }
      : crop;

  const srcX = pxCrop.x * scaleX;
  const srcY = pxCrop.y * scaleY;
  const srcW = pxCrop.width * scaleX;
  const srcH = pxCrop.height * scaleY;

  const aspect = srcW / srcH;
  let targetW = Math.min(srcW, maxWidth);
  let targetH = Math.round(targetW / aspect);
  if (targetH > maxHeight) {
    targetH = maxHeight;
    targetW = Math.round(targetH * aspect);
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(targetW));
  canvas.height = Math.max(1, Math.floor(targetH));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D not supported");
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);

  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/webp",
      0.85
    )
  );
}
