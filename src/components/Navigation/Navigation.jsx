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
      <div className="logo">S</div>

      <div className="icon-item" onClick={() => setSearchOpen(true)}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M18.031 16.6168L22.3137 20.8995L20.8995 22.3137L16.6168 18.031C15.0769 19.263 13.124 20 11 20C6.032 20 2 15.968 2 11C2 6.032 6.032 2 11 2C15.968 2 20 6.032 20 11C20 13.124 19.263 15.0769 18.031 16.6168ZM16.0247 15.8748C17.2475 14.6146 18 12.8956 18 11C18 7.1325 14.8675 4 11 4C7.1325 4 4 7.1325 4 11C4 14.8675 7.1325 18 11 18C12.8956 18 14.6146 17.2475 15.8748 16.0247L16.0247 15.8748Z"></path></svg>
        <span className="tooltip">Search</span>
      </div>
    </div>

    {/* MENU */}
    <div className="sidebar-menu">

      <Link to="/" className="icon-item">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M19 21H5C4.44772 21 4 20.5523 4 20V11L1 11L11.3273 1.6115C11.7087 1.26475 12.2913 1.26475 12.6727 1.6115L23 11L20 11V20C20 20.5523 19.5523 21 19 21ZM13 19H18V9.15745L12 3.7029L6 9.15745V19H11V13H13V19Z"></path></svg>
        <span className="label">Home</span>
        <span className="tooltip">Home</span>
      </Link>

      <Link to="/Recommendations" className="icon-item">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M21 13V20C21 20.5523 20.5523 21 20 21H4C3.44772 21 3 20.5523 3 20V13H2V11L3 6H21L22 11V13H21ZM5 13V19H19V13H5ZM4.03961 11H19.9604L19.3604 8H4.63961L4.03961 11ZM6 14H14V17H6V14ZM3 3H21V5H3V3Z"></path></svg>
        <span className="label">Find Vendors</span>
        <span className="tooltip">Find Vendors</span>
      </Link>

      <Link to="/messages" className="icon-item">
       <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M20.7134 8.12811L20.4668 8.69379C20.2864 9.10792 19.7136 9.10792 19.5331 8.69379L19.2866 8.12811C18.8471 7.11947 18.0555 6.31641 17.0677 5.87708L16.308 5.53922C15.8973 5.35653 15.8973 4.75881 16.308 4.57612L17.0252 4.25714C18.0384 3.80651 18.8442 2.97373 19.2761 1.93083L19.5293 1.31953C19.7058 0.893489 20.2942 0.893489 20.4706 1.31953L20.7238 1.93083C21.1558 2.97373 21.9616 3.80651 22.9748 4.25714L23.6919 4.57612C24.1027 4.75881 24.1027 5.35653 23.6919 5.53922L22.9323 5.87708C21.9445 6.31641 21.1529 7.11947 20.7134 8.12811ZM10 3H14V5H10C6.68629 5 4 7.68629 4 11C4 14.61 6.46208 16.9656 12 19.4798V17H14C17.3137 17 20 14.3137 20 11H22C22 15.4183 18.4183 19 14 19V22.5C9 20.5 2 17.5 2 11C2 6.58172 5.58172 3 10 3Z"></path></svg>
        {msgUnread > 0 && <span className="badge">{msgUnread}</span>}
        <span className="label">Messages</span>
        <span className="tooltip">Messages</span>
      </Link>

      <Link to="/Notification" className="icon-item">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M20 17H22V19H2V17H4V10C4 5.58172 7.58172 2 12 2C16.4183 2 20 5.58172 20 10V17ZM18 17V10C18 6.68629 15.3137 4 12 4C8.68629 4 6 6.68629 6 10V17H18ZM9 21H15V23H9V21Z"></path></svg>
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
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3V5H3V3H12ZM16 19V21H3V19H16ZM22 11V13H3V11H22Z"></path></svg>  <span className="tooltip">More</span>
    </div>
    </div>



    <SearchPanel open={searchOpen} onClose={() => setSearchOpen(false)} />
  </div>
);
}

export default Navigation;
