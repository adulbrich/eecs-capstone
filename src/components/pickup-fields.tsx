import {
  lastPickupDay,
  officeToday,
  pickupWindowInput,
} from "#/lib/pickup-window";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

/** What the pickup fields hold while staff type. "" is unset. */
export interface PickupFormValue {
  day: string;
  from: string;
  note: string;
  place: string;
  to: string;
}

export const EMPTY_PICKUP: PickupFormValue = {
  day: "",
  from: "",
  note: "",
  place: "",
  to: "",
};

/**
 * The form a dialog opens with: the terms already on a hold, read back in the
 * office's zone, or blank with `fallbackPlace` copied in. The inverse of
 * `pickupPayload`.
 */
export function pickupFormValue(
  stored: {
    pickupBy?: Date | string | null;
    pickupFrom?: Date | string | null;
    pickupNote?: string | null;
    pickupPlace?: string | null;
  },
  fallbackPlace: string | null
): PickupFormValue {
  const typed = pickupWindowInput(stored.pickupFrom, stored.pickupBy);
  return {
    day: typed.pickupDay ?? "",
    from: typed.pickupFromTime ?? "",
    to: typed.pickupToTime ?? "",
    place: stored.pickupPlace ?? fallbackPlace ?? "",
    note: stored.pickupNote ?? "",
  };
}

/**
 * The fields as the server takes them (`PICKUP_FIELDS`). Sent as typed: the
 * server reads "" as unset, trims, and composes the day and times in the
 * office's zone, so nothing here builds a Date.
 */
export function pickupPayload(value: PickupFormValue) {
  return {
    pickupDay: value.day,
    pickupFromTime: value.from,
    pickupToTime: value.to,
    pickupPlace: value.place,
    pickupNote: value.note,
  };
}

/**
 * The pickup terms staff give on an approval or a reserve (#799): a day, a
 * From and To on it, where to pick up, and a note. One component so the
 * three dialogs that set them cannot drift.
 *
 * `placeHint` says where the place came from and that the requester reads
 * it, because a value the dialog filled in is one staff may not have looked
 * at. The caller decides the prefill; this never reads an item's location.
 */
export function PickupFields({
  audience = "requester",
  disabled,
  idPrefix,
  onChange,
  placeHint,
  value,
}: {
  /** Who reads the note: the item page can reserve to a walk-in with no request. */
  audience?: "holder" | "requester";
  disabled?: boolean;
  idPrefix: string;
  onChange: (next: PickupFormValue) => void;
  placeHint: string;
  value: PickupFormValue;
}) {
  function field(key: keyof PickupFormValue) {
    return (e: { target: { value: string } }) =>
      onChange({ ...value, [key]: e.target.value });
  }
  const hintId = `${idPrefix}-place-hint`;
  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-day`}>Pickup day (optional)</Label>
        <Input
          disabled={disabled}
          id={`${idPrefix}-day`}
          max={lastPickupDay()}
          min={officeToday()}
          onChange={field("day")}
          type="date"
          value={value.day}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-from`}>From</Label>
          <Input
            disabled={disabled}
            id={`${idPrefix}-from`}
            onChange={field("from")}
            type="time"
            value={value.from}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-to`}>To</Label>
          <Input
            disabled={disabled}
            id={`${idPrefix}-to`}
            onChange={field("to")}
            type="time"
            value={value.to}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-place`}>Where to pick up (optional)</Label>
        <Input
          aria-describedby={hintId}
          disabled={disabled}
          id={`${idPrefix}-place`}
          maxLength={200}
          onChange={field("place")}
          value={value.place}
        />
        <p className="text-muted-foreground text-xs" id={hintId}>
          {placeHint}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-note`}>
          Note for the {audience} (optional)
        </Label>
        <Textarea
          disabled={disabled}
          id={`${idPrefix}-note`}
          maxLength={2000}
          onChange={field("note")}
          rows={2}
          value={value.note}
        />
      </div>
    </div>
  );
}
