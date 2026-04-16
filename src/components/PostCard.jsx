import { useEffect, useMemo, useState, useCallback, useRef, Suspense } from "react";
import { Link } from "react-router-dom";
import { FaRegHeart, FaHeart, FaRegCommentDots, FaRegBookmark, FaBookmark, FaEllipsisH } from "react-icons/fa";
import supabase from "../supabaseClient";
import DOMPurify from "dompurify";

// ✅ Quill (React 19 compatible)
import ReactQuill from "react-quill-new";
import "react-quill-new/dist/quill.snow.css";

const IMAGE_BUCKET = "post-images";
const AVATAR_BUCKET = "avatars";
const VIDEO_EXT = /\.(mp4|webm|ogg|ogv|mov|m4v)$/i;

const isVideoByExt = (u = "") => VIDEO_EXT.test(String(u).split("?")[0]);

const safeHtml = (dirty) =>
  DOMPurify.sanitize(dirty || "", {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target", "rel"],
    ALLOWED_ATTR: ["href", "title", "target", "rel", "class", "style"],
  });

const quillModules = {
  toolbar: [
    [{ header: [1, 2, false] }],
    ["bold", "italic", "underline", "strike"],
    [{ list: "ordered" }, { list: "bullet" }],
    ["link", "blockquote", "code-block"],
    ["clean"],
  ],
};
const quillFormats = [
  "header",
  "bold",
  "italic",
  "underline",
  "strike",
  "list",
  "bullet",
  "link",
  "blockquote",
  "code-block",
];

const PROFILE_CACHE = new Map();
const PENDING = new Map();

