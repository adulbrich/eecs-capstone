# Single canonical URL per resource

Each project and each item has one detail URL, and the staff-only sections (private panel, lifecycle controls, edit log, danger zone) render conditionally on it by viewer. There is no `/admin/projects/$id`. A URL staff share works for everyone, nothing is duplicated, and the page cannot show a staff member something the data rules would refuse an endpoint. List views may live at separate URLs, since `/admin/projects` and `/projects` run genuinely different queries.
