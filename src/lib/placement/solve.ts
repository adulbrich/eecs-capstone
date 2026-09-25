import type { Highs, ModelData } from "highs";
import {
  buildPlacementModel,
  type PlacementModel,
} from "#/lib/placement/model";
import type {
  Placement,
  PlacementInput,
  PlacementResult,
  PlacementStatus,
} from "#/lib/placement/types";

/**
 * Solves one placement with a loaded HiGHS runtime. The caller owns loading
 * it: the worker loads it once from the bundled WASM, and the tests load it
 * in Node. `run()` blocks, which is why the page calls this from a worker.
 */
export function solvePlacement(
  highs: Highs,
  input: PlacementInput
): PlacementResult {
  const model = buildPlacementModel(input);
  const base: PlacementResult = {
    status: "optimal",
    placements: [],
    unplaced: model.unplaced,
    gap: null,
    objective: 0,
    diagnostics: model.diagnostics,
  };
  if (model.students.length === 0) {
    return base;
  }

  try {
    return runModel(highs, model, input, base);
  } catch (error) {
    // HiGHS validates the model before it runs and throws on a value it
    // cannot take, such as a NaN weight from a hand-edited workspace. Any
    // other throw on the way to a result lands here too, and the page shows
    // it the same way.
    return {
      ...base,
      status: "error",
      objective: null,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function runModel(
  highs: Highs,
  model: PlacementModel,
  input: PlacementInput,
  base: PlacementResult
): PlacementResult {
  return highs.withModel(toModelData(highs, model), (m) => {
    m.options.set({
      output_flag: false,
      time_limit: input.parameters.timeLimitSeconds,
    });
    m.run();
    const status = toStatus(highs, m.getModelStatus());
    const feasible =
      Number(m.info.get("primal_solution_status")) ===
      highs.constants.solutionStatus.feasible;
    if (status === "error") {
      return {
        ...base,
        status,
        objective: null,
        message: `HiGHS stopped with model status ${m.getModelStatus()}`,
      };
    }
    if (!feasible) {
      return { ...base, status, objective: null };
    }
    return {
      ...base,
      status,
      placements: readPlacements(model, m.getSolution().colValue),
      objective: m.getObjectiveValue(),
      gap: status === "time_limit" ? Number(m.info.get("mip_gap")) : null,
    };
  });
}

function toModelData(highs: Highs, model: PlacementModel): ModelData {
  const starts = [0];
  const indices: number[] = [];
  const values: number[] = [];
  for (const row of model.rows) {
    for (const [column, coefficient] of row.entries) {
      indices.push(column);
      values.push(coefficient);
    }
    starts.push(indices.length);
  }
  const finite = (n: number) =>
    Number.isFinite(n) ? n : Math.sign(n) * highs.infinity;
  return {
    numCols: model.columns.length,
    numRows: model.rows.length,
    sense: highs.constants.objectiveSense.maximize,
    colCost: model.columns.map((c) => c.cost),
    colLower: model.columns.map(() => 0),
    colUpper: model.columns.map(() => 1),
    integrality: model.columns.map(() => highs.constants.variableType.integer),
    rowLower: model.rows.map((r) => finite(r.lower)),
    rowUpper: model.rows.map((r) => finite(r.upper)),
    matrix: {
      format: "csr",
      numRows: model.rows.length,
      numCols: model.columns.length,
      starts,
      indices,
      values,
    },
  };
}

function toStatus(highs: Highs, code: number): PlacementStatus {
  const s = highs.constants.modelStatus;
  switch (code) {
    case s.optimal:
      return "optimal";
    case s.timeLimit:
    case s.interrupted:
      return "time_limit";
    case s.infeasible:
    case s.unboundedOrInfeasible:
      return "infeasible";
    default:
      return "error";
  }
}

function readPlacements(
  model: PlacementModel,
  values: ArrayLike<number>
): Placement[] {
  const placements: Placement[] = [];
  model.columns.forEach((column, index) => {
    if (column.kind !== "placement" || values[index] < 0.5) {
      return;
    }
    const slot = model.slots[column.slot];
    placements.push({
      email: model.students[column.student].email,
      projectKey: slot.projectKey,
      team: slot.team,
      priority: column.priority,
    });
  });
  return placements;
}
