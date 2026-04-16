"use client";

import { useEffect, useMemo, useState } from "react";
import supabase from "../supabaseClient";
import { v4 as uuid } from "uuid";
import ReactQuill from "react-quill-new"; // React 19 compatible fork
import "react-quill-new/dist/quill.snow.css"; // if this 404s, use: import "quill/dist/quill.snow.css";
import DOMPurify from "dompurify";
import StoriesBar from "./StoriesBar"; // ⬅️ NEW

const BUCKET = "post-images";        // image + video bucket
const AVATAR_BUCKET = "avatars";     // your avatars bucket
const MAX_SIZE = 50 * 1024 * 1024;   // allow videos up to 50MB

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
  "header", "bold", "italic", "underline", "strike",
  "list", "bullet", "link", "blockquote", "code-block",
];

const sanitizeHtml = (dirty) =>
  DOMPurify.sanitize(dirty || "", {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target", "rel"],
    ALLOWED_ATTR: ["href", "title", "target", "rel", "class", "style"],
  });

export default function CreatePost() {
  // auth + profile
  const [me, setMe] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [avatarPath, setAvatarPath] = useState("");  // raw DB value (path or URL)
  const [avatarUrl, setAvatarUrl] = useState("");    // resolved public URL (with cache-bust)
  const [profileType, setProfileType] = useState(""); // "seller" | "buyer" | ""

  // composer modal
  const [open, setOpen] = useState(false);
  const [posting, setPosting] = useState(false);

  // editor + media
  const [captionHtml, setCaptionHtml] = useState("");
  const [mediaFile, setMediaFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);

  // ---------- Helpers ----------
  const cacheBust = (url) => {
    if (!url) return "";
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}cb=${Date.now()}`;
  };

  const toPublicUrl = (bucket, value) => {
    if (!value) return "";
    const v = String(value).trim();
    if (/^https?:\/\//i.test(v)) return v;
    const { data } = supabase.storage.from(bucket).getPublicUrl(v);
    return data?.publicUrl || "";
  };

  const getPlainText = (html) => {
    const tmp = document.createElement("div");
    tmp.innerHTML = html || "";
    return (tmp.textContent || tmp.innerText || "").trim();
  };

  const isSeller = (profileType || "").toLowerCase() === "seller";

  // ---------- Load current user + avatar + profile_type ----------
  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const user = data?.user ?? null;
        if (!on) return;
        setMe(user || null);

        if (user?.id) {
          const { data: prof, error } = await supabase
            .from("profiles")
            .select("avatar_url, profile_type")
            .eq("id", user.id)
            .maybeSingle();

          if (!on) return;
          if (error) console.warn("profiles fetch error:", error.message);
          setAvatarPath(prof?.avatar_url || "");
          setProfileType(prof?.profile_type || "");
        }
      } finally {
        if (on) setAuthLoading(false);
      }
    })();

    return () => { on = false; };
  }, []);

  // Resolve avatarPath -> final URL (and bust cache)
  useEffect(() => {
    if (!avatarPath) { setAvatarUrl(""); return; }
    const url = toPublicUrl(AVATAR_BUCKET, avatarPath);
    setAvatarUrl(cacheBust(url));
  }, [avatarPath]);

  // Realtime: if my profile row updates (e.g., avatar/profile_type changed), refresh
  useEffect(() => {
    if (!me?.id) return;
    const ch = supabase
      .channel(`profiles-updates-${me.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${me.id}` },
        (payload) => {
          const nextAvatar = payload?.new?.avatar_url ?? "";
          const nextType = payload?.new?.profile_type ?? "";
          setAvatarPath(nextAvatar);
          setProfileType(nextType);
        }
      )
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [me?.id]);

  // ---------- Composer control (input only) ----------
  const openComposer = () => me && isSeller && setOpen(true); // only sellers can open
  const closeComposer = () => {
    setOpen(false);
    setCaptionHtml("");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setMediaFile(null);
  };

  // ---------- File picker (image or video) ----------
  const onPick = (e) => {
    const f = e.target.files?.[0] || null;
    e.target.value = "";
    if (!f) return;
    const isImage = f.type.startsWith("image/");
    const isVideo = f.type.startsWith("video/");
    if (!isImage && !isVideo) {
      alert("Only images or videos are allowed.");
      return;
    }
    if (f.size > MAX_SIZE) {
      alert("File is too large. Max 50MB.");
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setMediaFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  };

  // ---------- Upload & Post ----------
  async function uploadMedia(userId, file) {
    if (!file) return { url: null, path: null };
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    const name = `${uuid()}.${ext}`;
    const path = `${userId}/${name}`;

    const { error: upErr } = await supabase
      .storage
      .from(BUCKET)
      .upload(path, file, { cacheControl: "3600", upsert: false });

    if (upErr) {
      const msg = String(upErr.message || "").toLowerCase();
      if (msg.includes("bucket") && msg.includes("not found")) {
        throw new Error("Bucket not found. Create a public bucket named 'post-images' in Supabase Storage.");
      }
      throw upErr;
    }
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return { url: data?.publicUrl || "", path };
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!me) return alert("Please login first.");
    if (!isSeller) return alert("Posting is only allowed for seller profiles."); // hard guard
    if (posting) return;

    const htmlClean = sanitizeHtml(captionHtml);
    const plain = getPlainText(htmlClean);

    if (!plain && !mediaFile) {
      alert("Write something or attach a media file.");
      return;
    }

    try {
      setPosting(true);
      let media = { url: null, path: null };
      if (mediaFile) media = await uploadMedia(me.id, mediaFile);

      const isVid = mediaFile ? mediaFile.type.startsWith("video/") : false;

      const base = {
        user_id: me.id,
        caption_html: htmlClean // rich HTML if column exists
      };

      if (isVid) {
        base.type = "video";
        base.video_url = media.url;
        base.video_path = media.path;
      } else if (media.url) {
        base.type = "image";
        base.image_url = media.url;
        base.image_path = media.path;
      } else {
        base.type = "text";
      }

      let { error } = await supabase.from("posts").insert(base);
      if (error && /column .*caption_html.* does not exist/i.test(error.message || "")) {
        const { caption_html: _ignore, ...fallback } = base;
        ({ error } = await supabase.from("posts").insert(fallback));
      }
      if (error) throw error;

      closeComposer();
    } catch (err) {
      console.error(err);
      alert(err.message || "Failed to post");
    } finally {
      setPosting(false);
    }
  };

  const isVideoPreview = useMemo(
    () => (mediaFile ? mediaFile.type.startsWith("video/") : (previewUrl && /\.(mp4|webm|ogg)$/i.test(previewUrl))),
    [mediaFile, previewUrl]
  );

  // =========================
  // RENDER
  // =========================

  // While auth/profile loading → avoid flicker
  if (authLoading) {
    return <div style={{ height: 1 }} />;
  }

  // Not signed in → show login tip (if you want to keep a hint) OR hide completely
  if (!me) {
    return (
      <div className="create-post">
        <h2>Stories</h2>
        <StoriesBar me={me} />
        <div className="info" style={{ marginTop: 8 }}>
          You’re not signed in. Please <a href="/login">login</a> to post.
        </div>
      </div>
    );
  }

  // Buyer → hide composer entirely (return null), or show a subtle note.
  if (!isSeller) {
    // Option A (strict hide): return null;
    // return null;

    // Option B (subtle note): keep Stories but no composer
    return (
      <div className="create-post">
        <h2>Stories</h2>
        <StoriesBar me={me} />
        <div className="info" style={{ marginTop: 8 }}>
          Your account type is <b>Buyer</b>. Posting is available for <b>Seller</b> profiles only.
        </div>
      </div>
    );
  }

  // Seller → full composer
  return (
    <div className="create-post">
              <h2 className="create-post-title">Stories</h2>
      {/* Stories bar appears above the composer */}
      <StoriesBar me={me} />

      {/* top row — ONLY input opens the modal */}
      <div className="create-top">
         <img
                src={avatarUrl || "https://placehold.co/40x40?text=U"}
                alt="me"
                className="avatar"
                onError={(e) => (e.currentTarget.src = "https://placehold.co/40x40?text=U")}
                style={{ marginRight: 5, width: 46, height: 46, borderRadius: "50%", objectFit: "cover" }}
              />
        <input
          type="text"
          placeholder="Start a post"
          onFocus={openComposer}
          onClick={openComposer}
          readOnly
          style={{ cursor: "pointer" }}
        />
      </div>

      {/* modal composer */}
      {open && (
        <div
          className="cp-modal-overlay"
          onClick={(e) => {
            if (e.target.classList.contains("cp-modal-overlay")) closeComposer();
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            animation: "fadeIn 160ms ease",
          }}
        >
          <div
            className="cp-modal"
            style={{
              width: "min(680px, 92vw)",
              background: "#fff",
              borderRadius: 12,
              boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
              overflow: "hidden",
              transform: "translateY(12px)",
              animation: "slideUp 160ms ease forwards",
            }}
          >
            {/* header */}
            <div style={{ display: "flex", alignItems: "center", padding: 12, borderBottom: "1px solid #eee" }}>
              <img
                src={avatarUrl || "https://placehold.co/40x40?text=U"}
                alt="me"
                className="avatar"
                onError={(e) => (e.currentTarget.src = "https://placehold.co/40x40?text=U")}
                style={{ marginRight: 8, width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }}
              />
              <div style={{ flex: 1, fontWeight: 600 }}>Create post</div>
              <button
                onClick={closeComposer}
                className="cp-close"
                style={{ fontSize: 18, lineHeight: 1, padding: "6px 10px", borderRadius: 8 }}
              >
                ✖
              </button>
            </div>

            {/* editor + media + actions */}
            <form onSubmit={handleSubmit} className="create-form" style={{ padding: 12 }}>
              <ReactQuill
                theme="snow"
                value={captionHtml}
                onChange={setCaptionHtml}
                modules={quillModules}
                formats={quillFormats}
                placeholder="Write a caption… (bold, italic, links work)"
              />

              {/* media preview */}
              {previewUrl && (
                <div className="cp-preview" style={{ marginTop: 12 }}>
                  {isVideoPreview ? (
                    <video
                      src={previewUrl}
                      controls
                      preload="metadata"
                      style={{ width: "100%", maxHeight: 420, borderRadius: 12, display: "block", objectFit: "contain" }}
                    />
                  ) : (
                    <img
                      src={previewUrl}
                      alt="preview"
                      style={{ width: "100%", maxHeight: 420, borderRadius: 12, objectFit: "cover", display: "block" }}
                    />
                  )}
                  <button
                    type="button"
                    className="cp-remove"
                    onClick={() => { if (previewUrl) URL.revokeObjectURL(previewUrl); setPreviewUrl(null); setMediaFile(null); }}
                    style={{ marginTop: 8 }}
                  >
                    Remove
                  </button>
                </div>
              )}

              {/* actions */}
              <div className="create-actions" style={{ marginTop: 12, display: "flex", alignItems: "center" }}>
                <label className="cp-file" style={{ cursor: "pointer" }}>
                  <input type="file" accept="image/*,video/*" onChange={onPick} hidden />
                  📷/🎥 Media
                </label>

                <div className="cp-spacer" style={{ flex: 1 }} />

                <button
                  type="submit"
                  className="cp-post-btn"
                  disabled={posting || (!captionHtml && !mediaFile)}
                >
                  {posting ? "Posting…" : "Post"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* tiny inline keyframes so you don't need new CSS files */}
      <style>{`
        @keyframes fadeIn { from {opacity: 0} to {opacity: 1} }
        @keyframes slideUp { from {transform: translateY(12px)} to {transform: translateY(0)} }
        .ql-container { min-height: 100px; border-radius: 10px; }
        .ql-editor { min-height: 100px; }
        h2.create-post-title {
    font-size: 18px;
    font-weight: 600;
}
      `}</style>
    </div>
  );
}
