import { describe, expect, it } from "vitest";
import {
  FIXTURE_PROJECTS,
  PLUGIN_FIXTURES,
} from "#/lib/placement/__tests__/plugin-fixtures";
import {
  type ImportIssue,
  parseBidsCsv,
  parseProjectsCsv,
  parseRows,
} from "#/lib/placement/csv";
import {
  EXPORT_FORMATS,
  formatTemplate,
  type PlacementDataset,
  STANDARD_FORMATS,
  writeFormat,
} from "#/lib/placement/formats";
import {
  detectPlugin,
  EXPORT_PLUGINS,
  fromStandard,
  PLUGINS,
  pluginById,
  readAsChoice,
  resolveFilePlugin,
  toStandard,
} from "#/lib/placement/plugins";
import { canvasGroups, canvasRoster } from "#/lib/placement/plugins/canvas";
import { pastedTitles } from "#/lib/placement/plugins/paste";
import { qualtricsBids } from "#/lib/placement/plugins/qualtrics";
import type { ExportPlugin, FilePlugin } from "#/lib/placement/plugins/types";
import { parseRosterCsv } from "#/lib/placement/roster";

/** The one parser of each dataset's standard CSV. */
const STANDARD_PARSERS: Record<
  PlacementDataset,
  (text: string) => { issues: ImportIssue[] }
> = {
  projects: parseProjectsCsv,
  roster: parseRosterCsv,
  bids: (text) => parseBidsCsv(text, FIXTURE_PROJECTS),
};

const TEMPLATES = Object.values(STANDARD_FORMATS).map(formatTemplate);

// Every registered plugin passes these, with no test of its own needed for
// the contract: a new plugin only adds its fixture (#733).
describe.each(PLUGINS.map((p) => [p.id, p] as const))(
  "plugin %s",
  (id, plugin) => {
    const fixture = PLUGIN_FIXTURES[id];

    it("has a fixture and an id no other plugin uses", () => {
      expect(fixture).toBeDefined();
      expect(PLUGINS.filter((p) => p.id === id)).toHaveLength(1);
    });

    it("converts its fixture without an error", () => {
      const converted = plugin.toStandard(fixture, {
        projects: FIXTURE_PROJECTS,
      });
      expect(converted.issues.filter((i) => i.level === "error")).toEqual([]);
    });

    it("writes standard CSV the parser reads without a word", () => {
      const converted = plugin.toStandard(fixture, {
        projects: FIXTURE_PROJECTS,
      });
      expect(STANDARD_PARSERS[plugin.dataset](converted.text).issues).toEqual(
        []
      );
    });

    if (plugin.input === "file") {
      it("claims its own fixture, over the standard format", () => {
        expect(detectPlugin(plugin.dataset, fixture)).toBe(plugin);
      });

      it("claims no standard template and no other plugin's fixture", () => {
        for (const template of TEMPLATES) {
          expect(plugin.detect(template)).toBe(false);
        }
        for (const other of PLUGINS.filter((p) => p.id !== id)) {
          expect(plugin.detect(PLUGIN_FIXTURES[other.id] ?? "")).toBe(false);
        }
      });
    }
  }
);

// Every export plugin passes these from a standard fixture under its id
// (#734), as every import plugin passes the contract above.
describe.each(EXPORT_PLUGINS.map((p) => [p.id, p] as const))(
  "export plugin %s",
  (id, plugin) => {
    const fixture = PLUGIN_FIXTURES[id];
    const format = EXPORT_FORMATS[plugin.dataset];
    const context = { filename: "placement-2026-10-04.csv" };
    const header = (text: string) => parseRows(text).fields;

    it("has a standard fixture and an id no other plugin uses", () => {
      expect(fixture).toBeDefined();
      for (const column of format.columns.filter((c) => c.required)) {
        expect(header(fixture)).toContain(column.name);
      }
      expect(
        [...PLUGINS, ...EXPORT_PLUGINS].filter((p) => p.id === id)
      ).toHaveLength(1);
    });

    it("writes its fixture without an error, with every column it needs", () => {
      const written = plugin.fromStandard(fixture, context);
      expect(written.issues.filter((i) => i.level === "error")).toEqual([]);
      expect(header(written.text)).toEqual(
        expect.arrayContaining([...plugin.requiredColumns])
      );
      expect(written.filename).not.toBe(context.filename);
    });

    it("writes the header from a standard file with no rows", () => {
      const written = plugin.fromStandard(writeFormat(format, []), context);
      expect(written.issues).toEqual([]);
      expect(header(written.text)).toEqual(
        expect.arrayContaining([...plugin.requiredColumns])
      );
    });
  }
);

