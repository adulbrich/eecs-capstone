import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";

export interface FilterCategory {
  id: string;
  name: string;
}

interface Props {
  categories: FilterCategory[];
  onChange: (next: string[]) => void;
  selected: string[];
}

/**
 * The category filter as a stacked checkbox list under a legend, for the
 * filters column of a listing. Selection is all-match: the listing treats
 * every selected id as required, which the legend says. Renders nothing when
 * there are no categories, so a listing without any shows no empty legend.
 *
 * A flat list: inventory categories carry no type. The project listing
 * groups its categories by type and keeps its own list.
 */
export function CategoryCheckboxList({
  categories,
  onChange,
  selected,
}: Props) {
  if (categories.length === 0) {
    return null;
  }

  function toggle(id: string) {
    onChange(
      selected.includes(id)
        ? selected.filter((c) => c !== id)
        : [...selected, id]
    );
  }

  return (
    <fieldset>
      <legend className="font-medium text-muted-foreground text-xs">
        Categories (matches all selected)
      </legend>
      <div className="mt-1 space-y-1">
        {categories.map((c) => (
          <Label className="min-h-7 font-normal" key={c.id}>
            <Checkbox
              checked={selected.includes(c.id)}
              onCheckedChange={() => toggle(c.id)}
            />
            {c.name}
          </Label>
        ))}
      </div>
    </fieldset>
  );
}
