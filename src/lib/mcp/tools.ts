import "server-only";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { User } from "@/db/schema";
import { registerCatalogTools } from "@/lib/mcp/tools-catalog";
import { registerEquipmentTools } from "@/lib/mcp/tools-equipment";
import { registerPlansTools } from "@/lib/mcp/tools-plans";
import { registerReadTools } from "@/lib/mcp/tools-read";
import { registerWorkoutTools } from "@/lib/mcp/tools-workout";

/**
 * Registriert alle Werkzeuge für genau ein Konto. Die Werkzeuge selbst sind
 * nach Bereichen aufgeteilt; gemeinsame Helfer stehen in shared.ts.
 */
export function registerGymTools(server: McpServer, user: User): void {
  registerReadTools(server, user);
  registerPlansTools(server, user);
  registerCatalogTools(server, user);
  registerWorkoutTools(server, user);
  registerEquipmentTools(server, user);
}
