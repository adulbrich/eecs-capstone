import { useState } from "react";
import { clearAvatar, uploadAvatar } from "#/server/uploads";
import { ImageUploader } from "./image-uploader";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Save failed. Please try again.";
}

interface Props {
  currentKey: string | null;
  onChanged: () => void;
}

export function AvatarUploader({ currentKey, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(file: File | null) {
    setBusy(true);
    setError(null);
    try {
      if (file) {
        const form = new FormData();
        form.append("file", file);
        await uploadAvatar({ data: form });
      } else {
        await clearAvatar();
      }
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <ImageUploader
        aspect={1}
        currentKey={currentKey}
        maxHeight={512}
        maxWidth={512}
        onChange={(f) => void handleChange(f)}
      />
      {busy && <p className="text-neutral-500 text-sm">Saving avatar...</p>}
      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>
  );
}
