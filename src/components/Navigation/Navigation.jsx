import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import {
 FaHome,
  FaSearch,
  FaHandshake,
  FaCommentDots,
  FaBell,
  FaUser,
  FaSignOutAlt,
  FaBars
} from "react-icons/fa";
import supabase from "../../supabaseClient";
import "../Search/SearchPanel.css";
import SearchPanel from "../Search/SearchPanel";
import "./Navigation.css";

const AVATAR_BUCKET = "avatars";

function Navigation() {
  const { user, logout } = useAuth();
  const location = useLocation();

  const [showMenu, setShowMenu] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const menuRef = useRef(null);
  const triggerRef = useRef(null);

  const [fullName, setFullName] = useState("");
  const [avatarPath, setAvatarPath] = useState("");

  const [notifUnread, setNotifUnread] = useState(0);
  const [msgUnread, setMsgUnread] = useState(0);
  const [myConversationIds, setMyConversationIds] = useState([]);

  /* ------------------ Avatar helpers ------------------ */
  const toPublicUrl = (value) => {
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(value);
    return data?.publicUrl || "";
  };
  const cacheBust = (url) => {
    if (!url) return "";
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}cb=${Date.now()}`;
  };
  const avatarUrl = useMemo(() => cacheBust(toPublicUrl(avatarPath)), [avatarPath]);

  /* ------------------ Load my profile ------------------ */
  useEffect(() => {
    let on = true;
    async function loadProfile() {
      if (!user?.id) {
        setFullName("");
        setAvatarPath("");
        return;
      }
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name, avatar_url")
        .eq("id", user.id)
        .maybeSingle();
      if (!on) return;
      if (!error) {
        setFullName(data?.full_name || "");
        setAvatarPath(data?.avatar_url || "");
      }
    }
    loadProfile();

    const ch =
      user?.id &&
      supabase
        .channel(`profiles-${user.id}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${user.id}` },
          (payload) => {
            const p = payload.new || {};
            if (typeof p.full_name === "string") setFullName(p.full_name);
            if (typeof p.avatar_url === "string") setAvatarPath(p.avatar_url);
          }
        )
        .subscribe();

    return () => {
      on = false;
      if (ch) supabase.removeChannel(ch);
    };
  }, [user?.id]);

  /* ------------------ Close profile menu on outside / Esc / route change ------------------ */
  useEffect(() => {
    if (!showMenu) return;

    const onDocClick = (e) => {
      const menuEl = menuRef.current;
      const trigEl = triggerRef.current;
      if (!menuEl || !trigEl) return;
      if (!menuEl.contains(e.target) && !trigEl.contains(e.target)) setShowMenu(false);
    };
    const onKey = (e) => e.key === "Escape" && setShowMenu(false);

    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("touchstart", onDocClick, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("touchstart", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [showMenu]);

  useEffect(() => setShowMenu(false), [location.pathname]);

  /* ------------------ Helpers: fetch exact counts ------------------ */
  const fetchNotifUnread = async (uid) => {
    if (!uid) return 0;
    const { count, error } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", uid)
      .is("read_at", null);
    if (error) return 0;
    return count || 0;
  };

  const fetchMsgUnread = async (uid) => {
    if (!uid) return 0;
    const { data, error } = await supabase.rpc("unread_message_count", { uid });
    if (error) {
      console.warn("unread_message_count error:", error.message);
      return 0;
    }
    return data || 0;
  };

  const refreshNotifBadge = async () => {
    if (!user?.id) return setNotifUnread(0);
    setNotifUnread(await fetchNotifUnread(user.id));
  };

  const refreshMsgBadge = async () => {
    if (!user?.id) return setMsgUnread(0);
    setMsgUnread(await fetchMsgUnread(user.id));
  };

  /* ------------------ Notifications badge (server-truth) ------------------ */
  useEffect(() => {
    if (!user?.id) {
      setNotifUnread(0);
      return;
    }
    let mounted = true;

    refreshNotifBadge();

    const ch = supabase
      .channel(`notif-badge-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => {
          // Always recompute from DB to avoid drift
          if (mounted) refreshNotifBadge();
        }
      )
      .subscribe();

    const onFocus = () => mounted && refreshNotifBadge();
    window.addEventListener("focus", onFocus);

    return () => {
      mounted = false;
      supabase.removeChannel(ch);
      window.removeEventListener("focus", onFocus);
    };
  }, [user?.id]);

  // When opening notifications page, zero it visually, then confirm from DB
  useEffect(() => {
    if (!user?.id) return;
    if (location.pathname.toLowerCase() === "/notification") {
      setNotifUnread(0);
      const t = setTimeout(() => refreshNotifBadge(), 500);
      return () => clearTimeout(t);
    }
  }, [location.pathname, user?.id]);

  /* ------------------ Messages: my conversation ids ------------------ */
  useEffect(() => {
    let on = true;
    async function loadMyConvIds() {
      if (!user?.id) {
        setMyConversationIds([]);
        return;
      }
      const { data, error } = await supabase
        .from("conversation_participants")
        .select("conversation_id")
        .eq("user_id", user.id);
      if (!on) return;
      if (!error) setMyConversationIds((data || []).map((d) => d.conversation_id));
    }
    loadMyConvIds();
    return () => {
      on = false;
    };
  }, [user?.id]);

  /* ------------------ Messages badge (server-truth) ------------------ */
  useEffect(() => {
    if (!user?.id) {
      setMsgUnread(0);
      return;
    }
    let mounted = true;

    refreshMsgBadge();

    const subs = [];

    // 1) New messages in my conversations -> recompute
    if (myConversationIds.length > 0) {
      // NOTE: if convo list is very large, Supabase filter string could be long.
      // For robustness, we split in chunks of ~50 ids.
      const CHUNK = 50;
      for (let i = 0; i < myConversationIds.length; i += CHUNK) {
        const chunk = myConversationIds.slice(i, i + CHUNK);
        const inList = chunk.join(",");
        const filter = `conversation_id=in.(${inList})`;

        const ch = supabase
          .channel(`msg-badge-ins-${user.id}-${i / CHUNK}`)
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "messages", filter },
            () => {
              if (!mounted) return;
              // Always recompute from DB
              refreshMsgBadge();
            }
          )
          .subscribe();
        subs.push(ch);
      }
    }

    // 2) My read markers change -> recompute (user opened/read messages)
    const chReads = supabase
      .channel(`msg-badge-reads-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_reads", filter: `user_id=eq.${user.id}` },
        () => {
          if (!mounted) return;
          refreshMsgBadge();
        }
      )
      .subscribe();
    subs.push(chReads);

    // 3) Focus -> recompute
    const onFocus = () => mounted && refreshMsgBadge();
    window.addEventListener("focus", onFocus);

    return () => {
      mounted = false;
      subs.forEach((ch) => supabase.removeChannel(ch));
      window.removeEventListener("focus", onFocus);
    };
  }, [user?.id, myConversationIds]);

  // Entering /messages -> recompute once user has likely read
  useEffect(() => {
    if (!user?.id) return;
    if (location.pathname.toLowerCase() === "/messages") {
      setMsgUnread(0);
      const t = setTimeout(() => refreshMsgBadge(), 500);
      return () => clearTimeout(t);
    }
  }, [location.pathname, user?.id]);

  /* ------------------ Logout ------------------ */
  const handleLogout = async () => {
    try {
      await logout();
      window.location.href = "/login";
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const displayName =
    fullName ||
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    "Me";

  const avatar =
    avatarUrl ||
    user?.user_metadata?.avatar_url ||
    "https://placehold.co/40x40?text=U";

return (
  <div className={`navsidebar ${expanded ? "expanded" : ""}`}>

    {/* TOP */}
    <div className="sidebar-top">
      <div className="logo">F</div>

      <div className="icon-item" onClick={() => setSearchOpen(true)}>
        <FaSearch />
        <span className="tooltip">Search</span>
      </div>
    </div>

    {/* MENU */}
    <div className="sidebar-menu">

      <Link to="/" className="icon-item">
        <FaHome />
        <span className="label">Home</span>
        <span className="tooltip">Home</span>
      </Link>

      <Link to="/Recommendations" className="icon-item">
        <FaHandshake />
        <span className="label">Find Vendors</span>
        <span className="tooltip">Find Vendors</span>
      </Link>

      <Link to="/messages" className="icon-item">
        <FaCommentDots />
        {msgUnread > 0 && <span className="badge">{msgUnread}</span>}
        <span className="label">Messages</span>
        <span className="tooltip">Messages</span>
      </Link>

      <Link to="/Notification" className="icon-item">
        <FaBell />
        {notifUnread > 0 && <span className="badge">{notifUnread}</span>}
        <span className="label">Notifications</span>
        <span className="tooltip">Notifications</span>
      </Link>

    </div>

    {/* PROFILE */}
    <div className="sidebar-bottom">

      <div className="icon-item profile-trigger" onClick={() => setShowMenu(!showMenu)}>
        <img src={avatar} className="avatar" />
        <span className="label">{displayName}</span>
        <span className="tooltip">Profile</span>
      </div>

      {showMenu && (
        <div className="profile-dropdown">
          <Link to="/profile" className="dropdown-item">
            <FaUser /> Profile
          </Link>
          <button onClick={handleLogout} className="dropdown-item logout">
            <FaSignOutAlt /> Logout
          </button>
        </div>
      )}


    {/* TOGGLE */}
    <div className="icon-item sidebar-toggle">
      <FaBars />  <span className="tooltip">More</span>
    </div>
    </div>



    <SearchPanel open={searchOpen} onClose={() => setSearchOpen(false)} />
  </div>
);
}

export default Navigation;
