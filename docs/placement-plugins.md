# Writing a placement plugin

Placement reads one **standard format** per dataset: projects, roster and bids, each
a CSV described in `src/lib/placement/formats.ts`. A **plugin** reads some other
shape, such as an LMS export, a survey tool's export or pasted text, and writes the
standard CSV, which the dataset's one parser then reads. [ADR-0059](./adr/0059-placement-plugins-convert-to-the-standard-csv.md)
says why the boundary is CSV text and why plugins are code in this repo, never
something staff upload.

Everything here runs in the staff member's browser and nothing reaches the server
([ADR-0056](./adr/0056-placement-runs-in-the-browser.md)). A plugin must not make a
network request.

## The interface

`src/lib/placement/plugins/types.ts` has it. In short:

| Field | What it is |
| --- | --- |
| `id` | Unique across every plugin, and stable: a workspace stores it when staff choose "Read as", so renaming one sends saved choices back to detection. |
| `label` | The source's name on the page: "Converted from the `label` file.csv." and "Problems in the `label` file". |
| `dataset` | `"projects"`, `"roster"` or `"bids"`: whose standard CSV the plugin writes. |
| `input` | `"file"` for an upload the plugin detects, `"chosen"` for an upload staff choose to read through it ([custom mapping](#custom-mapping) is the one), `"paste"` for the text box. |
| `detect(text)` | A `"file"` plugin's only: true when the text is this plugin's source. Never true for any standard template or another plugin's source. |
| `menuLabel` | Optional: the option's name in "Read as", when it is not `label`. |
| `toStandard(text, { projects, mapping })` | The standard CSV and the issues the plugin found. `mapping` is the column mapping stored with the file, which only custom mapping reads. |
| `description` | Optional prose shown while a file is read through the plugin, for a rule staff would not guess. |

## The rules

- **Report issues in the source's own rows.** An `ImportIssue`'s `row` counts the
  uploaded file's rows with the header as row 1, or lines for pasted text, so staff
  can find each one in what they have. A problem that stops the whole file sets
  `wholeFile`.
- **Write only rows that are already valid and unique.** Leave out a row you
  reported an error on, and settle duplicates yourself, so the standard parser finds
  nothing more to say. If it does, the page shows that under "converted", in rows of
  a file staff never saw.
- **Always write the header**, even with no rows. `writeFormat` in `formats.ts` does
  it, in the standard column order.
- **Assume no institution.** Read an email as it comes, never add a domain, and keep
  any one school's wording out of the standard formats.
- **Read the project list from the context, not at upload.** The roster and the
  bids are converted on every read, so a plugin that names projects sees the list as
  it is now. Projects themselves are converted once, at import, because staff edit
  them afterward.

## Detection

For an uploaded file the page tries the dataset's standard format first (every
required column present), then each file plugin in the order `PLUGINS` lists them in
`src/lib/placement/plugins/index.ts`; the first match reads it. Staff can change it
with "Read as", which stores the choice as `readAs`: the plugin id, or `null` for
the standard format, and nothing when the choice is what detection picks anyway.
A stored id no plugin has any more is detected again. A plugin that throws is
reported as a problem with the whole file rather than breaking the page. Report
what you can as issues instead, so staff see which row to fix.

A plugin may be chosen rather than detected (#735): a `"chosen"` plugin has no
`detect`, claims no file, and reads a file only once staff pick it with "Read as"
or "Map columns", so the detection order above covers detected plugins alone.
Custom mapping is the one, and the contract test runs its own branch for it.

## Custom mapping

`src/lib/placement/plugins/custom-mapping.ts` reads a file through a **column
mapping** staff build on the page (#735): which header of the file fills each
standard column, one row in and one row out. It is the plugin whose
configuration is data rather than code, as ADR-0059 requires of anything staff
bring.

It is a **chosen** plugin, `input: "chosen"` (`ChosenPlugin` in `types.ts`), so
it has no `detect` and never claims a file. The page offers it as "Map columns"
when detection finds nothing and the file is not the standard format, and as
"Column mapping" (its `menuLabel`) in "Read as" for any uploaded file, recognized
or not. `uploadPlugins(dataset)` in `index.ts` is what "Read as" lists: the
detected plugins, then the chosen ones; `filePlugins` stays the detected ones
alone. There is one per dataset, each with its own id: `custom-mapping-projects`,
`custom-mapping-roster` and `custom-mapping-bids`.

The roster and the bids store the column mapping in their workspace entry beside
the file (`readAs: "custom-mapping-roster"` plus `mapping`), so it is read through
on every load, travels in the workspace export and changes the run's fingerprint
when it changes. Choosing another "Read as" keeps the column mapping stored but
unused, and leaves the fingerprint as if it were not there; choosing "Column
mapping" again reads through it. Removing the file removes it. Projects are stored
parsed, so a projects column mapping runs once at import and is not kept. Value
transforms, such as "1st choice" to 1, are out of scope.

A column mapping downloads as a small JSON file, to load again next term or in
another department:

```json
{
  "version": 1,
  "dataset": "roster",
  "columns": {
    "Student Email": "email",
    "Full Name": "name",
    "Team": "project"
  }
}
```

- `version` is the shape's number: 1 for columns alone, 2 with `wide` below.
  `MAPPING_VERSION` is the latest the page reads; a file with a later number is
  refused with a message naming both. A version 1 file loads and reads exactly as
  it did before version 2, and a `wide` key in one is ignored, as any unknown key
  always was. The page writes version 1 whenever a column mapping does not read
  wide, so a roster or long bids column mapping still loads on a build that reads
  version 1 alone, and the run fingerprint of a stored version 1 column mapping is
  unchanged.
- `dataset` is `"projects"`, `"roster"` or `"bids"`, and must match where it is
  loaded.
- `columns` pairs each header the column mapping reads, as the file spells it,
  with the standard column it fills. Header case and surrounding spaces are
  ignored, as the standard format ignores them. Each standard column takes at most
  one header, every value must be a column of the dataset's format, and a required
  column left out stops the file with a problem naming it.

### Reading a bids file wide

A survey tool such as Google Forms or Microsoft Forms exports bids wide: one row
per student and one column per project, the cell holding the rank (#736). A bids
column mapping reads such a file with `wide`, at version 2:

```json
{
  "version": 2,
  "dataset": "bids",
  "columns": {
    "Email Address": "email",
    "Your name": "name"
  },
  "wide": {
    "projectColumns": { "by": "prefix", "prefix": "Rank the projects" },
    "title": { "by": "brackets" }
  }
}
```

- `projectColumns` is every column whose header starts with `prefix`
  (`{ "by": "prefix", "prefix": "..." }`), or the headers staff ticked
  (`{ "by": "headers", "headers": ["...", "..."] }`). Case and surrounding spaces
  are ignored, as for `columns`. A picked header the file lacks is named, as a
  missing student column is.
- `title` says where each project column's header holds the project's title: the
  text after the first `separator` (`{ "by": "separator", "separator": " - " }`,
  the default, as Qualtrics writes it), or the text inside the last pair of square
  brackets (`{ "by": "brackets" }`, as a Google Forms grid writes `Rank the
  projects [Tide Clock]`). `header-title.ts` holds both readings, and the
  Qualtrics plugin reads its headers through the same separator function.
- `columns` may then fill only `email`, `name` and `avoid`, which repeat on every
  bid the student's row gives; the project columns fill `priority` and `project`,
  and the schema refuses a header for any other column.

Each filled cell of a project column becomes one long bids row, `priority` the
cell as it is and `project` the header's title, in the file's column order. A
blank cell gives nothing, and a row with no filled project cell gives a warning on
its row. Priorities are checked by `parseBidsCsv`, not the plugin, and the
extracted titles reach title matching like any other. Read wide, one file row
gives several converted rows, so the problems listed for the converted file name
rows of the converted CSV, which staff can download.

The file stops, as a problem with the whole file, when a project column's header
gives no title, when a header is both a student column and a project column, or
when no column is a project column; each names the header and its column letter,
as `Column E, "Rank the projects", is a project column, but its header has no
title inside square brackets.` The editor shows the same message and holds Apply
until the column mapping is changed.

Loading a column mapping against a file that lacks one of its headers names the
header, and the page keeps saying so until that column takes another header;
Apply leaves out a missing optional column. Reading a stored file through such a
column mapping reports it as a problem with the whole file. A stored or imported
workspace whose column mapping cannot be read (another version, another dataset,
or the wrong shape) is still read: that column mapping is removed from the
workspace, the file is detected again if it was read through it, and the page says
why until the file is replaced or given a new column mapping. The next save drops
it from storage too, so a tab on an older build deletes a newer build's column
mapping; staff map the columns again. Issue rows name the uploaded file's rows
even after blank lines before its header, which a column-mapped file keeps ahead
of its converted header for that reason. A column mapping never reaches the server
(ADR-0056).

## Adding one

1. Write the module in `src/lib/placement/plugins/`.
2. Add it to `PLUGINS` in `index.ts`, at the position that keeps detection
   unambiguous.
3. Add a fixture under its id to `src/lib/placement/__tests__/plugin-fixtures.ts`:
   invented people and `example.edu` addresses only. A chosen plugin puts its
   fixtures in `CHOSEN_FIXTURES` instead, a list under its id with one per way
   staff can choose to read a file, each with the context that choice gives it,
   such as custom mapping's `mapping`; the bids have a long one and a wide one.
4. Run `npx vitest run src/lib/placement`. `plugins.contract.test.ts` runs the contract on
   every registered plugin: it has a fixture, converts it without an error, writes
   CSV the standard parser reads without an issue, claims its own fixture over the
   standard format, and claims no standard template and no other plugin's fixture.
   A chosen plugin instead reads a fixture nothing detects, is listed in "Read as"
   but not among the detected plugins, is read through once chosen, and reports
   reading without its choice as a problem with the whole file.
5. Add tests of your own for the source's quirks, as `canvas.test.ts` and
   `qualtrics.test.ts` do.

## Export plugins

An **export plugin** goes the other way: it reads a standard CSV placement wrote and
writes the file another tool imports, offered on the Results tab under "Download as"
after the standard CSV (#734). Placement writes two standard CSVs, listed in
`EXPORT_FORMATS` in `formats.ts`: the placement (`PLACEMENT_FORMAT`, what
`placementCsv` in `board.ts` writes) and the bids with their pins
(`BIDS_FORMAT`). The bids download shows the button alone until a plugin writes
that dataset. `canvasGroups` in `canvas.ts` is the example: it writes Canvas's
[group set import](https://canvas.instructure.com/doc/api/file.group_category_csv.html),
and lives beside the Canvas roster import.

`ExportPlugin` in `types.ts` is its own type, with no `detect` and no `input`, and
`EXPORT_PLUGINS` in `index.ts` is its own list, so nothing on the import side, from
detection to Read as, ever sees one.

| Field | What it is |
| --- | --- |
| `id` | Unique across every plugin, import or export, and never `standard`, which the Read as and Download as selects use for the standard format (`STANDARD_OPTION`; the contract test checks). |
| `label` | The option's name in "Download as". |
| `dataset` | `"placement"` or `"bids"`: whose standard CSV the plugin reads. |
| `description` | Shown while the option is chosen: what the other tool does with the file, and what the file leaves out. Required, because staff need it before they import. |
| `requiredColumns` | The columns the other tool needs. The contract test checks the plugin writes them. |
| `fromStandard(text, { filename })` | The file, the name to save it under (derive it from `filename`, the standard download's name), and the issues it found. |

Read cells with `cell` from `csv.ts`, which takes off the spreadsheet guard
`toCsv` put on, and write with `toCsv` or `writeFormat`, which puts it back, so a
title like `-Minus` is guarded once. Report an issue in the standard CSV's rows,
header as row 1, and leave that row out. A warning keeps its row: `canvasGroups`
warns when two projects or teams would write the same group name, and still writes
both. The page shows the issues under the download, under the plugin's name, and a
problem with the whole file, a plugin that throws included, stops the download and
says the file was not written.

To add one, write it, add it to `EXPORT_PLUGINS`, and put a standard CSV under its
id in `plugin-fixtures.ts`. The contract test checks the fixture has the dataset's
required columns, that the plugin writes it with no error and with every column in
`requiredColumns`, and that it writes the header from a standard file with no rows.
