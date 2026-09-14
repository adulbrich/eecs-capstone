import { Link } from "@tanstack/react-router";

/**
 * The listing's search schema names the server ordering `order`; `sort` is the
 * table's column sort and means nothing to the ranking. Own component so a
 * unit test can pin the target without rendering the profile route.
 *
 * Underlined at rest: its one home is the muted "Saved." line under the
 * interests form (UI-CONVENTIONS, "A link inside colored prose").
 */
export function RecommendedProjectsLink() {
  return (
    <Link
      className="text-brand-dark underline"
      search={{ order: "recommended" }}
      to="/projects"
    >
      See your recommended projects
    </Link>
  );
}
