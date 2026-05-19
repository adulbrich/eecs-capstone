import { ProjectCard, type ProjectSummary } from "./project-card";
import { ProjectRow } from "./project-row";

type Props = {
  project: ProjectSummary;
  mode: "card" | "row";
};

export function ProjectListItem({ project, mode }: Props) {
  if (mode === "row") return <ProjectRow project={project} />;
  return <ProjectCard project={project} />;
}