describe("writing a download", () => {
  const context = { filename: "placement-2026-10-04.csv" };

  it("writes the standard CSV as it is with no plugin", () => {
    expect(fromStandard(null, "email\r\n", context)).toEqual({
      filename: "placement-2026-10-04.csv",
      text: "email\r\n",
      issues: [],
    });
  });

  it("reports a plugin that throws as a problem with the whole file", () => {
    const broken: ExportPlugin = {
      ...canvasGroups,
      fromStandard: () => {
        throw new Error("out of cheese.");
      },
    };
    expect(fromStandard(broken, "", context)).toEqual({
      filename: "placement-2026-10-04.csv",
      text: "",
      issues: [
        {
          level: "error",
          row: 1,
          message:
            "The Canvas groups file could not be written: out of cheese.",
          wholeFile: true,
        },
      ],
    });
  });
});

describe("reading a stored file", () => {
  const canvas = PLUGIN_FIXTURES["canvas-roster"];

  it("detects when nothing was chosen, and reads the standard format on null", () => {
    expect(resolveFilePlugin("roster", canvas, undefined)).toBe(canvasRoster);
    expect(resolveFilePlugin("roster", canvas, null)).toBeNull();
  });

  it("reads through a chosen plugin, even one detection would not pick", () => {
    expect(
      resolveFilePlugin(
        "roster",
        formatTemplate(STANDARD_FORMATS.roster),
        "canvas-roster"
      )
    ).toBe(canvasRoster);
  });

  it("detects again for an id no plugin has, or one for another dataset", () => {
    expect(resolveFilePlugin("roster", canvas, "gone")).toBe(canvasRoster);
    expect(resolveFilePlugin("roster", canvas, qualtricsBids.id)).toBe(
      canvasRoster
    );
    expect(pluginById("gone")).toBeUndefined();
  });

  it("stores nothing for the choice detection would make anyway", () => {
    const standard = formatTemplate(STANDARD_FORMATS.roster);
    expect(readAsChoice("roster", canvas, "canvas-roster")).toBeUndefined();
    expect(readAsChoice("roster", canvas, null)).toBeNull();
    expect(readAsChoice("roster", standard, null)).toBeUndefined();
    expect(readAsChoice("roster", standard, "canvas-roster")).toBe(
      "canvas-roster"
    );
  });

  it("reports a plugin that throws as a problem with the whole file", () => {
    const broken: FilePlugin = {
      ...canvasRoster,
      toStandard: () => {
        throw new Error("out of cheese");
      },
    };
    expect(toStandard(broken, canvas, { projects: [] })).toEqual({
      text: "",
      issues: [
        {
          level: "error",
          row: 1,
          message: "The Canvas roster export could not be read: out of cheese.",
          wholeFile: true,
        },
      ],
    });
  });
});

describe("a value that looks like a spreadsheet guard (#733)", () => {
  it("keeps its apostrophe through a plugin and the parser", () => {
    const { text } = pastedTitles.toStandard("'-Minus\n'=cmd", {
      projects: [],
    });
    expect(parseProjectsCsv(text).projects.map((p) => p.title)).toEqual([
      "'-Minus",
      "'=cmd",
    ]);
  });
});
