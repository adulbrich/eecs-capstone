import { uploadProjectImage } from "#/server/uploads";
import { ImageUploader } from "./image-uploader";

type Props = {
  projectId: string;
  currentKey: string | null;
  onUploaded: (key: string) => void;
};

export function ProjectImageUploader({
  projectId,
  currentKey,
  onUploaded,
}: Props) {
  return (
    <ImageUploader
      currentKey={currentKey}
      aspect={16 / 9}
      maxWidth={1600}
      maxHeight={900}
      upload={async (file) => {
        const form = new FormData();
        form.append("projectId", projectId);
        form.append("file", file);
        return uploadProjectImage({ data: form });
      }}
      onUploaded={onUploaded}
    />
  );
}
