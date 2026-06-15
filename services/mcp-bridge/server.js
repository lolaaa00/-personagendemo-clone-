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
        .select("id, user_id, agent_id, platform, handle, verified, status, last_sync, last_error, last_checked_at")
        .or("verified.eq.false,status.in.(stale,reauth_required,revoked,error)");

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
  "Fetches latest agent chat threads where the final turn is a user message requiring response from Hermes",
  {},
  async () => {
    try {
      const [messagesRes, overseersRes] = await Promise.all([
        supabase
          .from("chat_messages")
          .select("id, user_id, agent_id, role, content, created_at, claimed_by, claimed_at")
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("agents")
          .select("id")
          .eq("is_overseer", true)
      ]);

      if (messagesRes.error) {
        return {
          content: [{ type: "text", text: `Error loading messages: ${messagesRes.error.message}` }],
          isError: true
        };
      }

      const data = messagesRes.data || [];
      const overseerIds = new Set((overseersRes.data || []).map(o => o.id));

      if (data.length === 0) {
        return {
          content: [{ type: "text", text: "No chat messages found in the database." }]
        };
      }

      // Deduplicate to get the latest message for each agent chat thread.
      const latestMessages = {};
      for (const msg of data) {
        if (!latestMessages[msg.agent_id]) {
          latestMessages[msg.agent_id] = msg;
        }
      }

      // Filter where the latest message in the thread is from the user
      // AND it is not claimed, or the claim has expired (e.g. 30 seconds ago)
      const now = new Date();
      const unresolved = Object.values(latestMessages).filter((msg) => {
        if (msg.role !== "user") return false;
        if (!msg.claimed_by) return true;
        const claimedTime = new Date(msg.claimed_at);
        return now.getTime() - claimedTime.getTime() > 30000; // 30 seconds expiration
      });

      if (unresolved.length === 0) {
        return {
          content: [{ type: "text", text: "All conversations have been answered. No unresolved user messages waiting." }]
        };
      }

      // Sort: messages directed to Hermes overseers first
      unresolved.sort((a, b) => {
        const aIsOverseer = overseerIds.has(a.agent_id) ? 1 : 0;
        const bIsOverseer = overseerIds.has(b.agent_id) ? 1 : 0;
        return bIsOverseer - aIsOverseer;
      });

      return {
        content: [{ type: "text", text: `Unresolved conversations requiring response (overseers prioritized):\n${JSON.stringify(unresolved, null, 2)}` }]
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
// Tool 2b: Claim User Message
// ============================================================================
server.tool(
  "claim_user_message",
  "Claims a specific user message to prevent duplicate processing by other runtimes",
  {
    messageId: z.string().describe("The ID of the message to claim"),
    claimedBy: z.string().describe("Identifier of the claimant, e.g. hermes-daemon")
  },
  async ({ messageId, claimedBy }) => {
    try {
      const { data, error } = await supabase
        .from("chat_messages")
        .update({
          claimed_by: claimedBy,
          claimed_at: new Date().toISOString()
        })
        .eq("id", messageId)
        .select();

      if (error) {
        return {
          content: [{ type: "text", text: `Failed to claim message: ${error.message}` }],
          isError: true
        };
      }

      return {
        content: [{ type: "text", text: `Successfully claimed message ${messageId} for ${claimedBy}` }]
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Unexpected error: ${e.message}` }],
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
    "Appends your finalized official response back into the current chat_messages schema to display on the user's dashboard",
    {
      userId: z.string().describe("The Supabase user_id that owns the chat thread"),
      agentId: z.string().describe("The agent_id chat thread to reply to"),
      responseText: z.string().describe("Your helpful, web-grounded assistant reply to write back to the user")
    },
    async ({ userId, agentId, responseText }) => {
      try {
        const { data, error } = await supabase
          .from("chat_messages")
          .insert({
            user_id: userId,
            agent_id: agentId,
            role: "model",
            content: responseText
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
      priority: z.enum(["low", "medium", "high", "urgent"]).describe("Impact priority of the maintenance task"),
      userId: z.string().describe("The Supabase user_id that owns the ticket"),
      assigneeAgentId: z.string().optional().describe("Optional UUID of the agent to assign this ticket to")
    },
    async ({ title, description, priority, userId, assigneeAgentId }) => {
      try {
        if (assigneeAgentId) {
          // Validate assignee belongs to the same userId
          const { data: agent, error: agentErr } = await supabase
            .from("agents")
            .select("user_id")
            .eq("id", assigneeAgentId)
            .maybeSingle();

          if (agentErr) {
            return {
              content: [{ type: "text", text: `Error validating assignee agent: ${agentErr.message}` }],
              isError: true
            };
          }

          if (!agent) {
            return {
              content: [{ type: "text", text: `Assignee agent with ID ${assigneeAgentId} not found.` }],
              isError: true
            };
          }

          if (agent.user_id !== userId) {
            return {
              content: [{ type: "text", text: `Security violation: Assignee agent does not belong to user ${userId}.` }],
              isError: true
            };
          }
        }

        const { data, error } = await supabase
          .from("tickets")
          .insert({
            user_id: userId,
            title,
            description,
            status: "backlog", // Surfaces instantly on Kanban board backlog
            priority,
            assignee_agent_id: assigneeAgentId || null
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
// Tool 5: Get Managed Agents
// ============================================================================
server.tool(
  "get_managed_agents",
  "Fetches all creator agents managed by a specific supervisor agent (overseer)",
  {
    supervisorAgentId: z.string().describe("The UUID of the supervisor agent (overseer)")
  },
  async ({ supervisorAgentId }) => {
    try {
      const { data, error } = await supabase
        .from("agents")
        .select("id, name, handle, niche, status, managed_by_overseer, runtime_owner")
        .eq("supervisor_agent_id", supervisorAgentId);

      if (error) {
        return {
          content: [{ type: "text", text: `Error fetching managed agents: ${error.message}` }],
          isError: true
        };
      }

      return {
        content: [{ type: "text", text: `Managed agents list:\n${JSON.stringify(data, null, 2)}` }]
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Unexpected error: ${e.message}` }],
        isError: true
      };
    }
  }
);

// ============================================================================
// Tool 6: Get Agent Health Summary
// ============================================================================
server.tool(
  "get_agent_health_summary",
  "Compiles an ecosystem-wide health summary including broken connections, open maintenance tickets, and unconfigured agents for a user",
  {
    userId: z.string().describe("The user_id to run the health audit for")
  },
  async ({ userId }) => {
    try {
      // Fetch agents, tickets, and configurations in parallel
      const [agentsRes, ticketsRes, connectionsRes, configsRes] = await Promise.all([
        supabase.from("agents").select("id, name, handle, is_overseer, supervisor_agent_id, managed_by_overseer").eq("user_id", userId),
        supabase.from("tickets").select("id, status").eq("user_id", userId).neq("status", "done"),
        supabase.from("connections").select("platform, verified, status").eq("user_id", userId),
        supabase.from("agent_configs").select("agent_id").eq("user_id", userId)
      ]);

      if (agentsRes.error || ticketsRes.error || connectionsRes.error || configsRes.error) {
        return {
          content: [{ type: "text", text: `Failed to compile health summary: ${agentsRes.error?.message || ticketsRes.error?.message || connectionsRes.error?.message || configsRes.error?.message}` }],
          isError: true
        };
      }

      const agents = agentsRes.data || [];
      const openTickets = ticketsRes.data || [];
      const connections = connectionsRes.data || [];
      const configs = configsRes.data || [];

      const configAgentIds = new Set(configs.map(c => c.agent_id));
      const brokenConns = connections.filter(c => !c.verified || ["stale", "reauth_required", "revoked", "error"].includes(c.status));
      const unconfiguredCreators = agents.filter(a => !a.is_overseer && !configAgentIds.has(a.id));
      const unlinkedCreators = agents.filter(a => !a.is_overseer && (!a.supervisor_agent_id || !a.managed_by_overseer));

      const summary = {
        totalAgents: agents.length,
        creatorsCount: agents.filter(a => !a.is_overseer).length,
        hasHermesOverseer: agents.some(a => a.is_overseer),
        managedByHermesCount: agents.filter(a => a.supervisor_agent_id && a.managed_by_overseer).length,
        unlinkedCreatorsCount: unlinkedCreators.length,
        openTicketsCount: openTickets.length,
        brokenConnectionsCount: brokenConns.length,
        unconfiguredCreatorsCount: unconfiguredCreators.length,
        brokenConnections: brokenConns,
        unconfiguredCreators: unconfiguredCreators.map(a => ({ id: a.id, name: a.name, handle: a.handle })),
        unlinkedCreators: unlinkedCreators.map(a => ({ id: a.id, name: a.name, handle: a.handle }))
      };

      return {
        content: [{ type: "text", text: `Ecosystem Health Summary:\n${JSON.stringify(summary, null, 2)}` }]
      };
    } catch (e) {
      return {
        content: [{ type: "text", text: `Unexpected system error during health audit: ${e.message}` }],
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
