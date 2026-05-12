import { useRef, useState } from "react";
import supabase from "../../supabaseClient";

const ATTACH_BUCKET = "chat-attachments";

const toPublicUrl = (value) => {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  const { data } = supabase.storage.from(ATTACH_BUCKET).getPublicUrl(value);
  return data?.publicUrl || "";
};

export default function MessageInput({ me, conversationId, onSent }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState(null);
  const fileRef = useRef(null);

  const fireEvent = (name, detail) => {
    try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch {}
  };

  const send = async () => {
    if (busy || !me?.id || !conversationId) return;
    const body = text.trim();
    if (!body && !file) return;

    setBusy(true);
    let attachment_url = null;
    let attachment_type = null;

    // --- optimistic message (temp id) ---
    const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const optimistic = {
      id: tempId,
      conversation_id: conversationId,
      user_id: me.id,
      body: body || null,
      attachment_url: null,
      attachment_type: null,
      created_at: new Date().toISOString(),
      pending: true,
    };

    try {
      if (file) {
        const ext = (file.name.split(".").pop() || "bin").toLowerCase();
        const path = `${conversationId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from(ATTACH_BUCKET)
          .upload(path, file, { upsert: false });
        if (upErr) throw upErr;
        attachment_url = toPublicUrl(path);
        attachment_type = file.type.startsWith("video/")
          ? "video"
          : file.type.startsWith("image/")
          ? "image"
          : "file";
        optimistic.attachment_url = attachment_url;
        optimistic.attachment_type = attachment_type;
      }

      // Push optimistic to UI (both prop & event)
      onSent?.(optimistic);
      fireEvent("msg:optimistic", { message: optimistic });

      // Insert + return real row
      const { data, error } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          user_id: me.id,
          body: body || null,
          attachment_url,
          attachment_type,
        })
        .select("*")
        .single();
      if (error) throw error;

      // confirm -> replace temp in any listeners
      fireEvent("msg:confirm", { tempId, message: data });

      // clear input
      setText("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      console.error(e);
      alert(e.message || "Failed to send");
      // rollback optimistic
      fireEvent("msg:rollback", { tempId });
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="input-wrap">
      <input
        className="text"
        placeholder="Write a message…"
        value={text}
        onChange={(e)=>setText(e.target.value)}
        onKeyDown={onKey}
        disabled={busy}
      />
      <input
        type="file"
        ref={fileRef}
        onChange={(e)=>setFile(e.target.files?.[0] || null)}
        accept="image/*,video/*,.pdf,.doc,.docx,.zip"
        disabled={busy}
      />
      <button onClick={send} disabled={busy}>Send</button>

      <style>{`
     @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500&display=swap');

  .input-wrap {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: #ffffff;
    border-top: 1px solid #efefef;
    font-family: 'Inter', -apple-system, sans-serif;
  }

  .text {
    flex: 1;
    border: 1px solid #dbdbdb;
    border-radius: 22px;
    padding: 10px 18px;
    font-size: 14px;
    background: #fafafa;
    transition: border 0.2s ease-in-out;
    outline: none; /* Focus outline removed */
  }

  .text:focus {
    border-color: #a8a8a8;
  }

  .icon-btn {
    cursor: pointer;
    color: #262626;
    display: flex;
    align-items: center;
    transition: opacity 0.2s;
  }

  .icon-btn:hover {
    opacity: 0.7;
  }

  button {
    background: transparent;
    color: #0095f6;
    border: 0;
    font-weight: 600;
    font-size: 14px;
    cursor: pointer;
    padding: 4px 8px;
    transition: color 0.2s ease;
    outline: none;
  }

  button:hover {
    color: #00376b;
  }

  button:disabled {
    opacity: 0.3;
    cursor: default;
  }
       
      `}</style>
    </div>
  );
}
