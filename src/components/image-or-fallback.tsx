import { ImageIcon } from "lucide-react";
import { cn } from "#/lib/utils.ts";

export function ImageOrFallback({
  src,
  className,
}: {
  src: string | null;
  className: string;
}) {
  if (src) {
    return <img alt="" className={className} loading="lazy" src={src} />;
  }
  return (
    <div
      className={cn(className, "flex items-center justify-center")}
      style={{
        background:
          "linear-gradient(135deg, var(--surface-sunken), var(--surface-base))",
      }}
    >
      <ImageIcon
        aria-hidden
        className="size-8 text-[var(--text-secondary)] opacity-30"
      />
    </div>
  );
}
