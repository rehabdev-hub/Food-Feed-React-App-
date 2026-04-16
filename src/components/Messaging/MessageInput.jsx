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
        .input-wrap{display:flex; gap:8px; padding:10px; border-top:1px solid #eee; background:#fff}
        .text{flex:1;border:1px solid #e5e7eb;border-radius:5px;padding:5px 12px;font-size:12px;white-space:pre-wrap;line-height:1.45}
        button{background:#0a66c2; color:#fff; border:0; border-radius:10px; padding:0 16px}
        button:disabled{opacity:.6}
      `}</style>
    </div>
  );
}
