// components/StoriesBar.jsx
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import supabase from "../supabaseClient";
import { v4 as uuid } from "uuid";

const AVATAR_BUCKET = "avatars";
const STORY_BUCKET  = "stories";


const MAX_VISIBLE  = 5;
const CARD_W       = 115;
const GAP          = 10;
const SCROLL_STEP  = (CARD_W + GAP) * 2;
const MAX_SIZE     = 50 * 1024 * 1024;

// ─── helpers ────────────────────────────────────────────────────────────────

const toPublicUrl = (bucket, value) => {
  if (!value) return "";
  const v = String(value).trim();
  if (/^https?:\/\//i.test(v)) return v;
  const { data } = supabase.storage.from(bucket).getPublicUrl(v);
  return data?.publicUrl || "";
};

const cacheBust = (url) =>
  url ? `${url}${url.includes("?") ? "&" : "?"}cb=${Date.now()}` : "";

const truncateName = (name = "", max = 11) => {
  const n = String(name).trim();
  return n.length <= max ? n : n.slice(0, max - 1) + "…";
};

const resolveItemUrl = (item) => {
  if (!item) return "";
  if (item.url && /^https?:\/\//i.test(item.url)) return item.url;
  if (item.path) {
    const { data } = supabase.storage.from(STORY_BUCKET).getPublicUrl(item.path);
    return data?.publicUrl || "";
  }
  return "";
};

// ─── placeholder cards shown when no real stories ───────────────────────────

const PLACEHOLDER_STORIES = [
  {
    id: "ph1",
    name: "Sophia",
    avatar: "https://i.pravatar.cc/100?img=47",
    bg: "https://plus.unsplash.com/premium_photo-1683619761468-b06992704398?fm=jpg&q=60&w=3000&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MXx8ZmFzdGZvb2R8ZW58MHx8MHx8fDA%3D",
  },
  {
    id: "ph2",
    name: "Marcus",
    avatar: "https://i.pravatar.cc/100?img=68",
    bg: "https://images.unsplash.com/photo-1517434324-1db605ff03c7?fm=jpg&q=60&w=3000&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxzZWFyY2h8MTJ8fGZhc3QlMjBmb29kfGVufDB8fDB8fHww",
  },
  {
    id: "ph3",
    name: "Ayla",
    avatar: "https://i.pravatar.cc/100?img=25",
    bg: "https://thumbs.dreamstime.com/b/fast-food-real-image-photo-design-etc-377817747.jpg",
  },
  {
    id: "ph4",
    name: "Jordan",
    avatar: "https://i.pravatar.cc/100?img=60",
    bg: "https://images.unsplash.com/photo-1763689389824-dd2cea2e5772?fm=jpg&q=60&w=3000&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  },
  {
    id: "ph5",
    name: "Ali",
    avatar: "https://i.pravatar.cc/100?img=60",
    bg: "https://images.unsplash.com/photo-1763689389824-dd2cea2e5772?fm=jpg&q=60&w=3000&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  },
];

// ────────────────────────────────────────────────────────────────────────────

export default function StoriesBar({ me }) {
  const [rows,        setRows]        = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [viewer,      setViewer]      = useState(null);
  const [uploading,   setUploading]   = useState(false);
  const [reloadKey,   setReloadKey]   = useState(0);
  const [myAvatarUrl, setMyAvatarUrl] = useState("https://placehold.co/115x145?text=U");

  const [canScrollLeft,  setCanScrollLeft]  = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [deletingStory, setDeletingStory] = useState(false);

  const scrollerRef = useRef(null);
  const fileRef     = useRef(null);

  // ── nav arrows ─────────────────────────────────────────────────────────────

  const updateNav = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = Math.max(0, el.scrollWidth - el.clientWidth - 1);
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft < max);
  }, []);

  useEffect(() => {
    const onShow = () => {
      const el = scrollerRef.current;
      if (el) el.scrollLeft = 0;
      setTimeout(updateNav, 50);
    };
    window.addEventListener("pageshow", onShow);
    document.addEventListener("visibilitychange", onShow);
    return () => {
      window.removeEventListener("pageshow", onShow);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [updateNav]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateNav, { passive: true });
    requestAnimationFrame(updateNav);
    return () => el.removeEventListener("scroll", updateNav);
  }, [updateNav]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollLeft = 0;
    const t = setTimeout(updateNav, 60);
    return () => clearTimeout(t);
  }, [rows.length, loading, updateNav]);

  useEffect(() => {
    window.addEventListener("resize", updateNav);
    return () => window.removeEventListener("resize", updateNav);
  }, [updateNav]);

  // ── my avatar ──────────────────────────────────────────────────────────────

  useEffect(() => {
    let on = true;
    (async () => {
      if (!me?.id) return;
      const { data } = await supabase
        .from("profiles").select("avatar_url").eq("id", me.id).maybeSingle();
      const url = cacheBust(toPublicUrl(AVATAR_BUCKET, data?.avatar_url || ""));
      if (on) setMyAvatarUrl(url || "https://placehold.co/115x145?text=U");
    })();
    return () => { on = false; };
  }, [me?.id]);

  // ── load stories ───────────────────────────────────────────────────────────

  useEffect(() => {
    let on = true;
    (async () => {
      if (!me?.id) { setRows([]); setLoading(false); return; }
      setLoading(true);
      try {
        const { data: following } = await supabase
          .from("follows").select("following_id").eq("follower_id", me.id);

        const ids = Array.from(new Set([me.id, ...((following || []).map(x => x.following_id))]));

        const { data: stories } = await supabase
          .from("stories")
          .select("id, user_id, created_at, expires_at, is_archived")
          .in("user_id", ids)
          .gt("expires_at", new Date().toISOString())
          .eq("is_archived", false)
          .order("created_at", { ascending: false });

        if (!stories?.length) { if (on) { setRows([]); setLoading(false); } return; }

        const storyIds = stories.map(s => s.id);
        const { data: items } = await supabase
          .from("story_items")
          .select("id, story_id, kind, url, path, sort_order")
          .in("story_id", storyIds)
          .order("sort_order", { ascending: true });

        const firstByStory = new Map();
        for (const it of items || []) {
          if (!firstByStory.has(it.story_id)) firstByStory.set(it.story_id, it);
        }

        const storyUserIds = Array.from(new Set(stories.map(s => s.user_id)));
        const { data: profs } = await supabase
          .from("profiles").select("id, full_name, avatar_url").in("id", storyUserIds);

        const profById = new Map((profs || []).map(p => [p.id, p]));

        const list = stories.map(s => {
          const p      = profById.get(s.user_id);
          const avatar = cacheBust(toPublicUrl(AVATAR_BUCKET, p?.avatar_url || ""));
          const first  = firstByStory.get(s.id);
          const thumb  = first ? resolveItemUrl(first) : "";
          return {
            story_id:   s.id,
            user_id:    s.user_id,
            full_name:  p?.full_name || "User",
            avatar_url: avatar || "https://placehold.co/40x40?text=U",
            thumb_url:  thumb || avatar || "",
            expires_at: s.expires_at,
          };
        });

        list.sort((a, b) => (a.user_id === me.id ? -1 : b.user_id === me.id ? 1 : 0));
        if (on) setRows(list);
      } catch (e) {
        console.error("Stories load error:", e);
        if (on) setRows([]);
      } finally {
        if (on) setLoading(false);
      }
    })();
    return () => { on = false; };
  }, [me?.id, reloadKey]);

  // ── open viewer ────────────────────────────────────────────────────────────

  const openStory = async (row) => {
    if (!row?.story_id) return;
    try {
      const { data: items, error } = await supabase
        .from("story_items")
        .select("*")
        .eq("story_id", row.story_id)
        .order("sort_order", { ascending: true });

      if (error) { console.error(error); return; }
      if (!items?.length) { alert("No media found for this story."); return; }

      const parsed = items
        .map(item => ({ ...item, url: resolveItemUrl(item) }))
        .filter(i => i.url);

      if (!parsed.length) {
        alert("Story media could not be loaded. Check Supabase storage bucket permissions.");
        return;
      }

      setViewer({ user: row, items: parsed, index: 0 });
    } catch (e) {
      console.error("openStory error:", e);
    }
  };


  const deleteMyStory = async () => {
  if (!viewer?.user?.story_id || !me?.id) return;

  const storyId = viewer.user.story_id;

  if (viewer.user.user_id !== me.id) {
    alert("You can only delete your own story.");
    return;
  }

  const ok = window.confirm("Are you sure you want to delete this story?");
  if (!ok) return;

  setDeletingStory(true);

  try {
    const { data: items, error: itemFetchError } = await supabase
      .from("story_items")
      .select("id, path")
      .eq("story_id", storyId);

    if (itemFetchError) throw itemFetchError;

    const storagePaths = (items || [])
      .map((item) => item.path)
      .filter(Boolean);

    if (storagePaths.length) {
      const { error: storageError } = await supabase.storage
        .from(STORY_BUCKET)
        .remove(storagePaths);

      if (storageError) {
        console.warn("Storage delete warning:", storageError);
      }
    }

    const { error: itemsDeleteError } = await supabase
      .from("story_items")
      .delete()
      .eq("story_id", storyId);

    if (itemsDeleteError) throw itemsDeleteError;

    const { error: storyDeleteError } = await supabase
      .from("stories")
      .delete()
      .eq("id", storyId)
      .eq("user_id", me.id);

    if (storyDeleteError) throw storyDeleteError;

    setViewer(null);
    setReloadKey((k) => k + 1);
    setTimeout(updateNav, 120);
  } catch (err) {
    console.error("Story delete error:", err);
    alert(err.message || "Failed to delete story.");
  } finally {
    setDeletingStory(false);
  }
};
  // ── auto-advance images ────────────────────────────────────────────────────

  useEffect(() => {
    if (!viewer) return;
    const current = viewer.items[viewer.index];
    if (!current || current.kind === "video") return;
    const ms = current.duration_ms || 5000;
    const t  = setTimeout(() =>
      setViewer(v => v ? { ...v, index: (v.index + 1) % v.items.length } : v), ms);
    return () => clearTimeout(t);
  }, [viewer?.index, viewer]);

  // ── keyboard ───────────────────────────────────────────────────────────────

  const onKeyDown = useCallback((e) => {
    if (!viewer) return;
    if (e.key === "Escape")     setViewer(null);
    if (e.key === "ArrowRight") setViewer(v => v ? { ...v, index: (v.index + 1) % v.items.length } : v);
    if (e.key === "ArrowLeft")  setViewer(v => v ? { ...v, index: v.index > 0 ? v.index - 1 : v.items.length - 1 } : v);
  }, [viewer]);

  useEffect(() => {
    if (!viewer) return;
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [viewer, onKeyDown]);

  // ── scroll ─────────────────────────────────────────────────────────────────

  const scrollByStep = (dir) => {
    scrollerRef.current?.scrollBy({ left: dir * SCROLL_STEP, behavior: "smooth" });
    setTimeout(updateNav, 250);
  };

  // ── upload ─────────────────────────────────────────────────────────────────

  const onAddClick = () => { if (!me?.id || uploading) return; fileRef.current?.click(); };

  const onPickFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length || !me?.id) return;

    for (const f of files) {
      if (!f.type.startsWith("image/") && !f.type.startsWith("video/"))
        return alert("Only images or videos are allowed.");
      if (f.size > MAX_SIZE) return alert(`"${f.name}" is too large (max 50 MB).`);
    }

    setUploading(true);
    try {
      const nowISO    = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

      const { data: existing } = await supabase
        .from("stories").select("id").eq("user_id", me.id)
        .gt("expires_at", nowISO).eq("is_archived", false)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();

      let storyId = existing?.id;
      if (!storyId) {
        const { data: created, error: cErr } = await supabase
          .from("stories").insert({ user_id: me.id, expires_at: expiresAt }).select("id").single();
        if (cErr) throw cErr;
        storyId = created.id;
      }

      const { data: cur } = await supabase
        .from("story_items").select("sort_order").eq("story_id", storyId)
        .order("sort_order", { ascending: false }).limit(1);
      let sort = cur?.[0]?.sort_order ?? -1;

      const inserts = [];
      for (const f of files) {
        const ext  = (f.name.split(".").pop() || "bin").toLowerCase();
        const path = `${me.id}/${uuid()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from(STORY_BUCKET).upload(path, f, { cacheControl: "3600", upsert: false });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from(STORY_BUCKET).getPublicUrl(path);
        sort += 1;
        inserts.push({
          story_id:   storyId,
          kind:       f.type.startsWith("video/") ? "video" : "image",
          url:        pub?.publicUrl || "",
          path,
          sort_order: sort,
        });
      }

      if (inserts.length) {
        const { error: insErr } = await supabase.from("story_items").insert(inserts);
        if (insErr) throw insErr;
      }

      setReloadKey(k => k + 1);
      setTimeout(updateNav, 120);
    } catch (err) {
      console.error("Upload error:", err);
      alert(err.message || "Failed to add story.");
    } finally {
      setUploading(false);
    }
  };

  // ── render ─────────────────────────────────────────────────────────────────

  if (!me) return null;

  const showPlaceholders = !loading && rows.length === 0;
  const placeholders     = showPlaceholders ? PLACEHOLDER_STORIES : [];
  const totalCards       = 1 + rows.length + placeholders.length;
  const shouldClamp      = totalCards > MAX_VISIBLE;
  const clampWidth       = CARD_W * MAX_VISIBLE + GAP * (MAX_VISIBLE - 1);

  return (
    <div className="sb-wrap">
      <div className="sb-rail">

        {/* nav arrows */}
        {shouldClamp && canScrollLeft && (
          <button className="sb-nav sb-nav--left" onClick={() => scrollByStep(-1)} aria-label="Scroll left">
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M10.828 12l4.95 4.95-1.414 1.414L8 12l6.364-6.364 1.414 1.414z"/></svg>
          </button>
        )}
        {shouldClamp && canScrollRight && (
          <button className="sb-nav sb-nav--right" onClick={() => scrollByStep(1)} aria-label="Scroll right">
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M13.172 12l-4.95-4.95 1.414-1.414L16 12l-6.364 6.364-1.414-1.414z"/></svg>
          </button>
        )}

        <div
          ref={scrollerRef}
          className="sb-scroll"
          style={shouldClamp ? { maxWidth: `${clampWidth}px` } : undefined}
        >

          {/* ── Create Story card ── */}
          <div
            className={`sb-card sb-card--create${uploading ? " sb-card--disabled" : ""}`}
            onClick={onAddClick}
            role="button"
            tabIndex={0}
            aria-label="Create story"
          >
            {/* top image = my avatar */}
            <div className="sb-card__photo">
              <img
                src={myAvatarUrl}
                alt="Your photo"
                onError={e => { e.target.src = "https://placehold.co/115x145?text=U"; }}
              />
            </div>
            {/* bottom white area */}
            <div className="sb-card__footer">
              <div className="sb-card__plus-btn">
                {uploading
                  ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="18" height="18" style={{animation:"sbSpin 1s linear infinite"}}><circle cx="12" cy="12" r="9" strokeOpacity=".25"/><path d="M12 3a9 9 0 0 1 9 9" strokeLinecap="round"/></svg>
                  : <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M11 11V5h2v6h6v2h-6v6h-2v-6H5v-2z"/></svg>
                }
              </div>
              <span className="sb-card__footer-label">Create story</span>
            </div>
          </div>

          <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden onChange={onPickFiles} />

          {/* ── skeletons ── */}
          {loading && [1,2,3].map(i => (
            <div key={i} className="sb-card sb-card--skeleton">
              <div className="sb-shimmer" />
            </div>
          ))}

          {/* ── real story cards ── */}
          {!loading && rows.map(r => (
            <button
              key={r.story_id}
              className="sb-card sb-card--story"
              onClick={() => openStory(r)}
              aria-label={`${r.full_name}'s story`}
            >
              <img
                className="sb-card__bg"
                src={r.thumb_url || r.avatar_url}
                alt=""
                onError={e => { e.target.src = r.avatar_url || "https://placehold.co/115x200?text=?"; }}
              />
              <div className="sb-card__vignette" />
              <div className="sb-card__ring">
                <img src={r.avatar_url} alt={r.full_name} onError={e => { e.target.src = "https://placehold.co/40x40?text=U"; }} />
              </div>
              <span className="sb-card__name">
                {r.user_id === me.id ? "Your story" : truncateName(r.full_name)}
              </span>
            </button>
          ))}

          {/* ── placeholder cards ── */}
          {placeholders.map(p => (
            <div
              key={p.id}
              className="sb-card sb-card--story sb-card--placeholder"
              aria-hidden="true"
            >
              <img className="sb-card__bg" src={p.bg} alt="" />
              <div className="sb-card__vignette" />
              <div className="sb-card__ring">
                <img src={p.avatar} alt="" />
              </div>
              <span className="sb-card__name">{p.name}</span>
            </div>
          ))}

        </div>
      </div>

      {/* ════════════════════════ VIEWER ════════════════════════ */}
      {viewer && (
        <div
          className="sv-backdrop"
          onClick={e => { if (e.currentTarget === e.target) setViewer(null); }}
        >
          <div className="sv-shell">

            {/* progress */}
            <div className="sv-progress">
              {viewer.items.map((item, i) => (
                <div
                  key={i}
                  className={`sv-bar${i < viewer.index ? " sv-bar--done" : ""}`}
                >
                  {i === viewer.index && (
                    <span
                      className="sv-bar__fill"
                      style={{ animationDuration: item.kind === "video" ? "0ms" : `${item.duration_ms || 5000}ms` }}
                    />
                  )}
                </div>
              ))}
            </div>

            {/* header */}
            <div className="sv-header">
              <div className="sv-header__user">
                <img
                  className="sv-header__avatar"
                  src={viewer.user?.avatar_url || "https://placehold.co/40x40?text=U"}
                  alt=""
                />
                <div>
                  <div className="sv-header__name">{viewer.user?.full_name || "Story"}</div>
                  <div className="sv-header__time">Just now</div>
                </div>
              </div>
             <div className="sv-header__actions">
  {viewer.user?.user_id === me.id && (
    <button
      className="sv-delete"
      onClick={deleteMyStory}
      disabled={deletingStory}
      aria-label="Delete story"
      title="Delete story"
    >
      {deletingStory ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.3"
          width="18"
          height="18"
          style={{ animation: "sbSpin 1s linear infinite" }}
        >
          <circle cx="12" cy="12" r="9" strokeOpacity=".25" />
          <path d="M12 3a9 9 0 0 1 9 9" strokeLinecap="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
          <path d="M3 6h18" />
          <path d="M8 6V4h8v2" />
          <path d="M19 6l-1 15H6L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
        </svg>
      )}
    </button>
  )}

  <button className="sv-close" onClick={() => setViewer(null)} aria-label="Close">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" width="18" height="18">
      <path d="M18 6L6 18M6 6l12 12"/>
    </svg>
  </button>
</div>
            </div>

            {/* media */}
            <div className="sv-media">
              {viewer.items[viewer.index]?.kind === "video" ? (
                <video
                  key={viewer.items[viewer.index].url}
                  src={viewer.items[viewer.index].url}
                  autoPlay playsInline controls
                  onEnded={() => setViewer(v => v ? { ...v, index: (v.index + 1) % v.items.length } : v)}
                />
              ) : (
                <img
                  key={viewer.items[viewer.index]?.url}
                  src={viewer.items[viewer.index]?.url}
                  alt="Story"
                  onError={e => { e.target.src = "https://placehold.co/400x700?text=Not+found"; }}
                />
              )}
            </div>

            {/* left/right tap zones */}
            <div className="sv-tap sv-tap--l" onClick={() => setViewer(v => v ? { ...v, index: v.index > 0 ? v.index - 1 : v.items.length - 1 } : v)} />
            <div className="sv-tap sv-tap--r" onClick={() => setViewer(v => v ? { ...v, index: (v.index + 1) % v.items.length } : v)} />

            {/* visible nav */}
            <button
              className="sv-nav sv-nav--l"
              onClick={() => setViewer(v => v ? { ...v, index: v.index > 0 ? v.index - 1 : v.items.length - 1 } : v)}
              aria-label="Previous"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M10.828 12l4.95 4.95-1.414 1.414L8 12l6.364-6.364 1.414 1.414z"/></svg>
            </button>
            <button
              className="sv-nav sv-nav--r"
              onClick={() => setViewer(v => v ? { ...v, index: (v.index + 1) % v.items.length } : v)}
              aria-label="Next"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M13.172 12l-4.95-4.95 1.414-1.414L16 12l-6.364 6.364-1.414-1.414z"/></svg>
            </button>

            {/* counter */}
            <div className="sv-count">{viewer.index + 1} / {viewer.items.length}</div>

          </div>
        </div>
      )}

      <style>{`
        /* ── wrap & rail ── */
        .sv-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.sv-delete {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: rgba(239, 68, 68, 0.85);
  backdrop-filter: blur(6px);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background .15s, transform .15s;
  flex-shrink: 0;
}

.sv-delete:hover {
  background: rgba(220, 38, 38, 0.95);
  transform: scale(1.04);
}

.sv-delete:disabled {
  opacity: .65;
  cursor: not-allowed;
  transform: none;
}
        .sb-wrap { width: 100%; overflow: hidden; }
        .sb-rail { position: relative; }

        /* ── scroll strip ── */
        .sb-scroll {
          display: flex;
          gap: ${GAP}px;
          overflow-x: auto;
          overflow-y: visible;
          padding: 4px 2px 10px;
          scroll-behavior: smooth;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }
        .sb-scroll::-webkit-scrollbar { display: none; }

        /* ── nav arrows ── */
        .sb-nav {
          position: absolute;
          top: 50%; transform: translateY(-60%);
          z-index: 10;
          width: 32px; height: 32px;
          border-radius: 50%;
          border: 1px solid rgba(0,0,0,.12);
          background: #fff;
          box-shadow: 0 2px 8px rgba(0,0,0,.15);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          transition: background .15s;
        }
        .sb-nav:hover { background: #f0f2f5; }
        .sb-nav--left  { left: 2px; }
        .sb-nav--right { right: 2px; }

        /* ── base card ── */
        .sb-card {
          position: relative;
          flex: 0 0 auto;
          width: ${CARD_W}px;
          height: 200px;
          border-radius: 14px;
          overflow: hidden;
          border: none;
          padding: 0;
          cursor: pointer;
          background: #e4e6eb;
          transition: transform .2s ease, box-shadow .2s ease;
        }
        .sb-card--story:hover {
          transform: scale(1.035) translateY(-3px);
          // box-shadow: 0 10px 28px rgba(0,0,0,.22);
        }
        .sb-card--placeholder {
          cursor: default;
          pointer-events: none;
          opacity: .7;
        }
        .sb-card--disabled { opacity: .6; pointer-events: none; }

        /* ── story card internals ── */
        .sb-card__bg {
          position: absolute; inset: 0;
          width: 100%; height: 100%;
          object-fit: cover;
          display: block;
        }
        .sb-card__vignette {
          position: absolute; inset: 0;
          background: linear-gradient(
            180deg,
            rgba(0,0,0,.25) 0%,
            rgba(0,0,0,0)   40%,
            rgba(0,0,0,.65) 100%
          );
        }
        .sb-card__ring {
          position: absolute;
          top: 10px; left: 10px;
          width: 38px; height: 38px;
          border-radius: 50%;
          padding: 2px;
          background: linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888);
          box-shadow: 0 0 0 2.5px #fff;
        }
        .sb-card__ring img {
          width: 100%; height: 100%;
          border-radius: 50%;
          object-fit: cover;
          border: 2px solid #fff;
          display: block;
        }
        .sb-card__name {
          position: absolute;
          bottom: 10px; left: 8px; right: 8px;
          color: #fff;
          font-size: 12px; font-weight: 700;
          line-height: 1.2;
          text-shadow: 0 1px 4px rgba(0,0,0,.6);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* ── create story card ── */
        .sb-card--create {
          background: #fff;
          border: 1.5px solid #e4e6eb;
          display: flex;
          flex-direction: column;
          cursor: pointer;
          box-shadow: 0 1px 3px rgba(0,0,0,.07);
          transition: transform .2s ease, box-shadow .2s ease;
        }
        .sb-card--create:hover {
          transform: scale(1.035) translateY(-3px);
          // box-shadow: 0 10px 28px rgba(0,0,0,.15);
        }
        .sb-card__photo {
          flex: 0 0 148px;
          overflow: hidden;
        }
        .sb-card__photo img {
          width: 100%; height: 100%;
          object-fit: cover;
          display: block;
        }
        .sb-card__footer {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-end;
          padding-bottom: 10px;
          gap: 4px;
          background: #fff;
          position: relative;
        }
        .sb-card__plus-btn {
          width: 36px; height: 36px;
          border-radius: 50%;
          background: #1877f2;
          color: #fff;
          display: flex; align-items: center; justify-content: center;
          border: 3px solid #fff;
          box-shadow: 0 2px 6px rgba(24,119,242,.45);
          position: absolute;
          top: -18px;
        }
        .sb-card__footer-label {
          font-size: 11.5px;
          font-weight: 700;
          color: #050505;
          margin-top: 16px;
        }

        /* ── skeleton ── */
        .sb-card--skeleton { cursor: default; pointer-events: none; }
        .sb-shimmer {
          position: absolute; inset: 0;
          background: linear-gradient(90deg, #e4e6eb 25%, #f5f6f7 50%, #e4e6eb 75%);
          background-size: 200% 100%;
          animation: sbShimmer 1.5s infinite;
        }
        @keyframes sbShimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
        @keyframes sbSpin    { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        /* ════════════════════════════════
           VIEWER
        ════════════════════════════════ */
        .sv-backdrop {
          position: fixed; inset: 0;
          background: rgba(0,0,0,.88);
          display: flex; align-items: center; justify-content: center;
          z-index: 9999;
          padding: 12px;
        }
        .sv-shell {
          position: relative;
          width: 100%; max-width: 400px;
          height: min(90vh, 720px);
          background: #111;
          border-radius: 20px;
          overflow: hidden;
          display: flex; flex-direction: column;
          box-shadow: 0 32px 80px rgba(0,0,0,.85);
          animation: svPop .22s cubic-bezier(.34,1.56,.64,1);
        }
        @keyframes svPop { from { transform: scale(.92); opacity: 0; } to { transform: scale(1); opacity: 1; } }

        /* progress */
        .sv-progress {
          position: absolute; top: 0; left: 0; right: 0;
          z-index: 20;
          display: flex; gap: 3px;
          padding: 10px 10px 0;
        }
        .sv-bar {
          flex: 1; height: 3px;
          border-radius: 99px;
          background: rgba(255,255,255,.28);
          overflow: hidden;
        }
        .sv-bar--done { background: rgba(255,255,255,.9); }
        .sv-bar__fill {
          display: block;
          height: 100%; width: 0;
          background: #fff;
          border-radius: 99px;
          animation: svFill linear forwards;
        }
        @keyframes svFill { from { width: 0%; } to { width: 100%; } }

        /* header */
        .sv-header {
          position: absolute; top: 0; left: 0; right: 0;
          z-index: 15;
          display: flex; align-items: center; justify-content: space-between;
          padding: 26px 12px 14px;
          background: linear-gradient(to bottom, rgba(0,0,0,.58), transparent);
        }
        .sv-header__user { display: flex; align-items: center; gap: 10px; }
        .sv-header__avatar { width: 36px; height: 36px; border-radius: 50%; object-fit: cover; border: 2px solid rgba(255,255,255,.65); }
        .sv-header__name  { color: #fff; font-size: 13.5px; font-weight: 700; }
        .sv-header__time  { color: rgba(255,255,255,.55); font-size: 11px; margin-top: 1px; }
        .sv-close {
          width: 32px; height: 32px;
          border: none; border-radius: 50%;
          background: rgba(0,0,0,.38);
          backdrop-filter: blur(6px);
          color: #fff;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          transition: background .15s;
          flex-shrink: 0;
        }
        .sv-close:hover { background: rgba(0,0,0,.6); }

        /* media */
        .sv-media { flex: 1; overflow: hidden; }
        .sv-media img,
        .sv-media video { width: 100%; height: 100%; object-fit: cover; display: block; }

        /* tap zones */
        .sv-tap { position: absolute; top: 0; bottom: 0; width: 35%; z-index: 5; cursor: pointer; }
        .sv-tap--l { left: 0; }
        .sv-tap--r { right: 0; }

        /* nav buttons */
        .sv-nav {
          position: absolute; top: 50%; transform: translateY(-50%);
          z-index: 10;
          width: 40px; height: 40px;
          border: none; border-radius: 50%;
          background: rgba(255,255,255,.18);
          backdrop-filter: blur(8px);
          color: #fff;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          transition: background .15s;
        }
        .sv-nav:hover { background: rgba(255,255,255,.32); }
        .sv-nav--l { left: 10px; }
        .sv-nav--r { right: 10px; }

        /* counter */
        .sv-count {
          position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
          z-index: 10;
          color: rgba(255,255,255,.8);
          font-size: 12px; font-weight: 600;
          background: rgba(0,0,0,.38);
          backdrop-filter: blur(6px);
          padding: 4px 12px;
          border-radius: 20px;
          white-space: nowrap;
        }

        /* ── responsive ── */
        @media (max-width: 600px) {
          .sb-card { width: 96px; height: 172px; }
          .sb-card__photo { flex: 0 0 124px; }
          .sv-shell { border-radius: 14px; max-width: 100%; height: min(94vh, 680px); }
          .sv-nav { display: none; }
        }
      `}</style>
    </div>
  );
}