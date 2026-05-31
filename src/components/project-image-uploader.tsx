import { ImageUploader } from "./image-uploader";

interface Props {
  currentKey: string | null;
  onChange: (file: File | null) => void;
}

export function ProjectImageUploader({ currentKey, onChange }: Props) {
  return (
    <ImageUploader
      aspect={16 / 9}
      currentKey={currentKey}
      maxHeight={900}
      maxWidth={1600}
      onChange={onChange}
    />
  );
}
