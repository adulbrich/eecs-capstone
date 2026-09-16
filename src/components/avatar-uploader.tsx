import { useAction } from "#/lib/use-action";
import { clearAvatar, uploadAvatar } from "#/server/uploads";
import { ImageUploader } from "./image-uploader";
import { FieldError } from "./ui/field";

interface Props {
  currentKey: string | null;
  onChanged: () => Promise<void>;
}

export function AvatarUploader({ currentKey, onChanged }: Props) {
  // The crop and the preview are `ImageUploader`'s; what reaches here is one
  // write, so the hook fits. The guard that matters is its ref: nothing here
  // is `disabled` at all, so two files chosen in one tick would both upload
  // and the second object would be the one nobody asked for (#443).
  const { busy, error, run } = useAction({
    fallback: "Save failed. Please try again.",
  });

  function handleChange(file: File | null) {
    return run(async () => {
      if (file) {
        const form = new FormData();
        form.append("file", file);
        await uploadAvatar({ data: form });
      } else {
        await clearAvatar();
      }
      await onChanged();
    });
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
      {busy && (
        <p className="text-muted-foreground text-sm">Saving avatar...</p>
      )}
      <FieldError message={error} />
    </div>
  );
}
