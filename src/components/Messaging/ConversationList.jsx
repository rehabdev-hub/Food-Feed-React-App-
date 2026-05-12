import { useEffect, useMemo, useRef, useState } from "react";
import { useDeferredValue } from "react";
import { FaEllipsisV } from "react-icons/fa";

export default function ConversationList({
  me,
  conversations,
  loading,
  activeId,
  onSelect,
  onDeleteChat,
}) {
  const [menu, setMenu] = useState({ open: false, x: 0, y: 0, id: null });
  const menuRef = useRef(null);
  const [search, setSearch] = useState("");
const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    const close = (e) => {
      if (!menuRef.current || !menuRef.current.contains(e.target)) {
        setMenu((m) => ({ ...m, open: false }));
      }
    };
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, []);

  // ---- ONLY real conversations ----
  // 1) Keep groups as-is
  // 2) Keep DMs that have a real other_user.id
  // 3) De-duplicate DMs by other_user.id so the same person appears only once
const items = useMemo(() => {
  const seen = new Set();

  const filtered = (conversations || [])
    .filter((c) => c.is_group || (c.other_user && c.other_user.id))
    .filter((c) => {
      if (c.is_group) return true;

      const key = `u:${c.other_user.id}`;
      if (seen.has(key)) return false;

      seen.add(key);
      return true;
    });

  if (!deferredSearch.trim()) return filtered;

  return filtered.filter((c) => {
    const name = c.is_group
      ? c.title || "Group"
      : c.other_user?.full_name || "";

    return name.toLowerCase().includes(deferredSearch.toLowerCase());
  });

}, [conversations, deferredSearch]);

  return (
    <aside className="convo-list">
      <h4>Messages</h4>

      {!loading && items.length === 0 && (
  <div className="empty">No conversations yet.</div>
)}
      <div className="search-wrap">
  <input
    type="text"
    placeholder="Search conversations..."
    value={search}
    onChange={(e) => setSearch(e.target.value)}
    className="search-input"
  />
</div>

      <ul>
        {items.map((c) => {
          const isGroup = !!c.is_group;
          const name = isGroup
            ? c.title || "Group"
            : c.other_user?.full_name || ""; // we filtered out fakes, so this should exist

          // avatar: real user's avatar if DM, simple fallback otherwise
          const avatar =
            (isGroup
              ? "https://i.pravatar.cc/64?u=group"
              : c.other_user?.avatar_url) || "https://i.pravatar.cc/64?u=fallback";

          const preview = c.last?.body
            ? c.last.body.length > 40
              ? c.last.body.slice(0, 40) + "…"
              : c.last.body
            : "Chat";

          return (
            <li
              key={c.id}
              className={c.id === activeId ? "row active" : "row"}
             onClick={() => {
  if (c.id !== activeId) {
    onSelect?.(c.id);
  }
}}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ open: true, x: e.clientX, y: e.clientY, id: c.id });
              }}
              title={name}
            >
              <img
                className="avatar"
                src={avatar}
                alt={name}
                onError={(e) => {
                  e.currentTarget.src = "https://i.pravatar.cc/64?u=fallback";
                }}
              />
              <div className="meta">
                <div className="name">{name}</div>
                <div className="preview">{preview}</div>
              </div>
              <button
  className="chat-options"
  onClick={(e) => {
    e.stopPropagation();

    setMenu({
      open: true,
      x: e.clientX,
      y: e.clientY,
      id: c.id,
    });
  }}
>
  <FaEllipsisV />
</button>
            </li>
          );
        })}
      </ul>

      {menu.open && (
        <div
          className="ctx"
          ref={menuRef}
          style={{ top: menu.y, left: menu.x }}
        >
          <button
            onClick={() => {
              onDeleteChat?.(menu.id);
              setMenu((m) => ({ ...m, open: false }));
            }}
          >
            Delete chat
          </button>
          <button onClick={() => setMenu((m) => ({ ...m, open: false }))}>
            Cancel
          </button>
        </div>
      )}

      <style>{`
      .search-wrap{
  padding: 0 8px 12px;
}

.search-input{
  width: 100%;
  height: 42px;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  padding: 0 14px;
  font-size: 14px;
  outline: none;
  background: #f8fafc;
  transition: 0.2s;
}

.search-input:focus{
  border-color: #3b82f6;
  background: #fff;
}

.row{
  transition: background .18s ease;
}
        .convo-list{ padding:10px; border-right:1px solid #eee; overflow:auto; position:relative }
        .convo-list h4{ margin:8px 8px 12px; font-weight:700 }
        .empty{ padding:16px; color:#6b7280 }
        ul{ list-style:none; padding:0; margin:0 }

        .row{
          display:flex; gap:10px; padding:10px;
          border-radius:10px; cursor:pointer; align-items:center;
        }
        .row:hover{ background:#f7f7f7 }
        .row.active{ background:#eef5ff }

        .avatar{
          width:40px; height:40px; border-radius:999px;
          object-fit:cover; background:#f2f2f2;
        }
        .meta{ min-width:0; flex:1 1 auto }
        .name{
          font-weight:700; font-size:14px; color:#000;
          white-space:nowrap; overflow:hidden; text-overflow:ellipsis
        }
        .preview{
          color:#6b7280; font-size:12px;
          white-space:nowrap; overflow:hidden; text-overflow:ellipsis
        }

        .ctx{
          position: fixed; z-index: 50; background:#fff; border:1px solid #e5e7eb;
          border-radius:10px; padding:6px; box-shadow:0 8px 30px rgba(0,0,0,.08);
          display:flex; flex-direction:column; min-width:140px;
        }
        .ctx button{
          text-align:left; background:none; border:none; padding:8px 10px;
          border-radius:8px; cursor:pointer;
        }
        .ctx button:hover{ background:#f6f7f9 }
        .chat-options{
  width:32px;
  height:32px;
  border:none;
  background:none;
  border-radius:8px;
  cursor:pointer;
  opacity:0;
  transition:.2s;
}

.row:hover .chat-options{
  opacity:1;
}

.chat-options:hover{
  background:#f3f4f6;
}
      `}</style>
    </aside>
  );
}
