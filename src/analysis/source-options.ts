import { listSemanticModels } from "./semantic-model";

/**
 * The registry facts the frontend's source panel needs to offer a source
 * choice — serializable, no expressions or SQL. `database`/`table`/`rowScale`
 * are user-facing provenance straight off the SemanticModel — the same facts
 * the explanation manifest already exposes, not a new disclosure.
 */
export type SourceOption = {
  id: string;
  label: string;
  sourceSystem: string;
  database: string;
  table: string;
  rowScale?: string;
  exampleQuestions: string[];
};

export function listSourceOptions(): SourceOption[] {
  return listSemanticModels().map((model) => ({
    id: model.id,
    label: model.label,
    sourceSystem: model.sourceSystem,
    database: model.database,
    table: model.table,
    rowScale: model.rowScale,
    exampleQuestions: model.exampleQuestions ?? [],
  }));
}
