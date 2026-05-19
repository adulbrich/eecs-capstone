import { TrashIcon } from "@heroicons/react/24/outline";
import { useRef, useState } from "react";
import ReactCrop, {
  type Crop,
  centerCrop,
  makeAspectCrop,
} from "react-image-crop";
import { getPublicUrl } from "#/lib/storage";

function errorMessage(err: unknown): string {
  return err instanceof Error
    ? err.message
    : "Upload failed. Please try again.";
}

type Props = {
  currentKey: string | null;
  aspect?: number;
  maxWidth: number;
  maxHeight: number;
  upload: (file: File) => Promise<{ key: string }>;
  onUploaded: (key: string) => void;
  onCleared?: () => Promise<void>;
};

export function ImageUploader({
  currentKey,
  aspect,
  maxWidth,
  maxHeight,
  upload,
  onUploaded,
  onCleared,
}: Props) {
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState<Crop | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const currentUrl = getPublicUrl(currentKey);

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setSourceUrl(reader.result as string);
      setCrop(null);
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
          height,
        ),
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

  async function onConfirm() {
    if (!imgRef.current || !crop) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await renderCropToWebpBlob(
        imgRef.current,
        crop,
        maxWidth,
        maxHeight,
      );
      const file = new File([blob], "upload.webp", { type: "image/webp" });
      const { key } = await upload(file);
      onUploaded(key);
      setSourceUrl(null);
      setCrop(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function onCancel() {
    setSourceUrl(null);
    setCrop(null);
    setError(null);
  }

  async function onClickClear() {
    if (!onCleared) return;
    setBusy(true);
    setError(null);
    try {
      await onCleared();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {sourceUrl ? (
        <div className="space-y-2">
          <ReactCrop
            crop={crop ?? undefined}
            onChange={(c) => setCrop(c)}
            aspect={aspect}
            keepSelection
          >
            <img
              ref={imgRef}
              src={sourceUrl}
              onLoad={onImageLoad}
              alt=""
              style={{ maxHeight: 400 }}
            />
          </ReactCrop>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void onConfirm()}
              disabled={busy || !crop}
              className="bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {busy ? "Uploading..." : "Save image"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
            >
              Cancel
            </button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {currentUrl ? (
            <img
              src={currentUrl}
              alt="Current"
              className="max-h-48 border border-neutral-200 object-contain dark:border-neutral-800"
            />
          ) : (
            <p className="text-sm text-neutral-500">No image set.</p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
            >
              {currentKey ? "Replace image" : "Upload image"}
            </button>
            {currentKey && onCleared && (
              <button
                type="button"
                onClick={() => void onClickClear()}
                disabled={busy}
                className="inline-flex items-center gap-1 border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
              >
                <TrashIcon className="h-4 w-4" /> Remove
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={onPickFile}
            className="hidden"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}

async function renderCropToWebpBlob(
  img: HTMLImageElement,
  crop: Crop,
  maxWidth: number,
  maxHeight: number,
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
  if (!ctx) throw new Error("Canvas 2D not supported");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);

  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/webp",
      0.85,
    ),
  );
}