export default function PostCard({ post }) {
  const [me, setMe] = useState(null);

  const [cur, setCur] = useState(post);
  useEffect(() => setCur(post), [post]);

  const [author, setAuthor] = useState(
    post?.profiles ? { ...post.profiles } : PROFILE_CACHE.get(post.user_id) || null
  );

  const [isFollowing, setIsFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);

  const [liked, setLiked] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);

  // ✅ Save state
  const [saved, setSaved] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);

  // Comments
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState([]);
  const [txt, setTxt] = useState("");

  const [likeCount, setLikeCount] = useState(post.like_count ?? 0);
  const [commentCount, setCommentCount] = useState(post.comment_count ?? 0);

  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(post.caption_html || "");
  const [editBusy, setEditBusy] = useState(false);

  // media replace
  const [replaceFile, setReplaceFile] = useState(null);
  const [replacePreview, setReplacePreview] = useState(null);

  // menu
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // auth (live)
  useEffect(() => {
    let unsub = () => {};
    (async () => {
      const { data } = await supabase.auth.getUser();
      setMe(data.user ?? null);
      const sub = supabase.auth.onAuthStateChange((_event, session) => {
        setMe(session?.user ?? null);
      });
      unsub = sub.data.subscription.unsubscribe;
    })();
    return () => {
      try { unsub?.(); } catch {}
    };
  }, []);

  // Normalize storage path → public URL, but keep http(s) as-is
  const toPublicUrl = useCallback((bucket, value) => {
    if (!value) return value;
    if (/^https?:\/\//i.test(value)) return value;
    try {
      const { data } = supabase.storage.from(bucket).getPublicUrl(value);
      return data?.publicUrl || value;
    } catch {
      return value;
    }
  }, []);

  // author fast load + cache
  useEffect(() => {
    let alive = true;

    if (post?.profiles) {
      const p = post.profiles || {};
      const a = {
        ...p,
        avatar_url: toPublicUrl(AVATAR_BUCKET, p.avatar_url),
      };
      PROFILE_CACHE.set(post.user_id, a);
      setAuthor(a);
      return;
    }

    const cached = PROFILE_CACHE.get(post.user_id);
    if (cached) setAuthor(cached);

    if (!PENDING.has(post.user_id)) {
      PENDING.set(
        post.user_id,
        (async () => {
          const { data, error } = await supabase
            .from("profiles")
            .select("full_name, username, avatar_url")
            .eq("id", post.user_id)
            .maybeSingle();
          if (error) console.warn("profiles load:", error.message);
          const a = data
            ? {
                ...data,
                avatar_url: toPublicUrl(AVATAR_BUCKET, data.avatar_url),
              }
            : null;
          if (a) PROFILE_CACHE.set(post.user_id, a);
          return a;
        })().finally(() => PENDING.delete(post.user_id))
      );
    }

    PENDING.get(post.user_id).then((a) => {
      if (!alive) return;
      if (a) setAuthor(a);
    });

    return () => {
      alive = false;
    };
  }, [post.user_id, post.profiles, toPublicUrl]);

  const isOwner = me?.id === post.user_id;

  useEffect(() => {
    setLikeCount(post.like_count ?? 0);
    setCommentCount(post.comment_count ?? 0);
    if (!editing) setEditText(post.caption_html || "");
  }, [post.like_count, post.comment_count, post.caption_html, editing]);

  // ----- Like check -----
  const likeKey = useMemo(() => (me ? { post_id: post.id, user_id: me.id } : null), [me, post.id]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!likeKey) return setLiked(false);
      const { data, error } = await supabase
        .from("likes")
        .select("post_id")
        .eq("post_id", likeKey.post_id)
        .eq("user_id", likeKey.user_id)
        .maybeSingle();
      if (!alive) return;
      if (error) console.warn("like check:", error.message);
      setLiked(Boolean(data));
    })();
    return () => { alive = false; };
  }, [likeKey]);

  // ----- Save check -----
  const saveKey = useMemo(() => (me ? { post_id: post.id, user_id: me.id } : null), [me, post.id]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!saveKey) return setSaved(false);
      const { data, error } = await supabase
        .from("saves")
        .select("post_id")
        .eq("post_id", saveKey.post_id)
        .eq("user_id", saveKey.user_id)
        .maybeSingle();
      if (!alive) return;
      if (error) console.warn("save check:", error.message);
      setSaved(Boolean(data));
    })();
    return () => { alive = false; };
  }, [saveKey]);

  // follow state
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!me?.id || !post.user_id || me.id === post.user_id) {
        setIsFollowing(false);
        return;
      }
      const { data, error } = await supabase
        .from("follows")
        .select("follower_id")
        .eq("follower_id", me.id)
        .eq("following_id", post.user_id)
        .maybeSingle();
      if (!alive) return;
      if (error) console.warn("follow check:", error.message);
      setIsFollowing(Boolean(data));
    })();
    return () => { alive = false; };
  }, [me?.id, post.user_id]);

  // COMMENTS: load & realtime only when panel is open
  const loadAllComments = useCallback(async () => {
    const { data, error } = await supabase
      .from("comments")
      .select(
        `id, post_id, user_id, text, created_at,
         profiles:profiles!comments_user_id_fkey(full_name, avatar_url)`
      )
      .eq("post_id", post.id)
      .order("created_at", { ascending: true });

    if (error) {
      console.warn("comments load:", error.message);
      setComments([]);
      return;
    }

    const withUrls = (data || []).map((c) => ({
      ...c,
      profiles: c.profiles
        ? {
            ...c.profiles,
            avatar_url: toPublicUrl(AVATAR_BUCKET, c.profiles.avatar_url),
          }
        : null,
    }));

    setComments(withUrls);
  }, [post.id, toPublicUrl]);

  useEffect(() => {
    let mounted = true;

    if (!showComments) return;

    // initial load
    loadAllComments();

    // realtime INSERTs for this post
    const ch = supabase
      .channel(`comments-live-${post.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "comments", filter: `post_id=eq.${post.id}` },
        async (payload) => {
          if (!mounted) return;
          try {
            const uid = payload.new.user_id;
            const { data: prof } = await supabase
              .from("profiles")
              .select("full_name, avatar_url")
              .eq("id", uid)
              .maybeSingle();

            const row = {
              ...payload.new,
              profiles: prof
                ? {
                    ...prof,
                    avatar_url: toPublicUrl(AVATAR_BUCKET, prof.avatar_url),
                  }
                : null,
            };

            setComments((prev) => [...prev, row]);
            setCommentCount((c) => c + 1);
          } catch (e) {
            console.warn("comment enrich:", e?.message || e);
          }
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      try { supabase.removeChannel(ch); } catch {}
    };
  }, [showComments, post.id, toPublicUrl, loadAllComments]);

  // realtime post updates → sync local
  useEffect(() => {
    const ch = supabase
      .channel(`post-${post.id}-updates`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "posts", filter: `id=eq.${post.id}` },
        ({ new: row }) => setCur((prev) => ({ ...prev, ...row }))
      )
      .subscribe();
    return () => { try { supabase.removeChannel(ch); } catch {} };
  }, [post.id]);

  // like toggle
  const toggleLike = async () => {
    if (!me) return alert("Login required");
    if (likeBusy) return;
    setLikeBusy(true);
    try {
      if (liked) {
        await supabase.from("likes").delete().eq("post_id", post.id).eq("user_id", me.id);
        setLiked(false);
        setLikeCount((c) => Math.max(c - 1, 0));
      } else {
        const { error } = await supabase.from("likes").insert({ post_id: post.id, user_id: me.id });
        if (error && !/duplicate|unique/i.test(String(error.message))) throw error;
        setLiked(true);
        setLikeCount((c) => c + 1);
      }
    } catch (e) {
      console.error(e);
      alert(e.message || "Failed to update like");
    } finally {
      setLikeBusy(false);
    }
  };

  // ✅ save toggle
  const toggleSave = async () => {
    if (!me) return alert("Login required");
    if (saveBusy) return;
    setSaveBusy(true);
    try {
      if (saved) {
        await supabase
          .from("saves")
          .delete()
          .eq("post_id", post.id)
          .eq("user_id", me.id);
        setSaved(false);
        window.dispatchEvent(new CustomEvent("ff:saved-changed", { detail: { postId: post.id, saved: false } }));
      } else {
        const { error } = await supabase
          .from("saves")
          .insert({ post_id: post.id, user_id: me.id });
        if (error && !/duplicate|unique/i.test(String(error.message))) throw error;
        setSaved(true);
        window.dispatchEvent(new CustomEvent("ff:saved-changed", { detail: { postId: post.id, saved: true } }));
      }
    } catch (e) {
      console.error(e);
      alert(e.message || "Failed to update save");
    } finally {
      setSaveBusy(false);
    }
  };

  // follow toggle
  const toggleFollow = async () => {
    if (!me) return alert("Login required");
    if (followBusy || isOwner) return;
    setFollowBusy(true);
    try {
      if (isFollowing) {
        await supabase.from("follows").delete().eq("follower_id", me.id).eq("following_id", post.user_id);
        setIsFollowing(false);
      } else {
        const { error } = await supabase
          .from("follows")
          .insert({ follower_id: me.id, following_id: post.user_id });
        if (error && !/duplicate|unique/i.test(String(error.message))) throw error;
        setIsFollowing(true);
      }
    } catch (e) {
      console.error(e);
      alert(e.message || "Failed to update follow");
    } finally {
      setFollowBusy(false);
    }
  };

  // add comment
  const addComment = async (e) => {
    e.preventDefault();
    if (!me) return alert("Login required");
    const text = txt.trim();
    if (!text) return;
    try {
      const { error } = await supabase.from("comments").insert({
        post_id: post.id,
        user_id: me.id,
        text,
      });
      if (error) throw error;
      setTxt("");
      // Realtime handler adds the new comment and increments count
    } catch (e) {
      console.error(e);
      alert(e.message || "Failed to comment");
    }
  };

  // pick replacement media
  const onPickReplace = (e) => {
    const f = e.target.files?.[0] || null;
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/") && !f.type.startsWith("video/")) {
      return alert("Please choose an image or video.");
    }
    if (replacePreview) URL.revokeObjectURL(replacePreview);
    setReplaceFile(f);
    setReplacePreview(URL.createObjectURL(f));
    if (!editing) setEditing(true);
  };

  const uploadToBucket = async (file) => {
    const ext = (file.name.split(".").pop() || "bin").toLowerCase();
    const path = `${post.user_id}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, { upsert: false });
    if (upErr) throw upErr;
    const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
    return { url: data?.publicUrl || "", path };
  };

  // save edits (caption + media)
  const saveEdit = async () => {
    if (editBusy) return;
    setEditBusy(true);
    try {
      const patch = { caption_html: safeHtml((editText || "").trim()) };
      let newType = cur.type;

      if (replaceFile) {
        const { url, path } = await uploadToBucket(replaceFile);
        const pickedIsVideo = replaceFile.type.startsWith("video/");

        if (pickedIsVideo) {
          newType = "video";
          patch.video_url = url;
          patch.video_path = path;
          patch.image_url = null;
          patch.image_path = null;
        } else {
          newType = "image";
          patch.image_url = url;
          patch.image_path = path;
          patch.video_url = null;
          patch.video_path = null;
        }

        try {
          const oldPath = pickedIsVideo ? cur.video_path : cur.image_path;
          if (oldPath) await supabase.storage.from(IMAGE_BUCKET).remove([oldPath]);
        } catch {}
      } else if (!cur.image_url && !cur.video_url) {
        newType = "text";
      }

      patch.type = newType;

      const { error } = await supabase.from("posts").update(patch).eq("id", post.id);
      if (error) throw error;

      setCur((prev) => ({ ...prev, ...patch }));
      setEditing(false);
      setMenuOpen(false);
      if (replacePreview) URL.revokeObjectURL(replacePreview);
      setReplaceFile(null);
      setReplacePreview(null);
    } catch (e) {
      console.error(e);
      alert(e.message || "Failed to update post");
    } finally {
      setEditBusy(false);
    }
  };

  // delete
  const deletePost = async () => {
    if (!confirm("Delete this post?")) return;
    try {
      if (cur.image_path) await supabase.storage.from(IMAGE_BUCKET).remove([cur.image_path]);
      if (cur.video_path) await supabase.storage.from(IMAGE_BUCKET).remove([cur.video_path]);
      const { error } = await supabase.from("posts").delete().eq("id", post.id);
      if (error) throw error;
      window.dispatchEvent(new CustomEvent("ff:post-deleted", { detail: post.id }));
    } catch (e) {
      console.error(e);
      alert(e.message || "Failed to delete post");
    }
  };

  // menu close on outside/Esc
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e) => { if (e.key === "Escape") setMenuOpen(false); };
    const onMouse = (e) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("keyup", onKey);
    document.addEventListener("mousedown", onMouse);
    return () => {
      document.removeEventListener("keyup", onKey);
      document.removeEventListener("mousedown", onMouse);
    };
  }, [menuOpen]);

  // display
  const displayName =
    post?.profiles?.full_name?.trim?.() ||
    author?.full_name?.trim?.() ||
    post?.profiles?.username?.trim?.() ||
    author?.username?.trim?.() ||
    "User";

  const avatarSrc = author?.avatar_url || "https://placehold.co/40x40?text=U";

  const createdAt = new Date(post.created_at);
  const niceTime = createdAt.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  // --------- MEDIA DECISION (robust) ----------
  const replacing = Boolean(replaceFile);
  const replaceIsVideo = replaceFile?.type?.startsWith("video/");
  const savedVideo = cur.video_url || (cur.video_path && toPublicUrl(IMAGE_BUCKET, cur.video_path)) || "";
  const savedImage = cur.image_url || (cur.image_path && toPublicUrl(IMAGE_BUCKET, cur.image_path)) || "";

  const savedShowVideo =
    cur.type === "video"
      ? true
      : cur.type === "image"
      ? false
      : !!(savedVideo && (isVideoByExt(savedVideo) || !savedImage));

  const shouldShowVideo = replacing ? !!replaceIsVideo : savedShowVideo;
  const mediaSrc = replacing
    ? replacePreview
    : shouldShowVideo
    ? savedVideo
    : savedImage;

  // cleanup object URL on unmount
  useEffect(() => {
    return () => {
      try { if (replacePreview) URL.revokeObjectURL(replacePreview); } catch {}
    };
  }, [replacePreview]);

  return (
    <div className="post-card">
      <div className="post-header">
        <Link to={`/u/${post.user_id}`} className="avatar-link" title={displayName}>
          <img
            src={avatarSrc}
            alt={displayName}
            className="avatar"
            loading="lazy"
            decoding="async"
            onError={(e) => (e.currentTarget.src = "https://placehold.co/40x40?text=U")}
          />
        </Link>

        <div className="post-user-info">
          <Link to={`/u/${post.user_id}`} className="username">{displayName}</Link>
          <small>{niceTime}</small>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {isOwner && editing && (
            <>
              <button className="btn-save" onClick={saveEdit} disabled={editBusy}>
                {editBusy ? "Saving…" : "Save changes"}
              </button>
              <button
                className="btn-cancel"
                onClick={() => {
                  setEditing(false);
                  setEditText(cur.caption_html || "");
                  if (replacePreview) URL.revokeObjectURL(replacePreview);
                  setReplaceFile(null);
                  setReplacePreview(null);
                }}
              >
                Cancel
              </button>
            </>
          )}

          {!isOwner && me && (
            <button
              className={`follow-btn ${isFollowing ? "active" : ""}`}
              onClick={toggleFollow}
              disabled={followBusy}
              title={isFollowing ? "Unfollow" : "Follow"}
            >
              {isFollowing ? "Following" : "+ Follow"}
            </button>
          )}

          {isOwner && (
            <div className="kebab-wrap" ref={menuRef}>
              <button
                className="kebab-btn"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((s) => !s)}
                title="Post options"
              >
                <FaEllipsisH />
              </button>

              {menuOpen && !editing && (
                <div className="dropdown-menu" role="menu">
                  <button role="menuitem" onClick={() => { setEditing(true); setMenuOpen(false); }}>
                    Edit caption
                  </button>
                  <label role="menuitem" className="file-item">
                    Replace media
                    <input type="file" accept="image/*,video/*" hidden onChange={(e)=>{ setMenuOpen(false); onPickReplace(e); }} />
                  </label>
                  <hr />
                  <button role="menuitem" className="danger" onClick={() => { setMenuOpen(false); deletePost(); }}>
                    Delete post
                  </button>
                </div>
              )}

              {menuOpen && editing && (
                <div className="dropdown-menu" role="menu">
                  <label role="menuitem" className="file-item">
                    Replace media
                    <input type="file" accept="image/*,video/*" hidden onChange={(e)=>{ setMenuOpen(false); onPickReplace(e); }} />
                  </label>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Caption */}
      {!editing ? (
        cur.caption_html ? (
          <div className="post-text" dangerouslySetInnerHTML={{ __html: safeHtml(cur.caption_html) }} />
        ) : null
      ) : (
        <div className="post-text" style={{ paddingTop: 0 }}>
          <ReactQuill
            theme="snow"
            value={editText}
            onChange={setEditText}
            modules={quillModules}
            formats={quillFormats}
            placeholder="Edit caption…"
            bounds={typeof document !== "undefined" ? document.body : undefined}
          />
          <div style={{ marginTop: 15 }}>
            <label className="btn-save" style={{ cursor: "pointer" }}>
              Edit image/video
              <input type="file" accept="image/*,video/*" hidden onChange={onPickReplace} />
            </label>
            {replacePreview && <small style={{ marginLeft: 8, opacity: 0.75 }}>{replaceFile?.name}</small>}
          </div>
        </div>
      )}

      {/* Media */}
      {mediaSrc && (
        shouldShowVideo ? (
          <video
            src={mediaSrc}
            controls
            className="post-media"
            style={{ width: "100%", borderRadius: 0, maxHeight: 520, objectFit: "contain", display: "block" }}
            preload="metadata"
            playsInline
            controlsList="nodownload noplaybackrate"
            onError={(e) => {
              console.warn("Video failed to load:", mediaSrc);
              e.currentTarget.style.display = "none";
            }}
            poster={cur.image_url || (cur.image_path && toPublicUrl(IMAGE_BUCKET, cur.image_path)) || undefined}
          />
        ) : (
          <img
            src={mediaSrc}
            alt="Post media"
            className="post-img"
            loading="lazy"
            decoding="async"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
        )
      )}

      {/* Actions */}
      <div className="post-actions">
        <button onClick={toggleLike} className={liked ? "active" : ""} disabled={likeBusy} aria-pressed={liked}>
          {liked ? <FaHeart style={{ color: "#ff4d6d", marginRight: 6 }} /> : <FaRegHeart style={{ marginRight: 6 }} />}
          {likeCount}
        </button>

        <button
          title="Comments"
          onClick={() => setShowComments((s) => !s)}
          aria-expanded={showComments}
          aria-controls={`comments-${post.id}`}
        >
          <FaRegCommentDots style={{ marginRight: 6, color: "#555" }} />
          {commentCount}
        </button>

        <button
          onClick={toggleSave}
          className={saved ? "active" : ""}
          disabled={saveBusy}
          aria-pressed={saved}
          title={saved ? "Unsave" : "Save"}
        >
          {saved
            ? <FaBookmark style={{ marginRight: 6, color: "#0a66c2" }} />
            : <FaRegBookmark style={{ marginRight: 6, color: "#555" }} />
          }
          {saved ? "Saved" : "Save"}
        </button>
      </div>

      {/* Comments panel (hidden by default) */}
      {showComments && (
        <div className="comments-card" id={`comments-${post.id}`}>
          <form className="comment-row" onSubmit={addComment}>
            <input
              className="comment-input"
              value={txt}
              onChange={(e) => setTxt(e.target.value)}
              placeholder="Add a comment…"
            />
            <button className="comment-send">Send</button>
          </form>

          {comments.length === 0 ? (
            <div className="no-comments">No comments yet. Be the first to comment!</div>
          ) : (
            <ul className="comments-list">
              {comments.map((c) => {
                const n = c.profiles?.full_name?.trim?.() || (c.user_id ? c.user_id.slice(0, 6) + "…" : "User");
                const av = c.profiles?.avatar_url || "https://placehold.co/36x36?text=U";
                const t = new Date(c.created_at).toLocaleString(undefined, {
                  month: "short",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: true,
                });
                return (
                  <li key={c.id} className="comment-item">
                    <img className="c-avatar" src={av} alt={n} onError={(e)=> (e.currentTarget.src = "https://placehold.co/36x36?text=U")} />
                    <div className="c-body">
                      <div className="c-head">
                        <b className="c-name">{n}</b>
                        <span className="c-time">{t}</span>
                      </div>
                      <div className="c-text">{c.text}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <style>{`
        .post-text ul { list-style: disc; padding-left: 1.25rem; margin: .5rem 0; }
        .post-text ol { list-style: decimal; padding-left: 1.5rem; margin: .5rem 0; }

        /* Comments card */
        .comments-card{
          border:1px solid #eee;
          border-radius:0px;
          padding:10px;
          margin:8px 0 2px;
          background:#fafafa;
        }
        .no-comments{
          padding:8px 6px;
          color:#6b7280;
          font-size: 14px;
        }
        .comments-list{
          list-style:none; margin:8px 0 0; padding:0; display:flex; flex-direction:column; gap:8px;
        }
        .comment-item{ display:flex; gap:8px; align-items:flex-start; }
        .c-avatar{ width:30px; height:30px; border-radius:999px; object-fit:cover; background:#f2f2f2 }
        .c-body{ flex:1; min-width:0; }
        .c-head{ display:flex; align-items:center; gap:8px; }
        .c-name { font-weight: 600; font-size: 12px; }
        .c-time{ color:#6b7280; font-size:10px; }
        .c-text { margin-top: 2px; white-space: pre-wrap; font-size: 12px; }

        .comment-row{
          display:flex; gap:8px; align-items:center;
          border-radius:10px; background:#fff; padding:6px; border:1px solid #e5e7eb;
        }
        .comment-input{
          flex:1; border:0; outline:none; font-size:14px; padding:6px 8px; border-radius:8px;
        }
        .comment-send{
          background:#0a66c2; color:#fff; border:0; border-radius:10px; padding:6px 12px; font-weight:600;
        }
      `}</style>
    </div>
  );
}
