import { ImageUploader } from "./image-uploader";

type Props = {
  currentKey: string | null;
  onChange: (file: File | null) => void;
};

export function InventoryImageUploader({ currentKey, onChange }: Props) {
  return (
    <ImageUploader
      currentKey={currentKey}
      aspect={1}
      maxWidth={1200}
      maxHeight={1200}
      onChange={onChange}
    />
  );
}
