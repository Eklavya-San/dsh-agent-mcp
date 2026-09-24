#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { runDshTask, cancelDshTask, listActiveTasks } from "./runner.js";
import { runDshDoctor } from "./doctor.js";
import { getWebStatus, startWebUi, stopWebUi } from "./web.js";
import { listSessions } from "./sessions.js";
import { runDshReview } from "./review.js";

const TOOLS = [
  {
    name: "dsh_run_task",
    description:
      "Dispatch an autonomous coding task to DeepSeek Harness in headless mode using the configured local/free model. " +
      "The worker operates directly on the specified repository, reasons autonomously, creates/edits files, executes bash commands, " +
      "tracks git diffs, and returns structured execution results with zero front-end token burn.",
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
        model: {
          type: "string",
          description: "Optional model override (e.g. qwen2.5-coder:32b, Qwen3.6-35B-A3B-NVFP4).",
        },
        endpoint: {
          type: "string",
          description: "Optional OpenAI-compatible endpoint URL (e.g. http://localhost:11434/v1).",
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
      "Health-check the DeepSeek Harness setup. Checks DSH binary installation, ~/.dsh/settings.yaml configuration, " +
      "model endpoint connectivity, and Web UI status.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "dsh_web_status",
    description:
      "Check if the DeepSeek Harness Web UI is currently running on port 3080, and list active sessions count.",
    inputSchema: {
      type: "object",
      properties: {
        port: {
          type: "number",
          description: "Port to check (default: 3080).",
        },
      },
    },
  },
  {
    name: "dsh_web_start",
    description:
      "Start the DeepSeek Harness Web UI companion in background daemon mode on port 3080 (http://127.0.0.1:3080).",
    inputSchema: {
      type: "object",
      properties: {
        port: {
          type: "number",
          description: "Port to bind (default: 3080).",
        },
      },
    },
  },
  {
    name: "dsh_web_stop",
    description:
      "Stop the running DeepSeek Harness Web UI companion process on port 3080.",
    inputSchema: {
      type: "object",
      properties: {
        port: {
          type: "number",
          description: "Port to terminate (default: 3080).",
        },
      },
    },
  },
  {
    name: "dsh_list_sessions",
    description:
      "Discover and list existing DeepSeek Harness sessions stored in ~/.dsh/sessions/, sorted by most recent.",
    inputSchema: {
      type: "object",
      properties: {
        workspace: {
          type: "string",
          description: "Optional filter to match workspace path.",
        },
      },
    },
  },
  {
    name: "dsh_cancel_task",
    description: "Terminate an active DeepSeek Harness task process by taskId.",
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
    description: "List currently running DeepSeek Harness tasks with their duration and workspace.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "dsh_review_task",
    description:
      "Automated code review and QA verification tool for dual-agent workflows. Inspects git diffs, executes test suites, " +
      "and queries the configured local/free model for a structured evaluation of architectural intent compliance and code quality.",
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
        model: {
          type: "string",
          description: "Optional model override for the review evaluator.",
        },
        endpoint: {
          type: "string",
          description: "Optional OpenAI-compatible model endpoint URL.",
        },
      },
      required: ["cwd", "brief"],
    },
  },
];


const server = new Server(
  {
    name: "dsh-agent-mcp",
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
      case "dsh_run_task": {
        const { cwd, task, model, endpoint, apiKey, profile, timeoutMs, verbose } = (args || {}) as any;
        if (!cwd || !task) {
          throw new Error("Missing required arguments 'cwd' and 'task'.");
        }
        const result = await runDshTask({ cwd, task, model, endpoint, apiKey, profile, timeoutMs, verbose });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "dsh_doctor": {
        const report = await runDshDoctor();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(report, null, 2),
            },
          ],
        };
      }

      case "dsh_web_status": {
        const port = (args as any)?.port || 3080;
        const status = await getWebStatus(port);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(status, null, 2),
            },
          ],
        };
      }

      case "dsh_web_start": {
        const port = (args as any)?.port || 3080;
        const status = await startWebUi(port);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(status, null, 2),
            },
          ],
        };
      }

      case "dsh_web_stop": {
        const port = (args as any)?.port || 3080;
        const result = await stopWebUi(port);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "dsh_list_sessions": {
        const workspace = (args as any)?.workspace;
        const sessions = listSessions(workspace);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ count: sessions.length, sessions }, null, 2),
            },
          ],
        };
      }

      case "dsh_cancel_task": {
        const { taskId } = (args || {}) as any;
        if (!taskId) {
          throw new Error("Missing required argument 'taskId'.");
        }
        const cancelled = cancelDshTask(taskId);
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

      case "dsh_review_task": {
        const { cwd, brief, diff, testCommand, model, endpoint } = (args || {}) as any;
        if (!cwd || !brief) {
          throw new Error("Missing required arguments 'cwd' and 'brief'.");
        }
        const result = await runDshReview({ cwd, brief, diff, testCommand, model, endpoint });
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

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("DeepSeek Harness MCP Server (dsh-agent-mcp) running on stdio\n");
}

run().catch((error) => {
  process.stderr.write(`Fatal error: ${error}\n`);
  process.exit(1);
});
