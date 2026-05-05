import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import supabase from "../../supabaseClient";
import { FaSearch } from "react-icons/fa";
import "./SearchPanel.css";

const AVATAR_BUCKET = "avatars";
const IMAGE_BUCKET  = "post-images";
const RECENT_KEY    = "ff_recent_searches";   // localStorage
const DEFAULT_AVATAR = "https://placehold.co/64x64?text=U";

const toPublicUrl = (bucket, value) => {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  const { data } = supabase.storage.from(bucket).getPublicUrl(value);
  return data?.publicUrl || "";
};

const useDebounced = (value, delay = 250) => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
};

export default function SearchPanel({ open, onClose }) {
  const nav = useNavigate();
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const [q, setQ] = useState("");
  const dq = useDebounced(q, 260);

  const [loading, setLoading] = useState(false);
  const [users, setUsers]   = useState([]);
  const [dishes, setDishes] = useState([]);
  const [recents, setRecents] = useState(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); }
    catch { return []; }
  });

  // close on outside / Esc
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) onClose?.();
    };
    document.addEventListener("keydown", onDown);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc, { passive: true });
    return () => {
      document.removeEventListener("keydown", onDown);
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
    };
  }, [open, onClose]);

  // auto focus
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
    else setQ("");
  }, [open]);

  // do search
  useEffect(() => {
    if (!open) return;
    let active = true;

    const run = async () => {
      setLoading(true);

      // 1) users (profiles)
      const u = dq.trim();
      const usersP = u
        ? supabase
            .from("profiles")
            .select("id, full_name, username, avatar_url")
            .or(`full_name.ilike.%${u}%,username.ilike.%${u}%`)
            .limit(6)
        : { data: [], error: null };

      // 2) dishes (posts with image; search caption)
      const dishesP = u
        ? supabase
            .from("posts")
            .select("id, image_url, image_path, caption_text, type")
            .ilike("caption_text", `%${u}%`)
            .order("created_at", { ascending: false })
            .limit(8)
        : { data: [], error: null };

      const [{ data: urows }, { data: prows }] = await Promise.all([usersP, dishesP]);

      if (!active) return;

      const mapUsers = (urows || []).map((u) => {
        const avatar = toPublicUrl(AVATAR_BUCKET, u.avatar_url) || DEFAULT_AVATAR;
        return {
          id: u.id,
          name: u.full_name || u.username || "User",
          handle: u.username ? `@${u.username}` : "",
          avatar,
        };
      });

      const mapDishes = (prows || [])
        .filter((p) => (p.type || "image") === "image")
        .map((p) => ({
          id: p.id,
          thumb:
            p.image_url ||
            (p.image_path ? toPublicUrl(IMAGE_BUCKET, p.image_path) : "") ||
            "https://placehold.co/96x64?text=Img",
        }));

      setUsers(mapUsers);
      setDishes(mapDishes);
      setLoading(false);
    };

    run();

    return () => {
      active = false;
    };
  }, [dq, open]);

  // ---- recents helpers ----
  const persistRecents = (next) => {
    setRecents(next);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch {}
  };

  const pushRecent = (entry) => {
    const next = [entry, ...recents.filter((r) => r.key !== entry.key)].slice(0, 6);
    persistRecents(next);
  };

  // If any saved recent users are missing avatar/handle, hydrate from DB
  useEffect(() => {
    if (!open) return;
    const missing = recents.filter(
      (r) => r.type === "user" && (!r.avatar || !r.handle)
    );
    if (missing.length === 0) return;

    const ids = [...new Set(missing.map((m) => m.id))].filter(Boolean);
    if (ids.length === 0) return;

    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, username, avatar_url")
        .in("id", ids);

      if (error || !data) return;

      const byId = new Map(
        data.map((p) => [
          p.id,
          {
            name: p.full_name || p.username || "User",
            handle: p.username ? `@${p.username}` : "",
            avatar: toPublicUrl(AVATAR_BUCKET, p.avatar_url) || DEFAULT_AVATAR,
          },
        ])
      );

      const updated = recents.map((r) => {
        if (r.type !== "user") return r;
        const h = byId.get(r.id);
        if (!h) return r;
        return {
          ...r,
          label: r.label || h.name,
          handle: r.handle || h.handle,
          avatar: r.avatar || h.avatar,
        };
      });

      persistRecents(updated);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]); // run when the panel opens

  const goToUser = (id, name, avatar, handle) => {
    pushRecent({
      key: `u:${id}`,
      type: "user",
      label: name,
      id,
      avatar: avatar || DEFAULT_AVATAR,
      handle: handle || "",
    });
    onClose?.();
    nav(`/u/${id}`);
  };

  const submitQuery = () => {
    const term = q.trim();
    if (!term) return;
    pushRecent({ key: `q:${term}`, type: "query", label: term });
    // navigate to a full search route if/when you add it
    onClose?.();
  };

  if (!open) return null;

  return (
    <div className="search-popover" ref={wrapRef}>
      <div className="search-row">
        <FaSearch className="s-icon" />
        <input
          ref={inputRef}
          className="s-input"
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submitQuery(); }}
        />
        <button className="s-go" onClick={submitQuery}>Go</button>
      </div>
{(recents.length > 0 || users.length > 0 || loading) && (
      <div className="s-sections">
        {/* Recent searches */}
        <div className="s-head">
          <span>Recent Searches</span>
          <button
            className="s-clear"
            onClick={() => { setRecents([]); localStorage.removeItem(RECENT_KEY); }}
          >
            Clear
          </button>
        </div>
        {recents.length === 0 ? (
          <div className="s-empty">No recent searches</div>
        ) : (
          <ul className="recent-list">
            {recents.map((r) =>
              r.type === "user" ? (
                <li
                  key={r.key}
                  className="recent-user"
                  onClick={() => goToUser(r.id, r.label, r.avatar, r.handle)}
                >
                  {/* avatar image for recent users */}
                  <img
                    src={r.avatar || DEFAULT_AVATAR}
                    alt=""
                    className="recent-avatar-img"
                  />
                  <div className="recent-meta">
                    <div className="recent-title">{r.label}</div>
                    <div className="recent-sub">
                      {r.handle || "@profile"}
                    </div>
                  </div>
                </li>
              ) : (
                <li
                  key={r.key}
                  className="recent-chip"
                  onClick={() => { setQ(r.label); }}
                >
                  {r.label}
                </li>
              )
            )}
          </ul>
        )}

        {/* Creators */}
        <div className="s-head" style={{ marginTop: 10 }}>
          <span>Creators</span>
        </div>
        {loading && <div className="s-empty">Searching…</div>}
        {!loading && users.length === 0 && <div className="s-empty">No creators found</div>}
        {!loading && users.length > 0 && (
          <ul className="user-list">
            {users.map((u) => (
              <li
                key={u.id}
                className="user-row"
                onClick={() => goToUser(u.id, u.name, u.avatar, u.handle)}
              >
                <img src={u.avatar} alt="" className="user-avatar" />
                <div className="user-meta">
                  <div className="user-name">{u.name}</div>
                  <div className="user-handle">{u.handle}</div>
                </div>
                <div className="user-caret">›</div>
              </li>
            ))}
          </ul>
        )}
      </div>
       )}
    </div>
  );
}
