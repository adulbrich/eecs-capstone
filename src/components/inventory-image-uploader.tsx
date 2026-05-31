import { ImageUploader } from "./image-uploader";

interface Props {
  currentKey: string | null;
  onChange: (file: File | null) => void;
}

export function InventoryImageUploader({ currentKey, onChange }: Props) {
  return (
    <ImageUploader
      aspect={1}
      currentKey={currentKey}
      maxHeight={1200}
      maxWidth={1200}
      onChange={onChange}
    />
  );
}
