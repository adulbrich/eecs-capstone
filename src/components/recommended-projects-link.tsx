import { Link } from "@tanstack/react-router";

/**
 * The listing's search schema names the server ordering `order`; `sort` is the
 * table's column sort and means nothing to the ranking. Own component so a
 * unit test can pin the target without rendering the profile route.
 */
export function RecommendedProjectsLink() {
  return (
    <Link search={{ order: "recommended" }} to="/projects">
      See your recommended projects
    </Link>
  );
}
