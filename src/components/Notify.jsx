import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import supabase from "../supabaseClient";
import {
  FaUser, FaAt, FaCommentDots, FaHeart, FaBell, FaCheckDouble, FaExternalLinkAlt,
} from "react-icons/fa";

const AVATAR_BUCKET = "avatars";
const PAGE_SIZE = 12;

const tabs = [
  { key: "all", label: "All" },
  { key: "comment", label: "Comments" },
  { key: "like", label: "Likes" },
  { key: "mention", label: "Mentions" },
];

function timeAgo(ts) {
  const d = new Date(ts);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString();
}

const iconFor = (type) => {
  switch (type) {
    case "mention": return <FaAt />;
    case "comment": return <FaCommentDots />;
    case "like": return <FaHeart />;
    case "profile_view": return <FaUser />;
    default: return <FaBell />;
  }
};

const toPublicUrl = (bucket, path) => {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl || "";
};

const profileCache = new Map();
async function getProfile(uid) {
  if (!uid) return null;
  if (profileCache.has(uid)) return profileCache.get(uid);
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, username, avatar_url")
    .eq("id", uid)
    .maybeSingle();
  if (error) return null;
  const prof = data
    ? { ...data, avatar_url: toPublicUrl(AVATAR_BUCKET, data.avatar_url) }
    : null;
  profileCache.set(uid, prof);
  return prof;
}

/* ================== Modal: Post Preview ================== */

