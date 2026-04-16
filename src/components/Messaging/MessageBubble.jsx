// src/components/Messaging/MessageBubble.jsx
import { useEffect, useRef, useState } from "react";
import { FaEllipsisV, FaTrash } from "react-icons/fa";
import supabase from "../../supabaseClient";

const ATTACH_BUCKET = "chat-attachments";
const AVATAR_BUCKET = "avatars";

const toPublicUrl = (value) => {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(value);
  return data?.publicUrl || "";
};

const isVideo = (u = "") =>
  /\.(mp4|webm|ogg|ogv|mov|m4v)$/i.test(String(u).split("?")[0]);

// Parse storage path from a public URL like:
// /storage/v1/object/public/<bucket>/<path...>
function storagePathFromPublicUrl(url) {
  const m = (url || "").match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
  if (!m) return null;
  const bucket = m[1];
  const path = decodeURIComponent(m[2]);
  return { bucket, path };
}

export default function MessageBubble({ me, msg, onDelete }) {
  const mine = msg.user_id === me?.id;
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef(null);

  // Close menu on outside click / Esc
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const handleDelete = async () => {
    if (!mine || !msg?.id || busy) return;
    if (!confirm("Delete this message?")) return;

    // optimistic remove (ChatWindow should return a rollback fn)
    const rollback = onDelete?.(msg);

    try {
      setBusy(true);

      // Try to remove attachment from storage (non-fatal if it fails)
      if (msg.attachment_url) {
        const info = storagePathFromPublicUrl(msg.attachment_url);
        if (info && info.bucket === ATTACH_BUCKET) {
          try {
            await supabase.storage.from(ATTACH_BUCKET).remove([info.path]);
          } catch (e) {
            // ignore storage cleanup errors
            console.warn("attachment remove skipped:", e?.message);
          }
        }
      }

      // Delete the message (sender-only)
      const { error } = await supabase
        .from("messages")
        .delete()
        .eq("id", msg.id)
        .eq("user_id", me.id);

      if (error) throw error;

      setMenuOpen(false);
    } catch (e) {
      console.error(e);
      alert(e.message || "Unable to delete message");
      // rollback optimistic removal
      rollback?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`bubble ${mine ? "mine" : ""}`}>
      <div className="content">
        {/* 3-dot menu (only mine, not for pending) */}
        {mine && !msg.pending && (
          <div className="bubble-actions" ref={menuRef}>
            <button
              className="bubble-menu-btn"
              aria-label="More"
              onClick={() => setMenuOpen((s) => !s)}
            >
              <FaEllipsisV />
            </button>

            {menuOpen && (
              <div className="bubble-menu">
                <button
                  className="bubble-menu-item danger"
                  onClick={handleDelete}
                  disabled={busy}
                >
                  <FaTrash /> {busy ? "Deleting…" : "Delete"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* text */}
        {msg.body_html ? (
          <div className="text" dangerouslySetInnerHTML={{ __html: msg.body_html }} />
        ) : msg.body ? (
          <div className="text">{msg.body}</div>
        ) : null}

        {/* attachment */}
        {msg.attachment_url &&
          (isVideo(msg.attachment_url) ? (
            <video
              src={msg.attachment_url}
              controls
              className="media"
              playsInline
              preload="metadata"
            />
          ) : (
            <img src={msg.attachment_url} alt="attachment" className="media" />
          ))}

        {/* time (keep exactly as your layout) */}
        <div className="meta">
          <span>
            {new Date(msg.created_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {msg.edited_at && <em> (edited)</em>}
        </div>
      </div>

      <style>{`
        .bubble{display:flex; margin:6px 0; justify-content:flex-start}
        .bubble.mine{justify-content:flex-end}

        .content{
          position:relative;
          max-width:min(70%, 560px);
          background:#fff; border:1px solid #eee; border-radius:12px; padding:8px 10px
        }
        .bubble.mine .content{background:#eaf3ff; border-color:#d5e7ff}

        .media{display:block; max-width:100%; border-radius:10px; margin-top:6px}

        .meta{
          font-size:12px; color:#6b7280; margin-top:4px; text-align:start;
          display:flex; flex-direction:column; justify-content:start;padding-right:20px;
        }

        /* --- menu styles --- */
        .bubble-actions {
    position: absolute;
    right: 0px;
    bottom: 6px;
}
        .bubble-menu-btn{
          background:transparent; border:0; padding:4px; line-height:1;
          border-radius:6px; cursor:pointer; color:#6b7280;
        }
        .bubble-menu-btn:hover{ background:rgba(0,0,0,.06); }

        .bubble-menu{
          position:absolute; right:0; top:28px; z-index:5;
          background:#fff; border:1px solid #e5e7eb; border-radius:10px;
          box-shadow:0 8px 24px rgba(0,0,0,.08);
          min-width:140px; padding:6px;
        }
        .bubble-menu-item{
          width:100%; display:flex; align-items:center; gap:8px;
          background:transparent; border:0; border-radius:8px;
          padding:8px 10px; cursor:pointer; font-size:13px; color:#111;
        }
        .bubble-menu-item:hover{ background:#f3f4f6; }
        .bubble-menu-item.danger{ color:#b42318; }
        .bubble-menu-item.danger:hover{ background:#ffe8e8; }
        .bubble-menu-item:disabled{ opacity:.6; cursor:default; }
      `}</style>
    </div>
  );
}
