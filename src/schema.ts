import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Ajv2020, ErrorObject, ValidateFunction } from "ajv/dist/2020.js";
import type { FormatsPlugin } from "ajv-formats";
import { HarnessError } from "./errors.js";

const schemaDirectory = fileURLToPath(new URL("../schemas/", import.meta.url));
const require = createRequire(import.meta.url);
const Ajv2020Constructor = require("ajv/dist/2020") as typeof Ajv2020;
const addFormats = require("ajv-formats") as FormatsPlugin;
const ajv = new Ajv2020Constructor({ allErrors: true, strict: true });
addFormats(ajv);

function compile(name: string): ValidateFunction {
  const value = JSON.parse(readFileSync(join(schemaDirectory, name), "utf8")) as object;
  return ajv.compile(value);
}

const validateScenarioDocument = compile("scenario.schema.json");
const validateReportDocument = compile("report.schema.json");

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => {
    const path = error.instancePath || "$";
    return `${path} ${error.message ?? "is invalid"}`;
  });
}

export function scenarioSchemaErrors(value: unknown): string[] {
  return validateScenarioDocument(value) ? [] : formatErrors(validateScenarioDocument.errors);
}

export function assertReportSchema(value: unknown): void {
  if (!validateReportDocument(value)) {
    throw new HarnessError("INVALID_REPORT", formatErrors(validateReportDocument.errors).join("; "));
  }
}
