// src/components/Messaging/MessagingPage.jsx
import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import supabase from "../../supabaseClient";
import ConversationList from "./ConversationList";
import ChatWindow from "./ChatWindow";

const AVATAR_BUCKET = "avatars";

function toPublicUrl(bucket, value) {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  const { data } = supabase.storage.from(bucket).getPublicUrl(value);
  return data?.publicUrl || "";
}

export default function MessagingPage() {
  const [me, setMe] = useState(null);
  const [convos, setConvos] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loading, setLoading] = useState(true);

  const location = useLocation();
  const navigate = useNavigate();
  const qs = new URLSearchParams(location.search);
  const cFromUrl = qs.get("c") || null; // conversation id
  const uFromUrl = qs.get("u") || null; // other user id

  // -------- Auth --------
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user ?? null));
  }, []);

  // -------- Row normalizer --------
  const normalizeRow = useCallback((r) => {
    return {
      id: r.conversation_id,
      is_group: r.is_group,
      title: r.title || "",
      created_at: r.created_at,
      created_by: r.created_by,
      other_id: r.other_id || null,
      other_user: r.other_id
        ? {
            id: r.other_id,
            full_name: r.other_full_name || "User",
            avatar_url:
              toPublicUrl(AVATAR_BUCKET, r.other_avatar_url) ||
              "https://i.pravatar.cc/64?u=fallback",
          }
        : null,
      last: r.last_id
        ? { id: r.last_id, body: r.last_body || "", created_at: r.last_created_at }
        : null,
      last_id: r.last_id ?? null,
    };
  }, []);

  const cmpNewestFirst = (a, b) => {
    const aScore = a.last?.id ?? 0;
    const bScore = b.last?.id ?? 0;
    if (aScore !== bScore) return bScore - aScore;
    return new Date(b.created_at) - new Date(a.created_at);
  };

  // -------- Load + Dedupe --------
  const loadConversations = useCallback(async () => {
    if (!me?.id) return;
    setLoading(true);

    const { data, error } = await supabase
      .from("user_conversations")
      .select("*")
      .order("last_id", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (error) {
      console.warn(error.message);
      setConvos([]);
      setLoading(false);
      return;
    }

    const normalized = (data || []).map(normalizeRow);

    // Dedupe:
    //  - DMs: unique by other_id (keep newest)
    //  - Groups: unique by conversation id
    const bucket = new Map();
    for (const c of normalized) {
      const dmKey = c.other_id != null ? c.other_id : c.id; // explicit to avoid ?? with template logic
      const key = c.is_group ? `g:${c.id}` : `u:${dmKey}`;

      const old = bucket.get(key);
      if (!old) {
        bucket.set(key, c);
      } else {
        // Compare using local vars to avoid mixing ?? with logical ops
        const cLast = c.last?.id ?? 0;
        const oLast = old.last?.id ?? 0;
        const isNewer =
          cLast > oLast || (cLast === oLast && new Date(c.created_at) > new Date(old.created_at));
        if (isNewer) bucket.set(key, c);
      }
    }

    const list = Array.from(bucket.values()).sort(cmpNewestFirst);
    setConvos(list);

    // Maintain/choose selection
    if (cFromUrl && list.some((x) => x.id === cFromUrl)) {
      setActiveId(cFromUrl);
    } else if (uFromUrl) {
      const target = list.find((x) => !x.is_group && x.other_id === uFromUrl);
      setActiveId(target ? target.id : list[0]?.id ?? null);
    } else if (!activeId && list.length) {
      setActiveId(list[0].id);
    }

    setLoading(false);
  }, [me?.id, normalizeRow, cFromUrl, uFromUrl, activeId]);

  useEffect(() => {
    if (me?.id) loadConversations();
  }, [me?.id, loadConversations]);

  // -------- Realtime --------
  useEffect(() => {
    if (!me?.id) return;

    const ch = supabase
      .channel(`msg-sidebar-${me.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        () => loadConversations()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        () => loadConversations()
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversation_participants" },
        () => loadConversations()
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "conversation_participants" },
        () => loadConversations()
      )
      .subscribe();

    return () => supabase.removeChannel(ch);
  }, [me?.id, loadConversations]);

  // -------- Delete chat --------
  const handleDeleteChat = useCallback(
    async (conversationId) => {
      if (!conversationId || !me?.id) return;
      try {
        const { data: conv, error: convErr } = await supabase
          .from("conversations")
          .select("id, created_by")
          .eq("id", conversationId)
          .maybeSingle();
        if (convErr) throw convErr;

        if (conv?.created_by === me.id) {
          const { error } = await supabase
            .from("conversations")
            .delete()
            .eq("id", conversationId);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from("conversation_participants")
            .delete()
            .eq("conversation_id", conversationId)
            .eq("user_id", me.id);
          if (error) throw error;
        }

        setConvos((prev) => prev.filter((c) => c.id !== conversationId));
        if (activeId === conversationId) {
          setActiveId((prev) => {
            const remaining = convos.filter((c) => c.id !== prev);
            return remaining[0]?.id ?? null;
          });
        }
      } catch (e) {
        console.error(e);
        alert(e.message || "Unable to delete chat");
      }
    },
    [me?.id, activeId, convos]
  );

  return (
    <div className="messaging-layout">
      <ConversationList
        me={me}
        conversations={convos}
        loading={loading}
        activeId={activeId}
        onSelect={setActiveId}
        onDeleteChat={handleDeleteChat}
      />
      <ChatWindow me={me} conversationId={activeId} onAnyRead={loadConversations} />

      <style>{`
        .messaging-layout{
          display: grid;
          grid-template-columns: 320px 1fr;
          height: 78vh;
          background:#fff; border-radius:12px;
          overflow: hidden; box-shadow: 0 8px 30px rgba(0,0,0,.06);
        }
        @media (max-width: 900px){
          .messaging-layout{ grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
