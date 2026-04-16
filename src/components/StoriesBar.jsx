// components/StoriesBar.jsx
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import supabase from "../supabaseClient";
import { v4 as uuid } from "uuid";

const AVATAR_BUCKET = "avatars";
const STORY_BUCKET = "stories";

// ---- Slider rules
const MAX_VISIBLE = 6;            // ek waqt me sirf 6 bubbles
const BUBBLE_W = 74;              // .story-bubble exact width (px)
const GAP = 14;                   // gap between bubbles (px)
const PAD_X = 8;                  // horizontal padding total: 4px + 4px
const SCROLL_STEP = (BUBBLE_W + GAP) * 3;  // ~3 bubbles per click

// ---- Upload
const MAX_SIZE = 50 * 1024 * 1024; // 50MB

const toPublicUrl = (bucket, value) => {
  if (!value) return "";
  const v = String(value).trim();
  if (/^https?:\/\//i.test(v)) return v;
  const { data } = supabase.storage.from(bucket).getPublicUrl(v);
  return data?.publicUrl || "";
};
const cacheBust = (url) =>
  (!url ? "" : `${url}${url.includes("?") ? "&" : "?"}cb=${Date.now()}`);

const truncateName = (name = "", max = 12) => {
  const n = String(name).trim();
  return n.length <= max ? n : n.slice(0, max - 1) + "…";
};

export default function StoriesBar({ me }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewer, setViewer] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [myAvatarUrl, setMyAvatarUrl] = useState("https://placehold.co/40x40?text=U");

  // slider state
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const scrollerRef = useRef(null);
  const fileRef = useRef(null);

  // --- Nav visibility (no measurements; pure math on scroll positions)
  const updateNav = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const maxScrollLeft = Math.max(0, el.scrollWidth - el.clientWidth - 1);
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft < maxScrollLeft);
  }, []);

  // ensure re-init after returning to the page or when tab becomes visible
  useEffect(() => {
    const onShow = () => {
      const el = scrollerRef.current;
      if (!el) return;
      // reset to start so left arrow hides properly
      el.scrollLeft = 0;
      // small delay so layout/SSR hydration settles
      setTimeout(updateNav, 50);
    };
    window.addEventListener("pageshow", onShow);         // back/forward nav
    document.addEventListener("visibilitychange", onShow);
    return () => {
      window.removeEventListener("pageshow", onShow);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [updateNav]);

  // Scroll listener (live arrow updates)
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => updateNav();
    el.addEventListener("scroll", onScroll, { passive: true });
    // initial
    requestAnimationFrame(updateNav);
    return () => el.removeEventListener("scroll", onScroll);
  }, [updateNav]);

  // Recalc when list changes or finishes loading
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollLeft = 0; // list changed → reset position
    const t = setTimeout(updateNav, 60);
    return () => clearTimeout(t);
  }, [rows.length, loading, updateNav]);

  // Recalc on resize
  useEffect(() => {
    const onResize = () => updateNav();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [updateNav]);

  // --- My avatar
  useEffect(() => {
    let on = true;
    (async () => {
      if (!me?.id) return;
      const { data } = await supabase
        .from("profiles")
        .select("avatar_url")
        .eq("id", me.id)
        .maybeSingle();
      const url = cacheBust(toPublicUrl(AVATAR_BUCKET, data?.avatar_url || ""));
      if (on) setMyAvatarUrl(url || "https://placehold.co/40x40?text=U");
    })();
    return () => { on = false; };
  }, [me?.id]);

  // --- Load stories
  useEffect(() => {
    let on = true;
    (async () => {
      try {
        if (!me?.id) { setRows([]); return; }
        setLoading(true);

        const { data: following } = await supabase
          .from("follows")
          .select("following_id")
          .eq("follower_id", me.id);

        const ids = Array.from(new Set([me.id, ...((following || []).map(x => x.following_id))]));
        if (!ids.length) { setRows([]); return; }

        const { data: stories } = await supabase
          .from("stories")
          .select("id, user_id, created_at, expires_at, is_archived")
          .in("user_id", ids)
          .gt("expires_at", new Date().toISOString())
          .eq("is_archived", false)
          .order("created_at", { ascending: false });

        if (!stories?.length) { setRows([]); return; }

        const storyIds = stories.map(s => s.id);
        const { data: items } = await supabase
          .from("story_items")
          .select("id, story_id, kind, url, path, sort_order")
          .in("story_id", storyIds)
          .order("sort_order", { ascending: true });

        const firstByStory = new Map();
        for (const it of items || []) if (!firstByStory.has(it.story_id)) firstByStory.set(it.story_id, it);

        const storyUserIds = Array.from(new Set(stories.map(s => s.user_id)));
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url")
          .in("id", storyUserIds);

        const profById = new Map((profs || []).map(p => [p.id, p]));

        const list = stories.map(s => {
          const p = profById.get(s.user_id);
          const avatar = cacheBust(toPublicUrl(AVATAR_BUCKET, p?.avatar_url || ""));
          const first = firstByStory.get(s.id);
          return {
            story_id: s.id,
            user_id: s.user_id,
            full_name: p?.full_name || "User",
            avatar_url: avatar || "https://placehold.co/40x40?text=U",
            thumb_url: first?.url || "",
            expires_at: s.expires_at
          };
        });

        list.sort((a,b) => (a.user_id === me.id ? -1 : b.user_id === me.id ? 1 : 0));
        if (on) setRows(list);
      } catch (e) {
        console.error(e);
        if (on) setRows([]);
      } finally {
        if (on) setLoading(false);
      }
    })();

    return () => { on = false; };
  }, [me?.id, reloadKey]);

  // --- Open viewer
  const openStory = async (row) => {
    try {
      const { data: items } = await supabase
        .from("story_items")
        .select("id, kind, url, duration_ms, sort_order")
        .eq("story_id", row.story_id)
        .order("sort_order", { ascending: true });

      setViewer({ user: row, items: items || [], index: 0 });
    } catch (e) {
      console.error(e);
    }
  };

  // Auto-advance images
  useEffect(() => {
    if (!viewer) return;
    const current = viewer.items[viewer.index];
    if (!current) return;
    let t;
    if (current.kind === "image") {
      const ms = current.duration_ms || 5000;
      t = setTimeout(() => {
        setViewer(v => {
          if (!v) return v;
          const next = v.index + 1;
          return { ...v, index: next < v.items.length ? next : 0 };
        });
      }, ms);
    }
    return () => clearTimeout(t);
  }, [viewer?.index, viewer?.items, viewer]);

  const scrollByStep = (dir) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * SCROLL_STEP, behavior: "smooth" });
    // update arrows after motion
    setTimeout(updateNav, 200);
  };

  // --- Keyboard in viewer
  const onKeyDown = useCallback((e) => {
    if (!viewer) return;
    if (e.key === "Escape") setViewer(null);
    if (e.key === "ArrowRight") setViewer(v => ({ ...v, index: (v.index + 1) % v.items.length }));
    if (e.key === "ArrowLeft") setViewer(v => ({ ...v, index: v.index > 0 ? v.index - 1 : v.items.length - 1 }));
  }, [viewer]);
  useEffect(() => {
    if (!viewer) return;
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [viewer, onKeyDown]);

  // --- Add Story
  const onAddClick = () => {
    if (!me?.id || uploading) return;
    fileRef.current?.click();
  };

  const onPickFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length || !me?.id) return;

    for (const f of files) {
      const okType = f.type.startsWith("image/") || f.type.startsWith("video/");
      if (!okType) return alert("Only images or videos are allowed.");
      if (f.size > MAX_SIZE) return alert(`"${f.name}" is too large. Max 50MB.`);
    }

    try {
      setUploading(true);

      const nowISO = new Date().toISOString();
      let storyId;

      const { data: existing, error: exErr } = await supabase
        .from("stories")
        .select("id")
        .eq("user_id", me.id)
        .gt("expires_at", nowISO)
        .eq("is_archived", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (exErr) throw exErr;

      if (existing?.id) {
        storyId = existing.id;
      } else {
        const expiresAt = new Date(Date.now() + 24*60*60*1000).toISOString();
        const { data: created, error: crtErr } = await supabase
          .from("stories")
          .insert({ user_id: me.id, expires_at: expiresAt })
          .select("id")
          .single();
        if (crtErr) throw crtErr;
        storyId = created.id;
      }

      const { data: currentItems, error: ciErr } = await supabase
        .from("story_items")
        .select("sort_order")
        .eq("story_id", storyId)
        .order("sort_order", { ascending: false })
        .limit(1);
      if (ciErr) throw ciErr;
      let sort = currentItems?.[0]?.sort_order ?? -1;

      const inserts = [];
      for (const f of files) {
        const ext = (f.name.split(".").pop() || "").toLowerCase();
        const name = `${uuid()}.${ext}`;
        const path = `${me.id}/${name}`;

        const { error: upErr } = await supabase.storage
          .from(STORY_BUCKET)
          .upload(path, f, { cacheControl: "3600", upsert: false });
        if (upErr) throw upErr;

        const { data: pub } = supabase.storage.from(STORY_BUCKET).getPublicUrl(path);
        const url = pub?.publicUrl || "";

        sort += 1;
        inserts.push({
          story_id: storyId,
          kind: f.type.startsWith("video/") ? "video" : "image",
          url,
          path,
          sort_order: sort
        });
      }

      if (inserts.length) {
        const { error: insErr } = await supabase.from("story_items").insert(inserts);
        if (insErr) throw insErr;
      }

      setReloadKey(k => k + 1);
      setTimeout(updateNav, 120);
    } catch (err) {
      console.error(err);
      alert(err.message || "Failed to add story");
    } finally {
      setUploading(false);
    }
  };

  if (!me) return null;

  const totalBubbles = 1 + rows.length;                     // 1 (Add) + stories
  const shouldClamp = totalBubbles > MAX_VISIBLE;
  const clampWidth = BUBBLE_W * MAX_VISIBLE + GAP * (MAX_VISIBLE - 1) + PAD_X;

  return (
    <div className="stories-wrap">
      <div className="stories-rail">
        {shouldClamp && canScrollLeft && (
          <button className="s-nav left" onClick={() => scrollByStep(-1)} aria-label="Scroll left"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M10.8284 12.0007L15.7782 16.9504L14.364 18.3646L8 12.0007L14.364 5.63672L15.7782 7.05093L10.8284 12.0007Z"></path></svg></button>
        )}
        {shouldClamp && canScrollRight && (
          <button className="s-nav right" onClick={() => scrollByStep(1)} aria-label="Scroll right"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M13.1717 12.0007L8.22192 7.05093L9.63614 5.63672L16.0001 12.0007L9.63614 18.3646L8.22192 16.9504L13.1717 12.0007Z"></path></svg></button>
        )}

        <div
          ref={scrollerRef}
          className="stories-scroll"
          style={ shouldClamp ? { maxWidth: `${clampWidth}px` } : undefined }
        >
          {/* Add Story bubble */}
          <div
            className={`story-bubble add ${uploading ? "disabled" : ""}`}
            title={uploading ? "Uploading…" : "Add to story"}
            onClick={onAddClick}
          >
            <div className="ring plain">
              <img
                src={myAvatarUrl}
                alt="You"
                onError={(e)=>{e.currentTarget.src="https://placehold.co/40x40?text=U"}}
              />
              <span className="plus">+</span>
            </div>
            <div className="story-name" title="Add story">Add story</div>
          </div>

          {/* Hidden file input */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*,video/*"
            multiple
            hidden
            onChange={onPickFiles}
          />

          {/* Followed users' stories */}
          {loading ? (
            <div className="loading">Loading stories…</div>
          ) : rows.length === 0 ? (
            <div className="loading">No active stories.</div>
          ) : (
            rows.map((r) => (
              <button
                key={r.story_id}
                className="story-bubble"
                onClick={() => openStory(r)}
                title={r.full_name}
              >
                <div className="ring">
                  <img
                    src={r.avatar_url || "https://placehold.co/40x40?text=U"}
                    alt={r.full_name}
                    onError={(e)=>{e.currentTarget.src="https://placehold.co/40x40?text=U"}}
                  />
                </div>
                <div className="story-name" title={r.full_name}>
                  {r.user_id === me.id ? "Your story" : truncateName(r.full_name, 12)}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Viewer */}
      {viewer && (
        <div className="story-viewer" onClick={(e)=>{ if (e.target.classList.contains("story-viewer")) setViewer(null); }}>
          <div className="sv-card">
            <div className="sv-top">
              <div className="sv-user">
                <img src={viewer.user.avatar_url || "https://placehold.co/40x40?text=U"} alt={viewer.user.full_name} />
                <div className="sv-user-name" title={viewer.user.full_name}>{viewer.user.full_name}</div>
              </div>
              <button className="sv-btn ghost" onClick={() => setViewer(null)} aria-label="Close">✕</button>
            </div>

            <div className="sv-progress">
              {viewer.items.map((_, i) => (
                <div key={i} className={`sv-bar ${i <= viewer.index ? "active" : ""}`} />
              ))}
            </div>

            <div className="sv-media">
              {viewer.items[viewer.index]?.kind === "video" ? (
                <video
                  src={viewer.items[viewer.index].url}
                  autoPlay
                  controls
                  onEnded={() => setViewer(v => ({ ...v, index: (v.index + 1) % v.items.length }))}
                />
              ) : (
                <img src={viewer.items[viewer.index]?.url} alt="" />
              )}
            </div>

            <div className="sv-controls">
              <button
                className="sv-btn"
                onClick={() => setViewer(v => ({ ...v, index: v.index>0 ? v.index-1 : v.items.length-1 }))}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M10.8284 12.0007L15.7782 16.9504L14.364 18.3646L8 12.0007L14.364 5.63672L15.7782 7.05093L10.8284 12.0007Z"></path></svg> Prev
              </button>
              <div className="sv-count">{viewer.index+1} / {viewer.items.length}</div>
              <button
                className="sv-btn"
                onClick={() => setViewer(v => ({ ...v, index: (v.index+1) % v.items.length }))}
              >
                Next <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M13.1717 12.0007L8.22192 7.05093L9.63614 5.63672L16.0001 12.0007L9.63614 18.3646L8.22192 16.9504L13.1717 12.0007Z"></path></svg>
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .stories-wrap{ margin-bottom:12px; }
        .stories-rail{ position:relative; }
        .stories-scroll{
          --bubble-w: ${BUBBLE_W}px;
          --gap: ${GAP}px;
          display:flex; gap: var(--gap); overflow-x:auto; padding:6px 4px; scroll-behavior:smooth;
        }
        .stories-scroll::-webkit-scrollbar{ display:none; }
        .loading{ opacity:.7; padding:8px; color:#555; }

        .s-nav {
          position: absolute; top: 50%; transform: translateY(-50%);
          z-index: 2; border: none; background: rgba(255,255,255,.95);
          width: 20px; height: 20px; border-radius: 50%; cursor: pointer;
          box-shadow: 0 2px 6px rgba(0,0,0,.12); font-size: 20px; padding: 10px 11px 12px;
        }
        .s-nav.left { left: 4px; }
        .s-nav.right{ right: 4px; }
        .s-nav:hover{ filter:brightness(.96); }

        .story-bubble {
          width: var(--bubble-w);
          text-align: center; background: transparent; border: none; padding: 0; cursor: pointer;
          display: flex; flex-direction: column; gap: 0; flex: 0 0 auto;
        }
        .story-bubble.add.disabled{ pointer-events:none; opacity:.6; }

        .ring{
          width:66px; height:66px; border-radius:50%; padding:2.5px;
          background: conic-gradient(#f99 0 25%, #f7c 25% 50%, #96f 50% 75%, #f96 75% 100%);
          display:grid; place-items:center; margin:0 auto;
          transition: transform .18s ease, box-shadow .18s ease;
        }
        .ring.plain { width:66px; height:66px; background:#ddd; position:relative; }
        .story-bubble:hover .ring{ transform:translateY(-2px); box-shadow:0 6px 16px rgba(0,0,0,.12); }

        .ring img{ width:100%; height:100%; border-radius:50%; object-fit:cover; display:block; background:#eee; border:2px solid #FFF; }
        .plus{ position:absolute; right:-2px; bottom:-2px; width:25px; height:25px; border-radius:50%;
          background:#0a84ff; color:#fff; border:2px solid #fff; display:grid; place-items:center; font-size:16px; font-weight:600; }
        .story-name{ width: 70px; font-size: 11px; color: #444; margin: 4px auto 0; line-height: 1.1;
          overflow: hidden; white-space: nowrap; text-overflow: ellipsis; text-align: center; font-family: 'Poppins'; }

        /* Viewer */
        .story-viewer{ position:fixed; inset:0; background:rgba(0,0,0,.85); display:flex; align-items:center; justify-content:center; z-index:1000; padding:16px; }
        .sv-card{ width:min(480px, 96vw); background:#0f1115; border-radius:16px; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,.5); animation: svPop .18s ease-out; }
        @keyframes svPop{ from{ transform:translateY(10px); opacity:0; } to{ transform:translateY(0); opacity:1; } }
        .sv-top{ display:flex; align-items:center; gap:10px; padding:10px 12px; border-bottom:1px solid rgba(255,255,255,.06); }
        .sv-user{ display:flex; align-items:center; gap:8px; color:#fff; }
        .sv-user img{ width:28px; height:28px; border-radius:50%; object-fit:cover; display:block; }
        .sv-user-name{ font-weight:600; font-size:14px; max-width:260px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .sv-progress{ display:grid; grid-auto-flow:column; gap:6px; padding:10px 12px 0 12px; }
        .sv-bar{ height:3px; background:rgba(255,255,255,.18); border-radius:999px; }
        .sv-bar.active{ background:linear-gradient(90deg,#7aa2ff,#c68bff); }
        .sv-media{ background:#000; display:grid; place-items:center; }
        .sv-media img, .sv-media video{ width:100%; height:70vh; max-height:560px; object-fit:contain; display:block; }
        .sv-controls{ display:flex; align-items:center; justify-content:space-between; padding:10px 12px; background:#0f1115; border-top:1px solid rgba(255,255,255,.06); }
        .sv-count{ color:#aeb2bb; font-size:12px; }
        .sv-btn{ appearance:none; border:none; outline:none; background:#1b2130; color:#e9edf6; font-weight:600; font-size:13px; padding:8px 12px; border-radius:10px; cursor:pointer; box-shadow:0 4px 14px rgba(0,0,0,.18); transition: transform .12s ease, background .12s ease; }
        .sv-btn:hover{ transform:translateY(-1px); background:#22304a; }
        .sv-btn:active{ transform:translateY(0); }
        .sv-btn.ghost{ background:transparent; color:#cfd6e6; padding:6px 10px; border-radius:10px; }
        .sv-btn.ghost:hover{ background:rgba(255,255,255,.06); }
      `}</style>
    </div>
  );
}
