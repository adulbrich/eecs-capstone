# A fact that is a column on `projects` never also becomes a category

A category classifies a project by something the schema does not already record: a field, a technology, an industry. Whether a project is sponsored or student proposed is a column, `isSponsored` or `studentProposed`, that the form sets and the listings filter on, so a category carrying the same fact can only agree with the column or lie. The dev seed carried three `project_type` categories, "Industry Sponsored", "Faculty Sponsored" and "Student Led", and an instructor reading the picker took "type" to mean that group rather than the facet a category is filed under; "student-led" is also vocabulary `CONTEXT.md` avoids. The seed rows went in #374, and a new fact about a project goes in a column with a filter, not in a category. The alternative, dropping the columns and keeping the categories, was not taken: a column is required, typed and validated, and a category is a tag staff have to remember to apply. Decided 2026-09-14 in #374.

## Consequences

`scripts/seed-dev.ts` seeds `field`, `technology` and `industry` types only. A proposal for a category that duplicates a column is declined by pointing here; a proposal for a fact the schema lacks is a schema change first.
