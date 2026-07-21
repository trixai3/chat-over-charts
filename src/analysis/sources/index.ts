import type { SemanticModel } from "../types";
import { ukHousePrices } from "./england-wales-house-prices/model";

// Compile-time Source Pack registry: adding a source is a one-line change
// here, and the planner, ClickHouse compiler, chart policy and agent tools
// stay untouched. Registration order is not significant.
export const SOURCES: SemanticModel[] = [ukHousePrices];
