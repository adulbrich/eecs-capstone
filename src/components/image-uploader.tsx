import { Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactCrop, {
  type Crop,
  centerCrop,
  makeAspectCrop,
} from "react-image-crop";
import { IMAGE_FILE_ACCEPT } from "#/lib/image-upload-policy";
import { getPublicUrl } from "#/lib/storage";
import { Button } from "./ui/button";

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
            <Button
              disabled={busy || !crop}
              onClick={() => void onConfirmCrop()}
              size="sm"
            >
              {busy ? "Processing..." : "Use image"}
            </Button>
            <Button
              disabled={busy}
              onClick={onCancelCrop}
              size="sm"
              variant="outline"
            >
              Cancel
            </Button>
          </div>
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {displayUrl ? (
            <img
              alt="Current"
              className="max-h-48 border border-border object-contain"
              src={displayUrl}
            />
          ) : (
            <p className="text-muted-foreground text-sm">No image set.</p>
          )}
          <div className="flex gap-2">
            <Button
              onClick={() => fileInputRef.current?.click()}
              size="sm"
              variant="outline"
            >
              {hasContent ? "Replace image" : "Upload image"}
            </Button>
            {hasContent && (
              <Button
                className="border-destructive/30 text-destructive hover:bg-[var(--status-error-bg)] hover:text-destructive"
                onClick={onRemove}
                size="sm"
                variant="outline"
              >
                <Trash2 className="h-4 w-4" /> Remove
              </Button>
            )}
          </div>
          <input
            accept={IMAGE_FILE_ACCEPT}
            className="hidden"
            onChange={onPickFile}
            ref={fileInputRef}
            type="file"
          />
          {error && <p className="text-destructive text-sm">{error}</p>}
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
