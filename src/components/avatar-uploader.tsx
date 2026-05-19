import { clearAvatar, uploadAvatar } from "#/server/uploads";
import { ImageUploader } from "./image-uploader";

type Props = {
  currentKey: string | null;
  onChanged: () => void;
};

export function AvatarUploader({ currentKey, onChanged }: Props) {
  return (
    <ImageUploader
      currentKey={currentKey}
      aspect={1}
      maxWidth={512}
      maxHeight={512}
      upload={async (file) => {
        const form = new FormData();
        form.append("file", file);
        return uploadAvatar({ data: form });
      }}
      onUploaded={onChanged}
      onCleared={async () => {
        await clearAvatar();
        onChanged();
      }}
    />
  );
}
