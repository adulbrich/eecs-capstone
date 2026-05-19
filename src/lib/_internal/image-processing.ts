import sharp from "sharp";

export type ProcessImageOptions = {
  maxWidth: number;
  maxHeight: number;
};

export type ProcessedImage = {
  buffer: Buffer;
  contentType: "image/webp";
  width: number;
  height: number;
};

export async function processImage(
  input: Buffer,
  opts: ProcessImageOptions,
): Promise<ProcessedImage> {
  const buffer = await sharp(input)
    .rotate()
    .resize({
      width: opts.maxWidth,
      height: opts.maxHeight,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 85 })
    .withMetadata({})
    .toBuffer();

  const { width, height } = await sharp(buffer).metadata();
  return {
    buffer,
    contentType: "image/webp",
    width: width ?? 0,
    height: height ?? 0,
  };
}
