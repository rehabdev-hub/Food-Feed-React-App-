import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import supabase from "../../supabaseClient";
import MessageBubble from "./MessageBubble";
import MessageInput from "./MessageInput";

const PAGE = 30;
const NEAR_BOTTOM_PX = 120;

export default function ChatWindow({ me, conversationId, onAnyRead }) {
  const [rows, setRows] = useState([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const listRef = useRef(null);
  const topSentinelRef = useRef(null);
  const bottomRef = useRef(null);

  const isNearBottom = useCallback(() => {
    const el = listRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = bottomRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
  }, []);

  const appendSorted = useCallback((msgs) => {
    return [...msgs].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  }, []);

  const dedupePush = useCallback((msg) => {
    setRows((prev) => {
      if (msg.id && prev.some((m) => m.id === msg.id)) return prev;
      const next = [...prev, msg];
      return appendSorted(next);
    });
  }, [appendSorted]);

  const loadPage = useCallback(
    async (olderThanId) => {
      if (!conversationId) return;
      setLoading(true);
      let q = supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("id", { ascending: false })
        .limit(PAGE);
      if (olderThanId) q = q.lt("id", olderThanId);
      const { data, error } = await q;
      if (error) {
        console.warn(error.message);
        setLoading(false);
        return;
      }
      const page = (data || []).reverse();
      setRows((prev) => (olderThanId ? appendSorted([...page, ...prev]) : page));
      setHasMore((data || []).length === PAGE);
      setLoading(false);
      if (!olderThanId) setTimeout(() => scrollToBottom(false), 0);
    },
    [conversationId, appendSorted, scrollToBottom]
  );

  useEffect(() => {
    setRows([]);
    setHasMore(true);
    if (conversationId) loadPage();
  }, [conversationId, loadPage]);

  useEffect(() => {
    const el = topSentinelRef.current;
    if (!el || !hasMore || loading) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && rows.length) {
            loadPage(rows[0]?.id);
          }
        });
      },
      { root: listRef.current, threshold: 0.1 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [rows, hasMore, loading, loadPage]);

  // -------- Realtime INSERT + DELETE ----------
  useEffect(() => {
    if (!conversationId) return;
    const ch = supabase
      .channel(`chat-${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const atBottom = isNearBottom();
          dedupePush(payload.new);
          if (atBottom) scrollToBottom(true);
        }
      )
      .on(
        "postgres_changes",
        // NOTE: For DELETE payload.old to be populated, set `REPLICA IDENTITY FULL` on messages table.
        { event: "DELETE", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const deletedId = payload.old?.id;
          if (!deletedId) return; // fallback: refetch
          setRows((prev) => prev.filter((m) => m.id !== deletedId));
        }
      )
      .subscribe();

    return () => supabase.removeChannel(ch);
  }, [conversationId, dedupePush, isNearBottom, scrollToBottom]);

  // optimistic events (if MessageInput fires them) — keep as you already had
  useEffect(() => {
    const onOptimistic = (e) => {
      const m = e.detail?.message;
      if (!m || m.conversation_id !== conversationId) return;
      const atBottom = isNearBottom();
      dedupePush(m);
      if (atBottom) scrollToBottom(true);
    };
    const onConfirm = (e) => {
      const { tempId, message } = e.detail || {};
      if (!message || message.conversation_id !== conversationId) return;
      setRows((prev) => {
        const next = prev.map((x) => (x.id === tempId ? message : x));
        return appendSorted(next);
      });
      if (isNearBottom()) scrollToBottom(true);
    };
    const onRollback = (e) => {
      const { tempId } = e.detail || {};
      if (!tempId) return;
      setRows((prev) => prev.filter((m) => m.id !== tempId));
    };

    window.addEventListener("msg:optimistic", onOptimistic);
    window.addEventListener("msg:confirm", onConfirm);
    window.addEventListener("msg:rollback", onRollback);
    return () => {
      window.removeEventListener("msg:optimistic", onOptimistic);
      window.removeEventListener("msg:confirm", onConfirm);
      window.removeEventListener("msg:rollback", onRollback);
    };
  }, [conversationId, dedupePush, appendSorted, isNearBottom, scrollToBottom]);

  // read marker
  const lastId = useMemo(() => rows[rows.length - 1]?.id, [rows]);
  useEffect(() => {
    if (!me?.id || !conversationId || !lastId) return;
    (async () => {
      try {
        await supabase
          .from("message_reads")
          .upsert({ conversation_id: conversationId, user_id: me.id, last_read_message_id: lastId });
        onAnyRead?.();
      } catch (e) {
        console.warn("read upsert failed", e?.message);
      }
    })();
  }, [me?.id, conversationId, lastId, onAnyRead]);

  // ------ NEW: bubble delete callback ------
  const handleBubbleDelete = useCallback((msg) => {
    // optimistic remove + return rollback function
    let restored = false;
    setRows((prev) => {
      const next = prev.filter((m) => m.id !== msg.id);
      return next;
    });
    return () => {
      if (restored) return;
      restored = true;
      setRows((prev) => appendSorted([...prev, msg]));
    };
  }, [appendSorted]);

  return (
    <section className="chat">
      {!conversationId ? (
        <div className="empty">Select a conversation to start chatting.</div>
      ) : (
        <>
          <div className="messages" ref={listRef}>
            <div ref={topSentinelRef} />
            {rows.map((m) => (
              <MessageBubble key={m.id} me={me} msg={m} onDelete={handleBubbleDelete} />
            ))}
            {loading && <div className="loading">Loading…</div>}
            <div ref={bottomRef} />
          </div>

          <MessageInput
            me={me}
            conversationId={conversationId}
            onSent={(m) => {
              const atBottom = isNearBottom();
              dedupePush(m);
              if (atBottom) scrollToBottom(true);
            }}
          />
        </>
      )}

      <style>{`
        .chat{display:flex;flex-direction:column;height:750px}
        .messages{flex:1;overflow:auto;padding:12px 16px;background:#fafafa}
        .empty{padding:20px;color:#6b7280}
        .loading{padding:10px;text-align:center;color:#6b7280}
      `}</style>
    </section>
  );
}
