import { listSemanticModels } from "./semantic-model";

/** The registry facts the frontend needs to offer a source choice — serializable, no expressions or SQL. */
export type SourceOption = {
  id: string;
  label: string;
  sourceSystem: string;
  exampleQuestions: string[];
};

export function listSourceOptions(): SourceOption[] {
  return listSemanticModels().map((model) => ({
    id: model.id,
    label: model.label,
    sourceSystem: model.sourceSystem,
    exampleQuestions: model.exampleQuestions ?? [],
  }));
}
