import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Switch } from "#/components/ui/switch";

export function MentorFields({
  wants,
  count,
  onToggle,
  onCountChange,
}: {
  count: number;
  onCountChange: (n: number) => void;
  onToggle: (on: boolean) => void;
  wants: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Switch
          checked={wants}
          id="wants-to-mentor"
          onCheckedChange={onToggle}
        />
        <Label className="font-normal" htmlFor="wants-to-mentor">
          I want to mentor a team
        </Label>
      </div>
      <p className="text-muted-foreground text-xs">
        For professionals and faculty, not students.
      </p>
      {wants && (
        <div className="space-y-1.5">
          <Label htmlFor="mentor-team-count">
            How many teams can you mentor?
          </Label>
          <Input
            className="w-24"
            id="mentor-team-count"
            max={5}
            min={1}
            onBlur={(e) => {
              const n = Number(e.target.value);
              if (!Number.isFinite(n) || n < 1) {
                onCountChange(1);
              } else if (n > 5) {
                onCountChange(5);
              }
            }}
            onChange={(e) => onCountChange(Number(e.target.value))}
            type="number"
            value={count}
          />
        </div>
      )}
    </div>
  );
}
