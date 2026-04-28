import { AgentLoop } from "../src/agent/loop";
import { SqliteMemory } from "../src/memory/sqlite";
import { SupabaseVectorMemory } from "../src/memory/supabase-vector";
import { Message } from "../src/types";

async function test() {
  console.log("🧪 Starting Memory Fallback Test...");

  const sqlite = new SqliteMemory();
  const supabase = new SupabaseVectorMemory();

  // Initialize both
  await sqlite.initialize();
  await supabase.initialize();

  const providers = [sqlite, supabase];
  const loop = new AgentLoop({} as any, [], providers);

  const mockChatId = "test_chat_123";
  const mockMessage: Message = {
    id: "msg_1",
    role: "user",
    content: "Test message",
    timestamp: new Date(),
    channel: "telegram",
    chatId: mockChatId,
    userId: "user_1"
  };

  // 1. Verify SQLite is empty
  const sqliteMsgs = await sqlite.getRecentMessages(mockChatId);
  console.log(`- SQLite messages for ${mockChatId}: ${sqliteMsgs.length}`);

  // 2. Mock some history in Supabase (manually if needed, but let's just see what's there)
  const supabaseMsgs = await supabase.getRecentMessages(mockChatId);
  console.log(`- Supabase messages for ${mockChatId}: ${supabaseMsgs.length}`);

  // 3. Run buildContext (using private method access for test)
  console.log("- Running AgentLoop.buildContext...");
  const context = await (loop as any).buildContext(mockMessage);

  const historyMsgs = context.filter((m: any) => m.role === "user" || m.role === "assistant");
  console.log(`- Context contains ${historyMsgs.length} history messages`);

  if (historyMsgs.length === 0 && supabaseMsgs.length > 0) {
    console.log("❌ BUG CONFIRMED: History exists in Supabase but not pulled into context!");
  } else {
    console.log("✅ History pulled correctly (or no history exists in Supabase either).");
  }

  await sqlite.close();
  await supabase.close();
}

test().catch(console.error);
