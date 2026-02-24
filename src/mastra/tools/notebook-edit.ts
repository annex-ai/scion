// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2025-2026 Sacha Nelson

import { constants } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";

/**
 * Jupyter Notebook structure types
 */
interface NotebookCell {
  cell_type: "code" | "markdown" | "raw";
  source: string[];
  metadata: Record<string, any>;
  execution_count?: number | null;
  outputs?: any[];
  id?: string;
}

interface NotebookContent {
  cells: NotebookCell[];
  metadata: Record<string, any>;
  nbformat: number;
  nbformat_minor: number;
}

/**
 * Generate a unique cell ID
 */
function generateCellId(): string {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * Convert source string to array format (Jupyter stores source as array of lines)
 */
function sourceToArray(source: string): string[] {
  const lines = source.split("\n");
  // Add newline to all lines except the last
  return lines.map((line, i) => (i < lines.length - 1 ? `${line}\n` : line));
}

export const notebookEditTool = createTool({
  id: "notebook-edit",
  inputSchema: z.object({
    notebook_path: z.string().describe("Path to the Jupyter notebook (.ipynb file)"),
    cell_number: z.number().int().min(0).describe("Cell index (0-based)"),
    new_source: z.string().describe("New source content for the cell"),
    cell_type: z.enum(["code", "markdown"]).optional().describe("Cell type (required for insert mode)"),
    edit_mode: z
      .enum(["replace", "insert", "delete"])
      .optional()
      .default("replace")
      .describe("Edit mode: replace, insert, or delete"),
  }),
  outputSchema: z.object({
    success: z.boolean().describe("Whether the operation succeeded"),
    message: z.string().describe("Result message"),
    cellCount: z.number().describe("Total number of cells after operation"),
    error: z.string().optional().describe("Error message if operation failed"),
  }),
  description:
    "Modifies cells in a Jupyter notebook (.ipynb file). Accepts notebook path, cell index (0-based), new source content, and edit mode. Returns success status and updated cell count. Use this tool when you need to update code or markdown cells in Jupyter notebooks, add new cells, or delete existing cells. Supports replace (update existing), insert (add new), and delete (remove) modes.",
  execute: async ({ notebook_path, cell_number, new_source, cell_type, edit_mode }) => {
    try {
      const mode = edit_mode || "replace";

      // Resolve path
      const absolutePath = isAbsolute(notebook_path) ? notebook_path : resolve(process.cwd(), notebook_path);

      // Check file exists
      await access(absolutePath, constants.R_OK | constants.W_OK);

      // Read notebook
      const content = await readFile(absolutePath, "utf-8");
      const notebook: NotebookContent = JSON.parse(content);

      // Validate notebook structure
      if (!notebook.cells || !Array.isArray(notebook.cells)) {
        return {
          success: false,
          message: "Invalid notebook: missing cells array",
          cellCount: 0,
          error: "Invalid notebook structure",
        };
      }

      const totalCells = notebook.cells.length;

      // Handle different edit modes
      if (mode === "delete") {
        // Validate cell index for delete
        if (cell_number < 0 || cell_number >= totalCells) {
          return {
            success: false,
            message: `Cell index ${cell_number} out of range (0-${totalCells - 1})`,
            cellCount: totalCells,
            error: "Cell index out of range",
          };
        }

        // Delete the cell
        notebook.cells.splice(cell_number, 1);

        // Write back
        await writeFile(absolutePath, JSON.stringify(notebook, null, 2), "utf-8");

        return {
          success: true,
          message: `Deleted cell ${cell_number}. Notebook now has ${notebook.cells.length} cells.`,
          cellCount: notebook.cells.length,
        };
      }

      if (mode === "insert") {
        // Validate cell type for insert
        if (!cell_type) {
          return {
            success: false,
            message: "cell_type is required for insert mode",
            cellCount: totalCells,
            error: "Missing cell_type parameter",
          };
        }

        // Validate cell index for insert (can be 0 to totalCells inclusive)
        if (cell_number < 0 || cell_number > totalCells) {
          return {
            success: false,
            message: `Cell index ${cell_number} out of range for insert (0-${totalCells})`,
            cellCount: totalCells,
            error: "Cell index out of range",
          };
        }

        // Create new cell
        const newCell: NotebookCell = {
          cell_type,
          source: sourceToArray(new_source),
          metadata: {},
          id: generateCellId(),
        };

        // Add code-specific properties
        if (cell_type === "code") {
          newCell.execution_count = null;
          newCell.outputs = [];
        }

        // Insert the cell
        notebook.cells.splice(cell_number, 0, newCell);

        // Write back
        await writeFile(absolutePath, JSON.stringify(notebook, null, 2), "utf-8");

        return {
          success: true,
          message: `Inserted new ${cell_type} cell at index ${cell_number}. Notebook now has ${notebook.cells.length} cells.`,
          cellCount: notebook.cells.length,
        };
      }

      // Default: replace mode
      // Validate cell index for replace
      if (cell_number < 0 || cell_number >= totalCells) {
        return {
          success: false,
          message: `Cell index ${cell_number} out of range (0-${totalCells - 1})`,
          cellCount: totalCells,
          error: "Cell index out of range",
        };
      }

      // Get existing cell
      const cell = notebook.cells[cell_number];
      const existingType = cell.cell_type;

      // Update source
      cell.source = sourceToArray(new_source);

      // Update cell type if specified
      if (cell_type && cell_type !== existingType) {
        cell.cell_type = cell_type;

        // Add/remove code-specific properties
        if (cell_type === "code") {
          cell.execution_count = null;
          cell.outputs = [];
        } else {
          cell.execution_count = undefined;
          cell.outputs = undefined;
        }
      }

      // Clear outputs for code cells when source changes
      if (cell.cell_type === "code") {
        cell.outputs = [];
        cell.execution_count = null;
      }

      // Write back
      await writeFile(absolutePath, JSON.stringify(notebook, null, 2), "utf-8");

      return {
        success: true,
        message: `Updated cell ${cell_number} (${cell.cell_type}). Notebook has ${notebook.cells.length} cells.`,
        cellCount: notebook.cells.length,
      };
    } catch (error: any) {
      if (error.code === "ENOENT") {
        return {
          success: false,
          message: `Notebook not found: ${notebook_path}`,
          cellCount: 0,
          error: "File not found",
        };
      }
      if (error.code === "EACCES") {
        return {
          success: false,
          message: `Permission denied: ${notebook_path}`,
          cellCount: 0,
          error: "Permission denied",
        };
      }
      if (error instanceof SyntaxError) {
        return {
          success: false,
          message: `Invalid JSON in notebook: ${error.message}`,
          cellCount: 0,
          error: "Invalid notebook JSON",
        };
      }

      return {
        success: false,
        message: `Error editing notebook: ${error.message}`,
        cellCount: 0,
        error: error.message,
      };
    }
  },
});
