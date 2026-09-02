import { readFileSync } from "node:fs";

const matrixContractUrl = new URL(
  "../.github/workflow-lint-matrix.json",
  import.meta.url,
);

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

export function validateWorkflowLintMatrix(matrix) {
  if (!Array.isArray(matrix) || matrix.length === 0) {
    throw new Error(
      "Workflow lint matrix contract must be a non-empty array.",
    );
  }

  const keys = new Set();
  const names = new Set();
  return matrix.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(
        `Workflow lint matrix contract entry ${index} must be an object.`,
      );
    }

    for (const field of ["platform", "architecture", "runner", "name"]) {
      if (!isNonEmptyString(entry[field])) {
        throw new Error(
          `Workflow lint matrix contract entry ${index} is missing ${field}.`,
        );
      }
    }

    const expectedName =
      `Workflow lint (${entry.platform} ${entry.architecture} on ${entry.runner})`;
    if (entry.name !== expectedName) {
      throw new Error(
        `Workflow lint matrix contract entry ${index} has job identity "${entry.name}"; expected "${expectedName}".`,
      );
    }

    const key = `${entry.platform}/${entry.architecture}`;
    if (keys.has(key)) {
      throw new Error(
        `Workflow lint matrix contract contains duplicate entry ${key}.`,
      );
    }
    if (names.has(entry.name)) {
      throw new Error(
        `Workflow lint matrix contract contains duplicate job name "${entry.name}".`,
      );
    }

    keys.add(key);
    names.add(entry.name);
    return {
      platform: entry.platform,
      architecture: entry.architecture,
      runner: entry.runner,
      name: entry.name,
    };
  });
}

export function getWorkflowLintMatrix() {
  const matrix = JSON.parse(readFileSync(matrixContractUrl, "utf8"));
  return validateWorkflowLintMatrix(matrix);
}