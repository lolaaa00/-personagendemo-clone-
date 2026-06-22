import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const geminiApiKey = process.env.GEMINI_API_KEY;
const pollIntervalMs = Number(process.env.HERMES_DAEMON_POLL_MS || 3000);
const claimTtlMs = Number(process.env.HERMES_DAEMON_CLAIM_TTL_MS || 300000);
const daemonId = process.env.HERMES_DAEMON_ID || `hermes-daemon-${process.pid}`;

if (!supabaseUrl) {
  console.error("[HermesDaemon] SUPABASE_URL or PUBLIC_SUPABASE_URL is required.");
  process.exit(1);
}

if (!supabaseKey) {
  console.error("[HermesDaemon] SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY is required.");
  process.exit(1);
}

if (!geminiApiKey) {
  console.error("[HermesDaemon] GEMINI_API_KEY is required.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const ai = new GoogleGenAI({ apiKey: geminiApiKey });

function isClaimExpired(claimedAt) {
  if (!claimedAt) return true;
  return Date.now() - new Date(claimedAt).getTime() > claimTtlMs;
}

async function findNextMessage() {
  const { data: overseers, error: overseerErr } = await supabase
    .from("agents")
    .select("id, user_id, name, handle, soul, skills, tools, heartbeat, market, runtime_owner")
    .eq("is_overseer", true)
    .eq("runtime_owner", "hermes-daemon");

  if (overseerErr) throw overseerErr;
  if (!overseers || overseers.length === 0) return null;

  const overseerById = new Map(overseers.map((agent) => [agent.id, agent]));
  const { data: messages, error: msgErr } = await supabase
    .from("chat_messages")
    .select("id, user_id, agent_id, session_id, role, content, created_at, claimed_by, claimed_at")
    .in("agent_id", [...overseerById.keys()])
    .order("created_at", { ascending: false })
    .limit(100);

  if (msgErr) throw msgErr;
  if (!messages || messages.length === 0) return null;

  const latestByThread = new Map();
  for (const message of messages) {
    const key = `${message.user_id}:${message.agent_id}:${message.session_id || "no-session"}`;
    if (!latestByThread.has(key)) latestByThread.set(key, message);
  }

  const next = [...latestByThread.values()]
    .filter((message) => message.role === "user")
    .filter((message) => !message.claimed_by || isClaimExpired(message.claimed_at))
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];

  if (!next) return null;
  return { message: next, agent: overseerById.get(next.agent_id) };
}

async function claimMessage(messageId) {
  const { data, error } = await supabase
    .from("chat_messages")
    .update({ claimed_by: daemonId, claimed_at: new Date().toISOString() })
    .eq("id", messageId)
    .or(`claimed_by.is.null,claimed_at.lt.${new Date(Date.now() - claimTtlMs).toISOString()}`)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return !!data;
}

async function loadHistory(sessionId, userId, agentId) {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("role, content, created_at")
    .eq("session_id", sessionId)
    .eq("user_id", userId)
    .eq("agent_id", agentId)
    .order("created_at", { ascending: true })
    .limit(30);

  if (error) throw error;
  return data || [];
}

async function loadManagedAgents(userId, hermesId) {
  const { data, error } = await supabase
    .from("agents")
    .select("id, name, handle, niche, status, runtime_owner")
    .eq("user_id", userId)
    .eq("supervisor_agent_id", hermesId);

  if (error) throw error;
  return data || [];
}

function toGeminiMessages(history) {
  return history.map((message) => ({
    role: message.role === "user" ? "user" : "model",
    parts: [{ text: message.content }]
  }));
}

async function generateResponse(agent, message) {
  const [history, managedAgents] = await Promise.all([
    loadHistory(message.session_id, message.user_id, message.agent_id),
    loadManagedAgents(message.user_id, message.agent_id)
  ]);

  const managedList = managedAgents.length
    ? managedAgents.map((a) => `- ${a.name} (${a.handle || "no handle"}) | ${a.niche || "unknown niche"} | ${a.status}`).join("\n")
    : "No managed creator agents found.";

  const systemInstruction = `You are Hermes, PersonaGen's daemon-owned Chief Operational Overseer.

You are not a normal in-app chatbot. You are a background runtime responsible for platform oversight, creator-agent orchestration, system health triage, and clear operational guidance.

Agent profile:
- Name: ${agent.name}
- Handle: ${agent.handle}
- Soul: ${agent.soul || "Operational, direct, and useful."}
- Skills: ${agent.skills || "System health monitoring, scheduling, alert dispatch, database reporting"}
- Tools: ${agent.tools || "system_log_reader, agent_orchestrator"}

Managed creator agents:
${managedList}

Respond as Hermes. Be concise, operational, and explicit about next actions. If the request requires real external work not available to this daemon yet, say exactly what subsystem or tool needs to be connected instead of pretending it ran.`;

  const response = await ai.models.generateContent({
    model: process.env.HERMES_DAEMON_MODEL || "gemini-3.5-flash",
    contents: toGeminiMessages(history),
    config: { systemInstruction }
  });

  return response.text || "Hermes daemon could not generate a response.";
}

async function postResponse(message, responseText) {
  const { error } = await supabase.from("chat_messages").insert({
    user_id: message.user_id,
    agent_id: message.agent_id,
    session_id: message.session_id,
    role: "model",
    content: responseText
  });

  if (error) throw error;
}

async function processOnce() {
  const next = await findNextMessage();
  if (!next) return false;

  const { message, agent } = next;
  const claimed = await claimMessage(message.id);
  if (!claimed) return false;

  console.log(`[HermesDaemon] Claimed message ${message.id} for session ${message.session_id}`);
  const responseText = await generateResponse(agent, message);
  await postResponse(message, responseText);
  console.log(`[HermesDaemon] Posted response for session ${message.session_id}`);
  return true;
}

async function loop() {
  console.log(`[HermesDaemon] Started as ${daemonId}; polling every ${pollIntervalMs}ms.`);
  while (true) {
    try {
      const processed = await processOnce();
      if (!processed) await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    } catch (error) {
      console.error("[HermesDaemon] Processing error:", error);
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }
}

loop();
