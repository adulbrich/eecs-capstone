import { Badge } from "./ui/badge";

/**
 * The count pill on a collection button. Renders nothing at zero, so an empty
 * list reads as a plain link rather than a "0" that looks like a problem.
 * Brand-colored rather than status-colored: it counts, it does not judge.
 * The `status` variant paints nothing itself, which is what lets the two
 * token classes decide the color, dark mode included.
 */
export function CountBadge({ count }: { count: number }) {
  if (count <= 0) {
    return null;
  }
  return (
    <Badge
      className="bg-primary px-1.5 font-semibold text-primary-foreground"
      variant="status"
    >
      {count}
    </Badge>
  );
}
