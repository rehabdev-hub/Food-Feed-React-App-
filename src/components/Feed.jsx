// File: components/Feed.jsx
import { useCallback, useEffect, useRef, useState } from "react";
import supabase from "../supabaseClient";
import PostCard from "./PostCard";

const PAGE_SIZE = 6;

// ✅ Explicit FK to resolve PGRST201 (change to your actual FK name if different)
const baseSelect =
  `*, author:profiles!posts_user_id_fkey ( id, full_name, avatar_url )`;

export default function Feed() {
  const [posts, setPosts] = useState([]);
  const [cursor, setCursor] = useState(null); // { created_at: string, id: string }
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  const mountedRef = useRef(true);
  const subRef = useRef(null);
  const sentinelRef = useRef(null);
  const ioRef = useRef(null);
  const seenIdsRef = useRef(new Set()); // ✅ de-dup across pages + realtime

  // ---- Helpers ----
  const attachAndDedupe = useCallback((incoming, mode = "append") => {
    if (!incoming?.length) return;

    // filter duplicates
    const fresh = incoming.filter((p) => {
      if (seenIdsRef.current.has(p.id)) return false;
      seenIdsRef.current.add(p.id);
      return true;
    });

    if (!fresh.length) return;

    setPosts((prev) => (mode === "prepend" ? [...fresh, ...prev] : [...prev, ...fresh]));

    // update cursor to the LAST item (chronologically older due to desc order)
    const last = fresh[fresh.length - 1];
    setCursor({
      created_at: last.created_at,
      id: last.id,
    });
  }, []);

  const fetchFirstPage = useCallback(async () => {
    // top page (newest first)
    return await supabase
      .from("posts")
      .select(baseSelect)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE_SIZE);
  }, []);

  const fetchNextPage = useCallback(async (cur) => {
    // Keyset: (created_at < cursor.created_at) OR (created_at = cursor.created_at AND id < cursor.id)
    const createdISO = new Date(cur.created_at).toISOString();
    const orExpr = `and(created_at.lt.${createdISO}),and(created_at.eq.${createdISO},id.lt.${cur.id})`;

    return await supabase
      .from("posts")
      .select(baseSelect)
      .or(orExpr)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE_SIZE);
  }, []);

  const fetchOneWithJoin = useCallback(async (id) => {
    const { data, error } = await supabase
      .from("posts")
      .select(baseSelect)
      .eq("id", id)
      .single();
    if (error) throw error;
    return data;
  }, []);

  // ---- Initial load ----
  const loadInitial = useCallback(async () => {
    setErrMsg("");
    setLoading(true);
    try {
      // reset
      seenIdsRef.current.clear();
      setPosts([]);
      setCursor(null);

      const { data, error } = await fetchFirstPage();
      if (error) throw error;

      if (!mountedRef.current) return;
      attachAndDedupe(data || [], "append");
      setHasMore((data?.length || 0) === PAGE_SIZE);
    } catch (e) {
      console.error(e);
      if (mountedRef.current) {
        const isJoinAmbiguity =
          e?.code === "PGRST201" ||
          /Could not embed because more than one relationship/.test(e?.message || "");
        setErrMsg(
          isJoinAmbiguity
            ? "Feed join error: posts ↔ profiles کا درست FK نام baseSelect میں لگائیں."
            : "Failed to load feed."
        );
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [fetchFirstPage, attachAndDedupe]);

  // ---- Load more via keyset ----
  const loadMore = useCallback(async () => {
    if (!hasMore || loading) return;
    if (!cursor) return; // nothing to paginate from yet
    setLoading(true);
    try {
      const { data, error } = await fetchNextPage(cursor);
      if (error) throw error;

      if (!mountedRef.current) return;
      attachAndDedupe(data || [], "append");
      setHasMore((data?.length || 0) === PAGE_SIZE);
    } catch (e) {
      console.error(e);
      // allow retry next intersection
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [cursor, hasMore, loading, fetchNextPage, attachAndDedupe]);

  // ---- Realtime channels ----
  useEffect(() => {
    mountedRef.current = true;
    loadInitial();

    const chInserts = supabase
      .channel("posts-inserts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "posts" },
        async (payload) => {
          if (!mountedRef.current) return;
          // If already seen, ignore
          if (seenIdsRef.current.has(payload.new.id)) return;

          try {
            const full = await fetchOneWithJoin(payload.new.id);
            attachAndDedupe([full], "prepend"); // new content appears on top
          } catch (e) {
            console.error("Failed to fetch inserted post with join:", e);
            // minimal fallback (still deduped via seenIds)
            attachAndDedupe([payload.new], "prepend");
          }
        }
      )
      .subscribe();

    const chUpdates = supabase
      .channel("posts-updates")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "posts" },
        (payload) => {
          if (!mountedRef.current) return;
          const updated = payload.new;
          setPosts((prev) =>
            prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p))
          );
          // no change to seenIds/cursor needed
        }
      )
      .subscribe();

    subRef.current = [chInserts, chUpdates];

    return () => {
      mountedRef.current = false;
      if (subRef.current) {
        subRef.current.forEach((c) => c && supabase.removeChannel(c));
      }
    };
  }, [loadInitial, fetchOneWithJoin, attachAndDedupe]);

  // ---- External deletion event ----
  useEffect(() => {
    const onDeleted = (e) => {
      const id = e.detail;
      setPosts((prev) => prev.filter((p) => p.id !== id));
      seenIdsRef.current.delete(id);
    };
    window.addEventListener("ff:post-deleted", onDeleted);
    return () => window.removeEventListener("ff:post-deleted", onDeleted);
  }, []);

  // ---- IntersectionObserver for infinite scroll ----
  useEffect(() => {
    if (!sentinelRef.current) return;

    if (ioRef.current) {
      ioRef.current.disconnect();
      ioRef.current = null;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) loadMore();
      },
      {
        root: null,
        rootMargin: "400px 0px", // prefetch before end
        threshold: 0.01,
      }
    );

    observer.observe(sentinelRef.current);
    ioRef.current = observer;

    return () => {
      observer.disconnect();
      ioRef.current = null;
    };
  }, [loadMore]);

  return (
    <div className="feed-stack">
      {errMsg && <p className="info" style={{ color: "#b00" }}>{errMsg}</p>}

      {posts.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}

      {loading && (
        <p className="loading" style={{ opacity: 0.7, padding: "8px 0" }}>
          Loading more…
        </p>
      )}

      {/* sentinel for infinite scroll */}
      {hasMore ? (
        <div ref={sentinelRef} aria-hidden="true" style={{ height: 1, width: "100%" }} />
      ) : posts.length > 0 ? (
        <p className="caught-up">You’re all caught up 👌</p>
      ) : null}
    </div>
  );
}
