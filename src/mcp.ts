#!/usr/bin/env node
import { fileURLToPath } from "url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { runPiTask, cancelPiTask, listActiveTasks } from "./runner.js";
import { runPiDoctor } from "./doctor.js";
import { listProviders } from "./providers.js";
import { runPiReview } from "./review.js";

export const TOOLS = [
  {
    name: "pi_run_task",
    description:
      "Dispatch an autonomous coding task to the Pi Coding Agent in headless mode. Operates directly on the specified repository, reasons autonomously, creates/edits files, executes bash commands, tracks multi-repo git diffs, and returns structured execution results with $0 front-end token burn.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description: "Absolute path to repository/workspace.",
        },
        task: {
          type: "string",
          description: "Clear explicit instructions for the task.",
        },
        provider: {
          type: "string",
          description: "Optional inference provider (freetoken, nvidia-nim, ollama, openrouter).",
        },
        model: {
          type: "string",
          description: "Optional model override.",
        },
        timeoutMs: {
          type: "number",
          description: "Max execution time in milliseconds (default: 30 minutes).",
        },
        verbose: {
          type: "boolean",
          description: "Include raw stdout/stderr in output.",
        },
      },
      required: ["cwd", "task"],
    },
  },
  {
    name: "pi_doctor",
    description:
      "Health-check the Pi Coding Agent environment. Checks 'pi' binary installation and tests connectivity across configured providers (FreeToken, NVIDIA NIM, Ollama, OpenRouter).",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "pi_list_providers",
    description:
      "List all configured inference providers (FreeToken, NVIDIA NIM, Ollama, OpenRouter) with their base URLs, default models, and auth requirements.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "pi_cancel_task",
    description: "Terminate an active Pi Coding Agent task process by taskId.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "ID of the task to terminate.",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "pi_list_active_tasks",
    description: "List currently running Pi tasks with their duration and workspace.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "pi_review_task",
    description:
      "Automated code review and QA verification tool for dual-agent workflows. Inspects git diffs, executes test suites, and queries the configured local/free model for a structured evaluation of architectural intent compliance and code quality.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description: "Absolute path to repository/workspace.",
        },
        brief: {
          type: "string",
          description: "Architectural intent or task description to audit the changes against.",
        },
        diff: {
          type: "string",
          description: "Optional explicit git diff string. If omitted, diff is automatically computed from git status/HEAD.",
        },
        testCommand: {
          type: "string",
          description: "Optional test or build command to execute for automated QA verification (e.g. 'npm test').",
        },
        provider: {
          type: "string",
          description: "Optional provider override for the review evaluator.",
        },
        model: {
          type: "string",
          description: "Optional model override for the review evaluator.",
        },
      },
      required: ["cwd", "brief"],
    },
  },
  // Backward-compatible DSH aliases
  {
    name: "dsh_run_task",
    description:
      "(Legacy compatibility alias for pi_run_task) Dispatch an autonomous coding task to the Pi Coding Agent in headless mode.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description: "Absolute path to repository/workspace.",
        },
        task: {
          type: "string",
          description: "Clear explicit instructions for the task.",
        },
        provider: {
          type: "string",
          description: "Optional inference provider (freetoken, nvidia-nim, ollama, openrouter).",
        },
        model: {
          type: "string",
          description: "Optional model override.",
        },
        endpoint: {
          type: "string",
          description: "Optional model endpoint override URL.",
        },
        timeoutMs: {
          type: "number",
          description: "Max execution time in milliseconds (default: 30 minutes).",
        },
        verbose: {
          type: "boolean",
          description: "Include raw stdout/stderr in output.",
        },
      },
      required: ["cwd", "task"],
    },
  },
  {
    name: "dsh_doctor",
    description:
      "(Legacy compatibility alias for pi_doctor) Health-check the Pi Coding Agent environment.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "dsh_cancel_task",
    description:
      "(Legacy compatibility alias for pi_cancel_task) Terminate an active task process by taskId.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "ID of the task to terminate.",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "dsh_list_active_tasks",
    description:
      "(Legacy compatibility alias for pi_list_active_tasks) List currently running tasks with their duration and workspace.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "dsh_review_task",
    description:
      "(Legacy compatibility alias for pi_review_task) Automated code review and QA verification tool for dual-agent workflows.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description: "Absolute path to repository/workspace.",
        },
        brief: {
          type: "string",
          description: "Architectural intent or task description to audit the changes against.",
        },
        diff: {
          type: "string",
          description: "Optional explicit git diff string. If omitted, diff is automatically computed from git status/HEAD.",
        },
        testCommand: {
          type: "string",
          description: "Optional test or build command to execute for automated QA verification (e.g. 'npm test').",
        },
        provider: {
          type: "string",
          description: "Optional provider override for the review evaluator.",
        },
        model: {
          type: "string",
          description: "Optional model override for the review evaluator.",
        },
        endpoint: {
          type: "string",
          description: "Optional model endpoint override URL.",
        },
      },
      required: ["cwd", "brief"],
    },
  },
];

export const server = new Server(
  {
    name: "pi-agent-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "pi_run_task":
      case "dsh_run_task": {
        const { cwd, task, provider, model, endpoint, apiKey, timeoutMs, verbose } = (args || {}) as any;
        if (!cwd || !task) {
          throw new Error("Missing required arguments 'cwd' and 'task'.");
        }
        const result = await runPiTask({
          cwd,
          task,
          provider,
          model,
          timeoutMs,
          verbose,
          ...(endpoint ? { endpoint } : {}),
          ...(apiKey ? { apiKey } : {}),
        } as any);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "pi_doctor":
      case "dsh_doctor": {
        const report = await runPiDoctor();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(report, null, 2),
            },
          ],
        };
      }

      case "pi_list_providers": {
        const providers = listProviders();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ count: providers.length, providers }, null, 2),
            },
          ],
        };
      }

      case "pi_cancel_task":
      case "dsh_cancel_task": {
        const { taskId } = (args || {}) as any;
        if (!taskId) {
          throw new Error("Missing required argument 'taskId'.");
        }
        const cancelled = cancelPiTask(taskId);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  taskId,
                  cancelled,
                  message: cancelled
                    ? `Task ${taskId} was terminated successfully.`
                    : `Task ${taskId} not found or already completed.`,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "pi_list_active_tasks":
      case "dsh_list_active_tasks": {
        const tasks = listActiveTasks();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ count: tasks.length, tasks }, null, 2),
            },
          ],
        };
      }

      case "pi_review_task":
      case "dsh_review_task": {
        const { cwd, brief, diff, testCommand, provider, model, endpoint } = (args || {}) as any;
        if (!cwd || !brief) {
          throw new Error("Missing required arguments 'cwd' and 'brief'.");
        }
        const result = await runPiReview({
          cwd,
          brief,
          diff,
          testCommand,
          provider,
          model,
          endpoint,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err: any) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: err?.message || String(err) }, null, 2),
        },
      ],
      isError: true,
    };
  }
});


export async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("Pi Agent MCP Server (pi-agent-mcp) running on stdio\n");
}

const isDirectRun = Boolean(
  process.argv[1] &&
    (process.argv[1] === fileURLToPath(import.meta.url) ||
      process.argv[1].endsWith("/mcp.js") ||
      process.argv[1].endsWith("/mcp.ts") ||
      process.argv[1].endsWith("pi-agent-mcp"))
);

if (isDirectRun) {
  runServer().catch((error) => {
    process.stderr.write(`Fatal error: ${error}\n`);
    process.exit(1);
  });
}

