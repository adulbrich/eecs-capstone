import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";
import { CustomRequestForm } from "#/components/custom-request-form";
import { pageTitle } from "#/lib/page-title";

// `q` is the search that found nothing on `/inventory`, carried into the
// first card's name. Optional and caught: a stale link renders an empty
// form rather than a router error.
const searchSchema = z.object({
  q: z.string().max(200).optional().catch(undefined),
});

export const Route = createFileRoute("/_authed/inventory/request")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: pageTitle("Request Equipment") }] }),
  component: RequestEquipment,
});

/**
 * Asking for equipment the inventory does not hold. `_authed` is the whole
 * gate: any signed-in user may ask, and the server scopes the envelope to
 * the session user.
 */
function RequestEquipment() {
  const { q } = Route.useSearch();
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:p-8">
      <h1 className="font-semibold text-2xl">
        Request equipment we do not have
      </h1>
      <p className="mt-2 text-muted-foreground text-sm">
        One card per thing. Staff answer each line, tell you what they are
        doing, and reserve the items to you once they exist.
      </p>
      <div className="mt-6">
        <CustomRequestForm
          initialName={q}
          onSubmitted={() => {
            toast.success("Request submitted. Staff will answer each line.");
            void navigate({ to: "/my/items", search: { filter: "open" } });
          }}
        />
      </div>
    </div>
  );
}
