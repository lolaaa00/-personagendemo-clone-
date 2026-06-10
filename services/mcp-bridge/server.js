import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createClient } from "@supabase/supabase-js";
import express from "express";
import { z } from "zod";

// Initialize Supabase Client (bypasses RLS utilizing Service Role Key for background automation)
const supabaseUrl = process.env.SUPABASE_URL || "https://l2g-supabase.zi1cc5.easypanel.host";
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseKey) {
  console.error("FATAL ERROR: SUPABASE_SERVICE_KEY environment variable is not set!");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Initialize high-level MCP Server
const server = new McpServer({
  name: "personagen-supabase-bridge",
  version: "1.0.0"
});

// ============================================================================
// Tool 1: Scan Broken Connections
// ============================================================================
server.tool(
  "scan_broken_connections",
  "Scans the connections table in the database for any creator channels/accounts that are unverified, disconnected, or have failed status",
  {},
  async () => {
    try {
      const { data, error } = await supabase
        .from("connections")
        .select("id, platform, username, verified, last_sync")
        .eq("verified", false);

      if (error) {
        return {
          content: [{ type: "text", text: `Error scanning database: ${error.message}` }],
          isError: true
        };
      }

      if (!data || data.length === 0) {
        return {
          content: [{ type: "text", text: "Excellent! All creator social media connections are fully verified, authenticated, and active. No broken connections detected." }]
        };
      }

      return {
        content: [{ type: "text", text: `Detected unverified/broken creator connections:\n${JSON.stringify(data, null, 2)}` }]
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Unexpected system error: ${e.message}` }],
        isError: true
      };
    }
  }
);

// ============================================================================
// Tool 2: Get Unresolved User Messages
// ============================================================================
server.tool(
  "get_unresolved_user_messages",
  "Fetches the latest conversations where the final turn is a USER message requiring response from Hermes",
  {},
  async () => {
    try {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("id, conversation_id, role, message, created_at, sender_id")
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        return {
          content: [{ type: "text", text: `Error loading messages: ${error.message}` }],
          isError: true
        };
      }

      if (!data || data.length === 0) {
        return {
          content: [{ type: "text", text: "No chat messages found in the database." }]
        };
      }

      // Deduplicate to get the latest message in each conversation
      const latestMessages = {};
      for (const msg of data) {
        if (!latestMessages[msg.conversation_id]) {
          latestMessages[msg.conversation_id] = msg;
        }
      }

      // Filter where the latest message in the thread is from the user
      const unresolved = Object.values(latestMessages).filter(
        (msg) => msg.role === "user"
      );

      if (unresolved.length === 0) {
        return {
          content: [{ type: "text", text: "All conversations have been answered. No unresolved user messages waiting." }]
        };
      }

      return {
        content: [{ type: "text", text: `Unresolved conversations requiring response:\n${JSON.stringify(unresolved, null, 2)}` }]
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Unexpected system error: ${e.message}` }],
        isError: true
      };
    }
  }
);

// ============================================================================
// Tool 3: Post Chat Response
// ============================================================================
server.tool(
  "post_chat_response",
  "Appends your finalized official response back into the chat_messages table to display on the user's dashboard",
  {
    conversationId: z.string().describe("The unique ID of the conversation thread to reply to"),
    responseText: z.string().describe("Your helpful, web-grounded assistant reply to write back to the user")
  },
  async ({ conversationId, responseText }) => {
    try {
      const { data, error } = await supabase
        .from("chat_messages")
        .insert({
          conversation_id: conversationId,
          role: "model",
          message: responseText,
          sender_id: "hermes-overseer"
        })
        .select();

      if (error) {
        return {
          content: [{ type: "text", text: `Failed to insert message: ${error.message}` }],
          isError: true
        };
      }

      return {
        content: [{ type: "text", text: `Success! Posted model response. ID: ${data[0]?.id}` }]
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Unexpected system error: ${e.message}` }],
        isError: true
      };
    }
  }
);

// ============================================================================
// Tool 4: Create Maintenance Ticket
// ============================================================================
server.tool(
  "create_maintenance_ticket",
  "Injects a structured repair or maintenance ticket directly into the platform Kanban board (tickets table)",
  {
    title: z.string().describe("Short descriptive title of the action needed (e.g. Re-auth TikTok @skincaretips)"),
    description: z.string().describe("In-depth description of the error code, web search guidelines, and instructions"),
    priority: z.enum(["low", "medium", "high", "critical"]).describe("Impact priority of the maintenance task")
  },
  async ({ title, description, priority }) => {
    try {
      const { data, error } = await supabase
        .from("tickets")
        .insert({
          title,
          description,
          status: "backlog", // Surfaces instantly on Kanban board backlog
          priority,
          source: "hermes-overseer"
        })
        .select();

      if (error) {
        return {
          content: [{ type: "text", text: `Failed to create ticket: ${error.message}` }],
          isError: true
        };
      }

      return {
        content: [{ type: "text", text: `Ticket created successfully. ID: ${data[0]?.id}` }]
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Unexpected system error: ${e.message}` }],
        isError: true
      };
    }
  }
);


// ============================================================================
// Express SSE Server Transport Mapping
// ============================================================================
const app = express();
app.use(express.json());

// Track active client SSE transports
const transports = new Map();

// 1. SSE Connection stream
app.get("/sse", async (req, res) => {
  console.log(`[MCP] New client connecting via SSE...`);
  const transport = new SSEServerTransport("/messages", res);
  
  transports.set(transport.sessionId, transport);

  res.on("close", () => {
    console.log(`[MCP] Client disconnected, cleaning up session: ${transport.sessionId}`);
    transports.delete(transport.sessionId);
  });

  await server.connect(transport);
});

// 2. Incoming Post Messages gateway
app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports.get(sessionId);

  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send(`Session '${sessionId}' not found.`);
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`🚀 Supabase MCP Bridge Server running on port ${PORT}`);
  console.log(`👉 SSE connection endpoint: http://localhost:${PORT}/sse`);
  console.log(`👉 Message delivery endpoint: http://localhost:${PORT}/messages`);
});
