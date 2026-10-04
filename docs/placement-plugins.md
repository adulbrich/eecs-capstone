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
| `id` | Stable. A workspace stores it when staff choose "Read as", so renaming one sends saved choices back to detection. |
| `label` | The source's name on the page: "Converted from the `label` file.csv." and "Problems in the `label` file". |
| `dataset` | `"projects"`, `"roster"` or `"bids"`: whose standard CSV the plugin writes. |
| `input` | `"file"` for an upload, `"paste"` for the text box. A file plugin also has `detect`. |
| `detect(text)` | True when the text is this plugin's source. Never true for any standard template or another plugin's source. |
| `toStandard(text, { projects })` | The standard CSV and the issues the plugin found. |
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

## Adding one

1. Write the module in `src/lib/placement/plugins/`.
2. Add it to `PLUGINS` in `index.ts`, at the position that keeps detection
   unambiguous.
3. Add a fixture under its id to `src/lib/placement/__tests__/plugin-fixtures.ts`:
   invented people and `example.edu` addresses only.
4. Run `npx vitest run src/lib/placement`. `plugins.contract.test.ts` runs the contract on
   every registered plugin: it has a fixture, converts it without an error, writes
   CSV the standard parser reads without an issue, claims its own fixture over the
   standard format, and claims no standard template and no other plugin's fixture.
5. Add tests of your own for the source's quirks, as `canvas.test.ts` and
   `qualtrics.test.ts` do.
