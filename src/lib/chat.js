// src/lib/chat.js
import supabase from "../supabaseClient";

/**
 * Find an existing 1:1 conversation or create one (and insert both participants).
 * Returns the conversation id.
 */
export async function findOrCreateDirectConversation(meId, otherId) {
  if (!meId || !otherId || meId === otherId) throw new Error("Invalid participants");

  // STEP 1: try to find an existing convo that both users participate in
  // get my conversation ids
  const { data: myPart, error: e1 } = await supabase
    .from("conversation_participants")
    .select("conversation_id")
    .eq("user_id", meId);
  if (e1) throw e1;

  const convIds = (myPart || []).map(r => r.conversation_id);
  if (convIds.length) {
    const { data: both, error: e2 } = await supabase
      .from("conversation_participants")
      .select("conversation_id")
      .in("conversation_id", convIds)
      .eq("user_id", otherId);
    if (e2) throw e2;
    if (both && both.length) {
      return both[0].conversation_id; // found existing
    }
  }

  // STEP 2: create a new conversation (creator = meId)
  const { data: conv, error: e3 } = await supabase
    .from("conversations")
    .insert({ created_by: meId, is_group: false })
    .select("id")
    .single();
  if (e3) throw e3;
  const convId = conv.id;

  // STEP 3: insert both participants
  // RLS policy allows creator to insert participants for this conversation
  const { error: e4 } = await supabase.from("conversation_participants").insert([
    { conversation_id: convId, user_id: meId, role: "admin" },
    { conversation_id: convId, user_id: otherId, role: "member" },
  ]);
  if (e4) throw e4;

  return convId;
}