function PostPreviewModal({ open, onClose, postId, highlightCommentId, currentUserId }) {
  const [loading, setLoading] = useState(false);
  const [post, setPost] = useState(null);
  const [author, setAuthor] = useState(null);
  const [comments, setComments] = useState([]);
  const [metrics, setMetrics] = useState({ likes: 0, comments: 0, views: 0, iLiked: false });
  const [images, setImages] = useState([]); // array of urls
  const [videos, setVideos] = useState([]); // array of urls

  const isHttpUrl = (s) => typeof s === "string" && /^https?:\/\//i.test(s);
// ---- helpers (inside PostPreviewModal) ----
const toStr = (v) => (v ?? "").toString();

const extractPlainText = (val) => {
  if (!val) return "";
  if (typeof val === "string") {
    const tmp = document.createElement("div");
    tmp.innerHTML = val;
    const text = tmp.textContent || tmp.innerText || "";
    return text.trim() || val.trim();
  }
  if (typeof val === "object") {
    try {
      if (Array.isArray(val)) return val.map(extractPlainText).join(" ").trim();
      if (val.type || val.content || val.children) {
        const walk = (node) => {
          if (!node) return "";
          if (typeof node === "string") return node;
          if (node.text) return node.text;
          const kids = node.content || node.children || node.nodes || [];
          return (kids || []).map(walk).join(" ");
        };
        return walk(val).replace(/\s+/g, " ").trim();
      }
      return JSON.stringify(val);
    } catch {}
  }
  if (typeof val === "string" && (/^\s*[\[{]/.test(val))) {
    try { return extractPlainText(JSON.parse(val)); } catch {}
  }
  return "";
};

/** Prefer the first non-empty content-like field (now includes caption_html) */
const pickText = (row) => {
  if (!row) return "";
  const candidates = [
    row.caption_html,       // <-- HTML caption (preferred if we render as HTML)
    row.body, row.content, row.text, row.caption, row.description,
    row.content_html, row.html, row.content_json, row.rich_text, row.richtext
  ];
  for (const c of candidates) {
    const t = extractPlainText(c);
    if (t && t.trim().length) return t;
  }
  return "";
};


  // Normalize any iterable to array
  const asArray = (v) => Array.isArray(v) ? v : (v ? [v] : []);

  // Extract media urls from a post row with many possible shapes
  const extractInlineMedia = (row) => {
    const imgs = new Set();
    const vids = new Set();

    // Common single fields
    [
      row?.media_url, row?.image_url, row?.image, row?.cover_url, row?.thumbnail_url,
      row?.banner_url, row?.photo_url
    ].filter(Boolean).forEach((u) => imgs.add(u));

    // Arrays that may contain strings or objects
    [
      row?.images, row?.photos, row?.gallery, row?.attachments, row?.files
    ].filter(Boolean).forEach((arr) => {
      asArray(arr).forEach((item) => {
        if (!item) return;
        if (typeof item === "string") imgs.add(item);
        else if (typeof item === "object") {
          const u = item.url || item.src || item.path;
          if (u) imgs.add(u);
        }
      });
    });

    // Generic media field could be object or array with type/url
    const media = row?.media || row?.media_items;
    asArray(media).forEach((m) => {
      if (!m) return;
      const typ = (m.type || m.kind || "").toLowerCase();
      const u = m.url || m.src || m.path;
      if (!u) return;
      if (typ.includes("video")) vids.add(u);
      else imgs.add(u);
    });

    // Video-specific single fields
    [row?.video_url, row?.mp4_url, row?.webm_url].filter(Boolean).forEach((u) => vids.add(u));

    return { images: [...imgs], videos: [...vids] };
  };

  // Simple count helper
  const countRows = async (table, filters) => {
    try {
      let q = supabase.from(table).select("id", { count: "exact", head: true });
      Object.entries(filters || {}).forEach(([k, v]) => { q = q.eq(k, v); });
      const { count } = await q;
      return count || 0;
    } catch { return 0; }
  };

  // Try reading side tables if they exist; ignore errors
  const tryFetchSideMedia = async (pid) => {
    const results = { images: [], videos: [] };
    const attempts = [
      // post_media: url + type
      supabase.from("post_media")
        .select("url,type").eq("post_id", pid),
      // post_images: url
      supabase.from("post_images")
        .select("url").eq("post_id", pid),
      // post_videos: url
      supabase.from("post_videos")
        .select("url").eq("post_id", pid),
    ];

    const settled = await Promise.allSettled(attempts);
    settled.forEach((res, idx) => {
      if (res.status !== "fulfilled" || !res.value?.data) return;
      const rows = res.value.data;
      if (idx === 0) {
        rows.forEach(r => {
          if (!r?.url) return;
          if ((r.type || "").toLowerCase().includes("video")) results.videos.push(r.url);
          else results.images.push(r.url);
        });
      } else if (idx === 1) {
        rows.forEach(r => r?.url && results.images.push(r.url));
      } else if (idx === 2) {
        rows.forEach(r => r?.url && results.videos.push(r.url));
      }
    });

    // De-dup
    results.images = [...new Set(results.images)];
    results.videos = [...new Set(results.videos)];
    return results;
  };

  useEffect(() => {
    if (!open || !postId) return;
    let on = true;

    (async () => {
      setLoading(true);

      // 1) Fetch post (select * so we survive different schemas)
      const { data: p, error } = await supabase
        .from("posts")
        .select("*")
        .eq("id", postId)
        .maybeSingle();

      if (!on) return;
      if (error || !p) {
        console.error("Post fetch failed:", error?.message);
        setPost(null); setAuthor(null); setComments([]); setMetrics({ likes: 0, comments: 0, views: 0, iLiked: false });
        setImages([]); setVideos([]);
        setLoading(false);
        return;
      }
      setPost(p);

      // 2) Author
      const prof = await getProfile(p.user_id);
      if (!on) return;
      setAuthor(prof || null);

      // 3) Comments (content/text/body tolerant)
      const { data: cmts } = await supabase
        .from("comments")
        .select("id, user_id, created_at, content, text, body")
        .eq("post_id", postId)
        .order("created_at", { ascending: true });
      if (!on) return;
      setComments(cmts || []);

      // 4) Metrics
      const [likesCount, commentsCount, viewsCount, iLikedRes] = await Promise.all([
        countRows("likes", { post_id: postId }),
        countRows("comments", { post_id: postId }),
        countRows("post_views", { post_id: postId }), // adjust if your views table name differs
        currentUserId
          ? supabase.from("likes").select("id").eq("post_id", postId).eq("user_id", currentUserId).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (!on) return;
      setMetrics({
        likes: likesCount,
        comments: commentsCount,
        views: viewsCount,
        iLiked: Boolean(iLikedRes?.data),
      });

      // 5) Media (inline + side tables)
      const inline = extractInlineMedia(p);
      const side = await tryFetchSideMedia(postId);
      if (!on) return;

      const imgSet = new Set([...inline.images, ...side.images]);
      const vidSet = new Set([...inline.videos, ...side.videos]);
      setImages([...imgSet]);
      setVideos([...vidSet]);

      setLoading(false);
    })();

    return () => { on = false; };
  }, [open, postId, currentUserId]);

  if (!open) return null;

  const postBody = pickText(post);
  const showMedia = images.length > 0 || videos.length > 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e)=>e.stopPropagation()}>
        <div className="modal-head">
          <h3>Post preview</h3>
          <button onClick={onClose} className="close">×</button>
        </div>

        {loading && <div className="modal-loading">Loading…</div>}

        {!loading && post && (
          <div className="post-card">
            {/* header */}
            <div className="post-header">
              <img
                src={author?.avatar_url || "https://placehold.co/40x40?text=U"}
                alt={author?.full_name || author?.username || "User"}
                className="ph-avatar"
              />
              <div className="ph-meta">
                <div className="ph-name">{author?.full_name || author?.username || "Unknown"}</div>
                <div className="ph-time">{timeAgo(post.created_at)}</div>
              </div>
            </div>

            {/* text content */}
           {typeof post?.caption_html === "string" && post.caption_html.trim().length ? (
  <div
    className="post-body post-body--html"
    dangerouslySetInnerHTML={{ __html: post.caption_html }}
  />
) : (
  postBody && <p className="post-body">{postBody}</p>
)}

            {/* media */}
            {showMedia && (
              <div className="post-media">
                {images.length > 0 && (
                  <div className="img-grid">
                    {images.map((u, i) => (
                      <img key={i} src={u} alt="" loading="lazy" />
                    ))}
                  </div>
                )}
                {videos.length > 0 && (
                  <div className="vid-list">
                    {videos.map((u, i) => (
                      <video key={i} src={u} controls playsInline />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* metrics bar */}
            <div className="metrics">
              <span>❤️ {metrics.likes}</span>
              <span>💬 {metrics.comments}</span>
              <span>👁️ {metrics.views}</span>
              {metrics.iLiked && <span className="you-like">You liked this</span>}
            </div>

            {/* comments list */}
            {comments?.length > 0 && (
              <div className="comments">
                <h5>Comments</h5>
                {comments.map((c) => {
                  const cText = toStr(c?.content ?? c?.text ?? c?.body ?? "");
                  return (
                    <div
                      key={c.id}
                      className={`c-row ${highlightCommentId === c.id ? "highlight" : ""}`}
                    >
                      <span className="c-content">{cText}</span>
                      <span className="c-time">{timeAgo(c.created_at)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <style>{`
          .modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:1000}
          .modal{width:min(820px,96vw);max-height:90vh;background:#fff;border-radius:12px;overflow:auto;box-shadow:0 10px 30px rgba(0,0,0,.2)}
          .modal-head{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid #eee}
        .close {
    border: 0;
    background: #f3f4f6;
    border-radius: 8px;
    padding: 0px 10px;
    cursor: pointer;
    font-size: 30px;
}
    .modal-backdrop .post-card{
    border:none;}
          .modal-loading{padding:24px}

          .post-card{padding:16px}
        .post-header {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-bottom: 8px;
    justify-content: flex-start;
}
          .ph-avatar{width:40px;height:40px;border-radius:50%;object-fit:cover;background:#eee}
          .ph-name{font-weight:700}
          .ph-time{font-size:12px;color:#6b7280}

          .post-title{margin:10px 0 6px 0}
          .post-body{margin:0 0 10px 0;color:#374151}

          .post-media{margin-top:10px;display:grid;gap:10px}
          .img-grid{display:block;width:100%; height:auto;}
          .img-grid img{width:100%;height:auto;object-fit:cover;border-radius:8px;background:#eee}
          .vid-list{display:grid;grid-template-columns:1fr;gap:10px}
          .vid-list video{width:100%;border-radius:8px;background:#000}

          .metrics{display:flex;gap:16px;align-items:center;margin-top:12px;color:#374151}
          .you-like{background:#f1f5ff;border:1px solid #dbeafe;padding:2px 8px;border-radius:999px;font-size:12px}

          .comments{margin-top:16px}
          .comments h5{margin:0 0 8px 0}
          .c-row{display:grid;grid-template-columns:1fr auto;gap:8px;padding:8px 0;border-bottom:1px solid #f2f2f2}
          .c-row:last-child{border-bottom:0}
          .c-row.highlight{background:#fff8e1}
          .c-content{color:#111}
          .c-time{color:#6b7280;font-size:12px}
        `}</style>
      </div>
    </div>
  );
}

/* ======================================================== */

function SkeletonRow() {
  return (
    <div className="noti-row skeleton">
      <div className="dot" />
      <div className="avatar" />
      <div className="content">
        <div className="line w60" />
        <div className="line w40" />
      </div>
      <div className="time" />
      <style>{`
        .skeleton { position: relative; overflow: hidden; }
        .skeleton .avatar,.skeleton .line,.skeleton .time,.skeleton .dot{
          background:#eee; border-radius:8px;
        }
        .skeleton:after{
          content:""; position:absolute; inset:0;
          background:linear-gradient(90deg,transparent,#ffffff80,transparent);
          transform:translateX(-100%); animation:sh 1.2s infinite;
        }
        @keyframes sh { to { transform: translateX(100%); } }
      `}</style>
    </div>
  );
}

export default function Notifications() {
  const [me, setMe] = useState(null);
  const [active, setActive] = useState("all");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [end, setEnd] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalPostId, setModalPostId] = useState(null);
  const [modalCommentId, setModalCommentId] = useState(null);

  const listRef = useRef(null);
  const pageRef = useRef(0);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMe(data.user ?? null));
  }, []);

  const baseFilter = useMemo(() => {
    if (active === "all") return null;
    return { type: active };
  }, [active]);

  const fetchPage = useCallback(async ({ reset = false } = {}) => {
    if (!me?.id) return;
    if (reset) {
      setLoading(true);
      pageRef.current = 0;
      setEnd(false);
      setRows([]);
    } else {
      if (loadingMore || end) return;
      setLoadingMore(true);
    }

    const from = pageRef.current * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let q = supabase
      .from("notifications")
      .select("*")
      .eq("user_id", me.id)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (baseFilter?.type) q = q.eq("type", baseFilter.type);

    const { data, error } = await q;
    if (error) console.error("fetch notifications:", error.message);

    // hydrate actor profiles
    const actorIds = [...new Set((data || []).map(r => r.actor_id).filter(Boolean))];
    const profs = await Promise.all(actorIds.map(getProfile));
    const profMap = new Map(actorIds.map((id, i) => [id, profs[i]]));

    const hydrated = (data || []).map(r => ({ ...r, _actor: profMap.get(r.actor_id) || null }));
    setRows(prev => reset ? hydrated : [...prev, ...hydrated]);
    pageRef.current += 1;
    if (!data || data.length < PAGE_SIZE) setEnd(true);

    const { count } = await supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", me.id)
      .is("read_at", null);

    setUnreadCount(count || 0);
    setLoading(false);
    setLoadingMore(false);
  }, [me?.id, baseFilter?.type, end, loadingMore]);

  useEffect(() => { if (me?.id) fetchPage({ reset: true }); }, [me?.id, active]); // eslint-disable-line

  // realtime
  useEffect(() => {
    if (!me?.id) return;
    const ch = supabase
      .channel(`noti-${me.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "notifications",
        filter: `user_id=eq.${me.id}`,
      }, async (payload) => {
        if (payload.eventType === "INSERT") {
          const prof = await getProfile(payload.new.actor_id);
          setRows(prev => [{ ...payload.new, _actor: prof }, ...prev]);
          setUnreadCount(c => c + 1);
        } else if (payload.eventType === "UPDATE") {
          setRows(prev => prev.map(r => r.id === payload.new.id ? { ...r, ...payload.new } : r));
        } else if (payload.eventType === "DELETE") {
          setRows(prev => prev.filter(r => r.id !== payload.old.id));
        }
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [me?.id]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      if (end || loading || loadingMore) return;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) fetchPage();
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [end, loading, loadingMore, fetchPage]);

  const markAsRead = async (id) => {
    const row = rows.find((r) => r.id === id);
    if (!row || row.read_at) return;
    const now = new Date().toISOString();
    setRows(prev => prev.map(r => r.id === id ? { ...r, read_at: now } : r));
    setUnreadCount(c => Math.max(0, c - 1));
    await supabase.from("notifications").update({ read_at: now }).eq("id", id);
  };

  const markAllRead = async () => {
    if (!me?.id || unreadCount === 0) return;
    const now = new Date().toISOString();
    setRows(prev => prev.map(r => r.read_at ? r : { ...r, read_at: now }));
    setUnreadCount(0);
    await supabase
      .from("notifications")
      .update({ read_at: now })
      .eq("user_id", me.id)
      .is("read_at", null);
  };

  const openPostModal = (n) => {
    if (!n.post_id) {
      // fallback: if no post to preview but have link_url, navigate
      if (n.link_url) window.location.href = n.link_url;
      return;
    }
    setModalPostId(n.post_id);
    setModalCommentId(n.comment_id || null);
    setModalOpen(true);
    markAsRead(n.id);
  };

  return (
    <div className="noti-page">
      <div className="noti-header">
        <div className="tabs">
          {tabs.map(t => (
            <button key={t.key}
              className={t.key === active ? "active" : ""}
              onClick={() => setActive(t.key)}>
              {t.label}
              {t.key === "all" && unreadCount > 0 && <span className="badge">{unreadCount}</span>}
            </button>
          ))}
        </div>

        <button className="mark-all" onClick={markAllRead} disabled={!unreadCount}>
          <FaCheckDouble /> Mark all read
        </button>
      </div>

      <div className="noti-list" ref={listRef}>
        {loading && Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)}

        {!loading && rows.length === 0 && (
          <div className="empty">
            <FaBell /> No notifications yet.
          </div>
        )}

        {rows.map((n) => (
          <NotificationRow
            key={n.id}
            n={n}
            onSeen={() => markAsRead(n.id)}
            onOpen={() => openPostModal(n)}
          />
        ))}

        {loadingMore && <div className="loading-more">Loading…</div>}
        {end && rows.length > 0 && <div className="end">You're all caught up 🎉</div>}
      </div>

      <PostPreviewModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        postId={modalPostId}
        highlightCommentId={modalCommentId}
      />

      <style>{`
        .noti-page{background:#fff;border-radius:12px;box-shadow:0 4px 18px rgba(0,0,0,.06);overflow:hidden}
        .noti-header{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid #eee}
        .tabs{display:flex;gap:8px}
        .tabs button{border:1px solid #e5e5e5;background:#fafafa;padding:6px 12px;border-radius:999px;font-weight:600}
        .tabs button.active{background:#0a66c2;color:#fff;border-color:#0a66c2}
        // .badge{margin-left:6px;background:#fff;color:#0a66c2;border-radius:10px;padding:0 6px;font-size:12px}
        .mark-all{display:flex;align-items:center;gap:6px;background:#f5f5f5;border:1px solid #e5e5e5;border-radius:8px;padding:6px 10px}
        .noti-list{max-height:70vh;overflow:auto}
        .noti-row{display:grid;grid-template-columns:16px 44px 1fr auto;gap:12px;padding:12px 16px;border-bottom:1px solid #f2f2f2;align-items:center}
        .noti-row.unread{background:#f7fbff}
        .dot{width:10px;height:10px;border-radius:50%;background:#0a66c2;justify-self:center}
        .noti-row.read .dot{background:transparent}
        .avatar{width:44px;height:44px;border-radius:50%;object-fit:cover;background:#eee}
        .content .title{font-weight:600;margin:0 0 4px 0; font-size: 14px}
      .content .body {
    margin: 0;
    color: #4b5563;
    font-size: 14px;
}
        .time{color:#6b7280;font-size:12px;white-space:nowrap}
        .actions{margin-top:6px;display:flex;gap:8px}
        .chip{display:inline-flex;align-items:center;gap:6px;border:1px solid #e5e5e5;border-radius:999px;padding:4px 8px;font-size:12px;background:#fafafa}
        .btn-outline{display:inline-flex;align-items:center;gap:6px;border:1px solid #0a66c2;color:#0a66c2;background:#fff;border-radius:8px;padding:4px 8px}
        .empty{padding:28px;color:#6b7280;display:flex;gap:10px;align-items:center;justify-content:center}
        .loading-more,.end{padding:10px;text-align:center;color:#6b7280}
        .noti-row.skeleton{grid-template-columns:16px 44px 1fr 60px}
        .noti-row.skeleton .dot{width:10px;height:10px}
        .noti-row.skeleton .avatar{height:44px}
        .noti-row.skeleton .line{height:12px;margin:6px 0}
        .noti-row.skeleton .w60{width:60%}
        .noti-row.skeleton .w40{width:40%}
      `}</style>
    </div>
  );
}

function titleFor(n, actorName) {
  switch (n.type) {
    case "comment": return `${actorName} commented on your post`;
    case "like": return `${actorName} liked your post`;
    case "mention": return `${actorName} mentioned you`;
    case "profile_view": return `${actorName} viewed your profile`;
    default: return actorName || "Notification";
  }
}

function NotificationRow({ n, onSeen, onOpen }) {
  const [actor, setActor] = useState(n._actor || null);

  useEffect(() => {
    let on = true;
    (async () => {
      if (!n.actor_id || actor) return;
      const prof = await getProfile(n.actor_id);
      if (on) setActor(prof);
    })();
    return () => { on = false; };
  }, [n.actor_id]);

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && onSeen()),
      { threshold: 0.6 }
    );
    const el = document.getElementById(`noti-${n.id}`);
    if (el) obs.observe(el);
    return () => el && obs.unobserve(el);
  }, [n.id, onSeen]);

  const avatar = actor?.avatar_url || "https://placehold.co/44x44?text=U";
  const displayName = actor?.full_name || actor?.username || "Someone";

  const chip = useMemo(() => {
    switch (n.type) {
      case "mention": return <span className="chip"><FaAt/> Mention</span>;
      case "comment": return <span className="chip"><FaCommentDots/> Comment</span>;
      case "like": return <span className="chip"><FaHeart/> Like</span>;
      case "profile_view": return <span className="chip"><FaUser/> Profile view</span>;
      default: return null;
    }
  }, [n.type]);

  const canPreview = Boolean(n.post_id);

  return (
    <div id={`noti-${n.id}`} className={`noti-row ${n.read_at ? "read" : "unread"}`}>
      <div className="dot" />
      <Link to={actor ? `/u/${actor.id}` : "#"} title={displayName}>
        <img src={avatar} alt={displayName} className="avatar"
             onError={(e)=>e.currentTarget.src="https://placehold.co/44x44?text=U"} />
      </Link>

      <div className="content">
        <p className="title">
           {titleFor(n, displayName)}
        </p>
        {n.body && <p className="body">{n.body}</p>}

        <div className="actions">
          {chip}
          {canPreview ? (
            <button className="btn-outline" onClick={onOpen}>
              View <FaExternalLinkAlt />
            </button>
          ) : n.link_url ? (
            <Link to={n.link_url} className="btn-outline" onClick={onSeen}>
              Open <FaExternalLinkAlt />
            </Link>
          ) : null}
        </div>
      </div>

      <div className="time">{timeAgo(n.created_at)}</div>
    </div>
  );
}
