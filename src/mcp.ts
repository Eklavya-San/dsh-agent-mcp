#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { runDshTask } from "./runner.js";
import { runDshDoctor } from "./doctor.js";
import { getWebStatus, startWebUi, stopWebUi } from "./web.js";
import { listSessions } from "./sessions.js";

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
          description: "Absolute path to the repository/directory the worker should operate in.",
        },
        task: {
          type: "string",
          description: "Clear, explicit instructions for the task: files to edit/create, requirements, constraints, and test commands.",
        },
        timeoutMs: {
          type: "number",
          description: "Max execution time in milliseconds (default: 1800000 = 30 minutes).",
        },
        verbose: {
          type: "boolean",
          description: "Whether to include full raw stdout/stderr in the response (default: false).",
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
        const { cwd, task, timeoutMs, verbose } = (args || {}) as any;
        if (!cwd || !task) {
          throw new Error("Missing required arguments 'cwd' and 'task'.");
        }
        const result = await runDshTask({ cwd, task, timeoutMs, verbose });
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
