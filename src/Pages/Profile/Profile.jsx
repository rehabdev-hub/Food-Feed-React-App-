// src/pages/Profile/Profile.jsx
import { useEffect, useMemo, useState, useCallback } from "react";
import { useLocation, useParams, useNavigate } from "react-router-dom";
import "./Profile.css";
import {
  FaUserCheck, FaEnvelope, FaRegBookmark, FaHeart, FaEye, FaShareAlt,
  FaFacebook, FaInstagram, FaTwitter, FaLinkedin, FaTrash, FaTimes, FaPlay
} from "react-icons/fa";
import supabase from "../../supabaseClient";
import { findOrCreateDirectConversation } from "../../lib/chat";

/* ----------------------------------
   Constants
---------------------------------- */
const AVATAR_BUCKET = "avatars";
const COVER_BUCKET = "covers";
const PRODUCT_BUCKET = "product-images";

/* ----------------------------------
   Tiny image carousel (module scope)
---------------------------------- */
function Carousel({ images = [] }) {
  const [idx, setIdx] = useState(0);
  const n = images.length || 0;
  if (n === 0) return null;
  return (
    <div className="mini-carousel">
      <div className="mini-carousel-main product-tab">
        <img src={images[idx]} alt={`img-${idx}`} />
        {n > 1 && (
          <>
            <button className="caro-btn left" onClick={() => setIdx((idx - 1 + n) % n)}>‹</button>
            <button className="caro-btn right" onClick={() => setIdx((idx + 1) % n)}>›</button>
          </>
        )}
      </div>
      {n > 1 && (
        <div className="mini-carousel-thumbs">
          {images.map((u, i) => (
            <img
              key={i}
              src={u}
              alt={`thumb-${i}`}
              className={i === idx ? "active" : ""}
              onClick={() => setIdx(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------
   Helpers (NO hooks inside)
---------------------------------- */
const isYouTube = (u) => /(?:youtube\.com\/watch\?v=|youtu\.be\/)/i.test(u || "");
const youTubeId = (u) => {
  if (!u) return null;
  const m1 = u.match(/v=([^&?#]+)/); if (m1) return m1[1];
  const m2 = u.match(/youtu\.be\/([^?&#/]+)/); if (m2) return m2[1];
  return null;
};
const ytThumb = (u) => {
  const id = youTubeId(u);
  return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null;
};
const ytEmbed = (u) => {
  const id = youTubeId(u);
  return id ? `https://www.youtube.com/embed/${id}?autoplay=1&mute=1&playsinline=1` : null;
};

const isVimeo = (u) => /vimeo\.com\/(\d+)/i.test(u || "");
const vimeoId = (u) => {
  const m = (u || "").match(/vimeo\.com\/(\d+)/i);
  return m ? m[1] : null;
};
const vimeoEmbed = (u) => {
  const id = vimeoId(u);
  return id ? `https://player.vimeo.com/video/${id}?autoplay=1&muted=1&playsinline=1` : null;
};

const isDirectVideo = (u) => /\.(mp4|webm|ogg)(\?.*)?$/i.test(u || "");
const isAnyVideoUrl = (u) => isDirectVideo(u) || isYouTube(u) || isVimeo(u);

/* ======================================================================
   Profile Component
   — all hooks are top-level & unconditional (contiguous block)
====================================================================== */
function Profile() {
  // ---- Routing & nav
  const { id: routeId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const qs = new URLSearchParams(location.search);
  const queryId = qs.get("id") || null;
  const paramId = routeId || queryId || null;

  // ---- UI state
  const [activeTab, setActiveTab] = useState("posts");

  // ---- Auth & profile ownership
  const [user, setUser] = useState(null);
  const [profileUserId, setProfileUserId] = useState(null);
  const [isSelf, setIsSelf] = useState(false);

  // ---- Profile data
  const [profile, setProfile] = useState({
    full_name: "", bio: "", location: "", website: "",
    avatar_url: "", cover_url: "", facebook: "", instagram: "", twitter: "", linkedin: "",
    profile_type: "",
  });
  const [email, setEmail] = useState("");

  // ---- Loading / flags
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");

  // ---- Posts & saves
  const [userPosts, setUserPosts] = useState([]);
  const [savedPosts, setSavedPosts] = useState([]);

  // ---- Follow relationship (viewer vs profile)
  const [isFollowing, setIsFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);

  // ---- Temp image picks
  const [tempAvatarFile, setTempAvatarFile] = useState(null);
  const [tempAvatarUrl, setTempAvatarUrl] = useState(null);
  const [tempCoverFile, setTempCoverFile] = useState(null);
  const [tempCoverUrl, setTempCoverUrl] = useState(null);

  // ---- Post modal
  const [selectedPost, setSelectedPost] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // ---- Followers/Following modal
  const [showUserList, setShowUserList] = useState(false);
  const [listType, setListType] = useState(null); // 'followers' | 'following'
  const [listLoading, setListLoading] = useState(false);
  const [listUsers, setListUsers] = useState([]); // [{id, full_name, avatar_url}]
  const [listBusyIds, setListBusyIds] = useState(new Set()); // busy per target id
  const [listFollowMap, setListFollowMap] = useState(new Map()); // userId -> am I following?

  // ---- Products
  const [products, setProducts] = useState([]);
  const [prodLoading, setProdLoading] = useState(false);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [adding, setAdding] = useState(false);
  const [prodForm, setProdForm] = useState({
    title: "",
    description: "",
    phone: "",
    direction_url: "",
    files: [],
    previews: [],
  });
  const [productDetail, setProductDetail] = useState(null);

  // ---- Memos & callbacks (safe)
  const totalLikes = useMemo(
    () => userPosts.reduce((s, p) => s + (p.like_count || 0), 0),
    [userPosts]
  );

  const toPublicUrl = useCallback((bucketName, value) => {
    if (!value) return value;
    if (/^https?:\/\//i.test(value)) return value;
    const { data } = supabase.storage.from(bucketName).getPublicUrl(value);
    return data?.publicUrl || value;
  }, []);

  const cacheBust = useCallback((url) => {
    if (!url) return url;
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}cb=${Date.now()}`;
  }, []);

  const normalizePost = useCallback((p) => {
    let image = p.image_url || p.image || p.cover || p.media_url || p.thumbnail_url || null;
    let video = p.video_url || p.video || p.media_video_url || p.external_video_url || null;
    const text =
      p.text_body || p.text || p.content || p.caption || p.description || p.caption_text || "";

    if (!video && image && isAnyVideoUrl(image)) {
      video = image;
      image = null;
    }
    const type = p.type || (video ? "video" : image ? "image" : "text");
    return { ...p, image_url: image, video_url: video, text_body: text, type };
  }, []);

  const loadSavedPosts = useCallback(async (uid) => {
    try {
      const { data: savesRows, error: sErr } = await supabase
        .from("saves")
        .select("post_id, created_at")
        .eq("user_id", uid)
        .order("created_at", { ascending: false });
      if (sErr) throw sErr;

      const ids = (savesRows || []).map((r) => r.post_id);
      if (ids.length === 0) { setSavedPosts([]); return; }

      const { data: postsRows, error: pErr } = await supabase
        .from("posts")
        .select("*")
        .in("id", ids);
      if (pErr) throw pErr;

      const byId = new Map((postsRows || []).map((p) => [p.id, p]));
      const ordered = ids.map((id) => byId.get(id)).filter(Boolean).map(normalizePost);
      setSavedPosts(ordered);
    } catch (e) {
      console.warn("loadSavedPosts:", e?.message || e);
      setSavedPosts([]);
    }
  }, [normalizePost]);

  /* ----------------------------------
     Effects
  ---------------------------------- */
  useEffect(() => {
    let on = true;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const me = auth?.user ?? null;
      if (!on) return;

      setUser(me);
      setEmail(me?.email || "");

      const targetId = paramId || me?.id || null;
      setProfileUserId(targetId);
      setIsSelf(Boolean(me?.id && targetId && me.id === targetId));
    })();
    return () => { on = false; };
  }, [paramId]);

  // force About tab when viewing self as buyer
  const isSellerSelf = isSelf && (profile?.profile_type || "").toLowerCase() === "seller";
  const canShowSellerSections = !isSelf || isSellerSelf;

  useEffect(() => {
    if (isSelf && !isSellerSelf && activeTab !== "about") setActiveTab("about");
  }, [isSelf, isSellerSelf, activeTab]);

  useEffect(() => {
    if (!profileUserId) return;
    let on = true;

    (async () => {
      setLoading(true);

      const { data: prof } = await supabase
        .from("profiles")
        .select("full_name, bio, location, website, avatar_url, cover_url, facebook, instagram, twitter, linkedin, profile_type")
        .eq("id", profileUserId)
        .maybeSingle();

      if (!on) return;

      const safe = {
        ...prof,
        avatar_url: toPublicUrl(AVATAR_BUCKET, prof?.avatar_url) || "",
        cover_url: toPublicUrl(COVER_BUCKET, prof?.cover_url) || "",
        profile_type: prof?.profile_type || "",
      };
      setProfile((p) => ({ ...p, ...(safe || {}) }));

      const { data: posts } = await supabase
        .from("posts")
        .select("*")
        .eq("user_id", profileUserId)
        .order("created_at", { ascending: false });

      setUserPosts((posts || []).map(normalizePost));

      const [{ count: folCount }, { count: ingCount }] = await Promise.all([
        supabase.from("follows").select("id", { count: "exact", head: true }).eq("following_id", profileUserId),
        supabase.from("follows").select("id", { count: "exact", head: true }).eq("follower_id", profileUserId),
      ]);
      setFollowersCount(folCount || 0);
      setFollowingCount(ingCount || 0);

      if (user?.id && user.id !== profileUserId) {
        const { data: rel } = await supabase
          .from("follows")
          .select("id")
          .eq("follower_id", user.id)
          .eq("following_id", profileUserId)
          .maybeSingle();
        setIsFollowing(Boolean(rel));
      } else {
        setIsFollowing(false);
      }

      setLoading(false);
    })();

    return () => { on = false; };
  }, [profileUserId, toPublicUrl, normalizePost, user?.id]);

  useEffect(() => {
    return () => {
      if (tempAvatarUrl) URL.revokeObjectURL(tempAvatarUrl);
      if (tempCoverUrl) URL.revokeObjectURL(tempCoverUrl);
    };
  }, [tempAvatarUrl, tempCoverUrl]);

  useEffect(() => {
    if (!profileUserId) return;
    loadSavedPosts(profileUserId);

    const ch = supabase
      .channel(`saves-live-${profileUserId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "saves", filter: `user_id=eq.${profileUserId}` },
        () => loadSavedPosts(profileUserId)
      )
      .subscribe();

    return () => {
      try { supabase.removeChannel(ch); } catch {}
    };
  }, [profileUserId, loadSavedPosts]);

  /* ----------------------------------
     Handlers (NO hooks inside)
  ---------------------------------- */
  const pickAvatar = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (tempAvatarUrl) URL.revokeObjectURL(tempAvatarUrl);
    setTempAvatarFile(file);
    setTempAvatarUrl(URL.createObjectURL(file));
  };
  const pickCover = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (tempCoverUrl) URL.revokeObjectURL(tempCoverUrl);
    setTempCoverFile(file);
    setTempCoverUrl(URL.createObjectURL(file));
  };

  const uploadToBucket = async (bucket, uid, file) => {
    const ext = file.name.split(".").pop();
    const path = `${uid}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from(bucket).upload(path, file, { upsert: false });
    if (upErr) throw upErr;
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return { path, publicUrl: data?.publicUrl || null };
  };

  const saveProfile = async (e) => {
    e.preventDefault();
    if (!isSelf || !user?.id || saving) return;

    try {
      setSaving(true); setMessage("");
      const patch = {
        full_name: profile.full_name?.trim() || null,
        bio: profile.bio?.trim() || null,
        location: profile.location?.trim() || null,
        website: profile.website?.trim() || null,
        facebook: profile.facebook?.trim() || null,
        instagram: profile.instagram?.trim() || null,
        twitter: profile.twitter?.trim() || null,
        linkedin: profile.linkedin?.trim() || null,
      };

      if (tempAvatarFile) {
        const { path } = await uploadToBucket(AVATAR_BUCKET, user.id, tempAvatarFile);
        patch.avatar_url = path;
      }
      if (tempCoverFile) {
        const { path } = await uploadToBucket(COVER_BUCKET, user.id, tempCoverFile);
        patch.cover_url = path;
      }

      const { data: prof } = await supabase
        .from("profiles")
        .update(patch)
        .eq("id", user.id)
        .select("full_name, bio, location, website, avatar_url, cover_url, facebook, instagram, twitter, linkedin, profile_type")
        .single();

      const safe = {
        ...prof,
        avatar_url: cacheBust(toPublicUrl(AVATAR_BUCKET, prof?.avatar_url)),
        cover_url: cacheBust(toPublicUrl(COVER_BUCKET, prof?.cover_url)),
        profile_type: prof?.profile_type || "",
      };
      setProfile(safe);

      if (email && email !== user.email) {
        const { error: e2 } = await supabase.auth.updateUser({ email });
        if (e2) throw e2;
        setMessage("Profile saved. Please confirm the email change via the link sent to your new address.");
      } else setMessage("Profile updated ✅");

      if (tempAvatarUrl) URL.revokeObjectURL(tempAvatarUrl);
      if (tempCoverUrl) URL.revokeObjectURL(tempCoverUrl);
      setTempAvatarUrl(null); setTempAvatarFile(null);
      setTempCoverUrl(null); setTempCoverFile(null);
      setEditing(false);
    } catch (er) { console.error(er); alert(er.message || "Failed to save"); }
    finally { setSaving(false); setTimeout(() => setMessage(""), 3000); }
  };

  const toggleFollow = async () => {
    if (!user?.id || !profileUserId || isSelf || followBusy) return;
    setFollowBusy(true);
    try {
      if (isFollowing) {
        await supabase.from("follows").delete().eq("follower_id", user.id).eq("following_id", profileUserId);
        setIsFollowing(false); setFollowersCount((c) => Math.max(c - 1, 0));
      } else {
        const { error } = await supabase.from("follows").insert({ follower_id: user.id, following_id: profileUserId });
        if (error && !String(error.message).includes("duplicate")) throw error;
        setIsFollowing(true); setFollowersCount((c) => c + 1);
      }
    } catch (e) { console.error(e); alert(e.message || "Unable to update follow"); }
    finally { setFollowBusy(false); }
  };

  const openUserList = useCallback(async (type) => {
    if (!profileUserId) return;
    setListType(type);
    setShowUserList(true);
    setListLoading(true);
    try {
      let ids = [];
      if (type === "followers") {
        const { data: rows, error } = await supabase
          .from("follows")
          .select("follower_id")
          .eq("following_id", profileUserId);
        if (error) throw error;
        ids = (rows || []).map(r => r.follower_id);
      } else {
        const { data: rows, error } = await supabase
          .from("follows")
          .select("following_id")
          .eq("follower_id", profileUserId);
        if (error) throw error;
        ids = (rows || []).map(r => r.following_id);
      }

      if (!ids.length) {
        setListUsers([]);
        setListFollowMap(new Map());
        return;
      }

      const { data: profs, error: pErr } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .in("id", ids);
      if (pErr) throw pErr;

      const byId = new Map((profs || []).map(p => [p.id, p]));
      const ordered = ids
        .map(id => byId.get(id))
        .filter(Boolean)
        .map(p => ({
          id: p.id,
          full_name: p.full_name || "User",
          avatar_url: toPublicUrl(AVATAR_BUCKET, p.avatar_url) || ""
        }));
      setListUsers(ordered);

      if (user?.id) {
        const { data: myFollows, error: fErr } = await supabase
          .from("follows")
          .select("following_id")
          .eq("follower_id", user.id)
          .in("following_id", ids);
        if (fErr) throw fErr;
        const followingIds = new Set((myFollows || []).map(r => r.following_id));
        const map = new Map();
        ids.forEach(uid => map.set(uid, followingIds.has(uid)));
        setListFollowMap(map);
      } else {
        setListFollowMap(new Map());
      }
    } catch (e) {
      console.error(e);
      setListUsers([]);
      setListFollowMap(new Map());
    } finally {
      setListLoading(false);
    }
  }, [profileUserId, toPublicUrl, user?.id]);

  const toggleFollowInList = useCallback(async (targetId) => {
    if (!user?.id) { alert("Login required"); return; }
    setListBusyIds(prev => { const next = new Set(prev); next.add(targetId); return next; });

    const amIFollowing = !!listFollowMap.get(targetId);
    // In "following" tab: always unfollow; in "followers": can only follow (we don't show unfollow there)
    const shouldUnfollow = (listType === "following");

    try {
      if (shouldUnfollow) {
        await supabase
          .from("follows")
          .delete()
          .eq("follower_id", user.id)
          .eq("following_id", targetId);

        setListFollowMap(prev => { const next = new Map(prev); next.set(targetId, false); return next; });
        setFollowingCount(c => Math.max(0, (c || 0) - 1));
        if (listType === "following") {
          setListUsers(arr => arr.filter(u => u.id !== targetId));
        }
      } else if (!amIFollowing) {
        const { error } = await supabase
          .from("follows")
          .insert({ follower_id: user.id, following_id: targetId });
        if (error && !String(error.message).includes("duplicate")) throw error;

        setListFollowMap(prev => { const next = new Map(prev); next.set(targetId, true); return next; });
        setFollowingCount(c => (c || 0) + 1);
      }
    } catch (e) {
      console.error(e);
      alert(shouldUnfollow ? "Unable to unfollow" : "Unable to follow");
    } finally {
      setListBusyIds(prev => { const next = new Set(prev); next.delete(targetId); return next; });
    }
  }, [user?.id, listFollowMap, listType]);

  const tryDeleteStorageFromPublicUrl = async (publicUrl) => {
    if (!publicUrl) return;
    try {
      const m = publicUrl.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
      if (m) {
        const bucket = m[1];
        const path = decodeURIComponent(m[2]);
        await supabase.storage.from(bucket).remove([path]);
      }
    } catch (e) { console.warn("Storage remove skipped:", e?.message); }
  };

  const deletePost = async (post) => {
    if (!isSelf || !user?.id || user.id !== post.user_id) return;
    if (!confirm("Delete this post? This cannot be undone.")) return;

    try {
      setDeleteBusy(true);
      if (post.image_url && !isDirectVideo(post.image_url)) await tryDeleteStorageFromPublicUrl(post.image_url);
      if (post.video_url && isDirectVideo(post.video_url)) await tryDeleteStorageFromPublicUrl(post.video_url);

      const { error } = await supabase.from("posts").delete().eq("id", post.id).eq("user_id", user.id);
      if (error) throw error;

      setUserPosts((arr) => arr.filter((x) => x.id !== post.id));
      setSelectedPost(null);
    } catch (e) { console.error(e); alert(e.message || "Unable to delete post"); }
    finally { setDeleteBusy(false); }
  };

  const handleMessageClick = async () => {
    try {
      if (!user?.id) { navigate("/login"); return; }
      if (!profileUserId) return;
      if (user.id === profileUserId) return;
      const convId = await findOrCreateDirectConversation(user.id, profileUserId);
      navigate(`/messages?c=${convId}`, { replace: false });
    } catch (e) {
      console.error(e);
      alert(e.message || "Unable to start chat");
    }
  };

  const uploadProductImages = async (uid, files) => {
    const paths = [];
    for (const file of files) {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from(PRODUCT_BUCKET).upload(path, file, { upsert: false });
      if (error) throw error;
      paths.push(path);
    }
    return paths;
  };

  const resetProdForm = () => {
    (prodForm.previews || []).forEach(url => URL.revokeObjectURL(url));
    setProdForm({ title: "", description: "", phone: "", direction_url: "", files: [], previews: [] });
  };

  const handleDeleteProduct = async (p) => {
    if (!isSelf || !user?.id || p.user_id !== user.id) return;
    if (!confirm("Delete this product?")) return;
    try {
      const paths = p.image_paths || [];
      if (paths.length) await supabase.storage.from(PRODUCT_BUCKET).remove(paths);
      const { error } = await supabase.from("products").delete().eq("id", p.id).eq("user_id", user.id);
      if (error) throw error;

      setProducts(arr => arr.filter(x => x.id !== p.id));
      if (productDetail?.id === p.id) setProductDetail(null);
    } catch (e) {
      console.error(e);
      alert(e.message || "Unable to delete product");
    }
  };

  /* ----------------------------------
     Early returns (after hooks)
  ---------------------------------- */
  if (loading) return <div className="profile-page" style={{ padding: 24 }}>Loading…</div>;
  if (!profileUserId) return <div className="profile-page" style={{ padding: 24 }}>User not found.</div>;

  /* ----------------------------------
     Derived data (no hooks)
  ---------------------------------- */
  const aboutData = [
    { id: 1, title: "👤 Bio", content: profile.bio || "Hi 👋 I'm a passionate food enthusiast who loves creating and sharing recipes with the world.", type: "text" },
    { id: 2, title: "📞 Contact", content: [ ...(isSelf ? [{ label: "Email", value: email || "", link: email ? `mailto:${email}` : null }] : []), { label: "Location", value: profile.location || "" }, { label: "Website", value: profile.website || "", link: profile.website || null }, ], type: "list" },
    { id: 3, title: "🌐 Social Media", content: [ profile.facebook ? { label: "Facebook", icon: <FaFacebook />, link: profile.facebook } : null, profile.instagram ? { label: "Instagram", icon: <FaInstagram />, link: profile.instagram } : null, profile.twitter ? { label: "Twitter", icon: <FaTwitter />, link: profile.twitter } : null, profile.linkedin ? { label: "LinkedIn", icon: <FaLinkedin />, link: profile.linkedin } : null, ].filter(Boolean), type: "social" },
  ];

  const renderPostThumb = (p) => {
    if ((p.video_url && isAnyVideoUrl(p.video_url)) || (p.image_url && isAnyVideoUrl(p.image_url))) {
      const u = p.video_url || p.image_url;
      if (isYouTube(u)) {
        const thumb = ytThumb(u);
        return (
          <div className="video-thumb">
            {thumb ? <img src={thumb} alt="video" /> : <div className="video-fallback" />}
            <span className="play-badge"><FaPlay /></span>
          </div>
        );
      }
      if (isVimeo(u)) {
        return (
          <div className="video-thumb">
            <div className="video-fallback" />
            <span className="play-badge"><FaPlay /></span>
          </div>
        );
      }
      if (isDirectVideo(u)) {
        return <video src={u} muted autoPlay loop playsInline preload="metadata" />;
      }
    }
    if (p.type === "text" && !p.image_url) {
      const preview = (p.text_body || "").slice(0, 140);
      return (
        <div className="text-thumb">
          <p>{preview}{(p.text_body || "").length > 140 ? "…" : ""}</p>
        </div>
      );
    }
    return <img src={p.image_url} alt="post" loading="lazy" />;
  };

  /* ----------------------------------
     JSX
  ---------------------------------- */
  return (
    <div className="profile-page">
      {/* Cover + Profile Info */}
      <div className="profile-header">
        <div
          className="cover-photo"
          style={(tempCoverUrl || profile.cover_url)
            ? { backgroundImage: `url(${tempCoverUrl || profile.cover_url})`, backgroundSize: "cover", backgroundPosition: "center" }
            : {}}
        />
        <div className="profile-info">
          <img
            src={tempAvatarUrl || profile.avatar_url || "https://randomuser.me/api/portraits/men/75.jpg"}
            alt="Profile"
            className="profile-pic"
          />
          {!editing ? (
            <>
              <h2>{profile.full_name || "Your Name"} <FaUserCheck className="verified" /></h2>
              <p>{profile.bio || "Food Enthusiast | Recipe Creator | Blogger"}</p>
            </>
          ) : (
            isSelf && (
              <form onSubmit={saveProfile} style={{ marginTop: 8 }}>
                <div className="about-card" style={{ padding: 16, marginBottom: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                    <div>
                      <label className="upload-btn" style={{ display: "inline-block", cursor: "pointer" }}>
                        Change Avatar
                        <input type="file" accept="image/*" hidden onChange={pickAvatar} />
                      </label>
                      {tempAvatarUrl && (
                        <div style={{ marginTop: 8 }}>
                          <img src={tempAvatarUrl} alt="avatar preview" style={{ width: 96, height: 96, borderRadius: "50%", objectFit: "cover" }} />
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="upload-btn" style={{ display: "inline-block", cursor: "pointer" }}>
                        Change Cover
                        <input type="file" accept="image/*" hidden onChange={pickCover} />
                      </label>
                      {tempCoverUrl && (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ width: "100%", height: 90, borderRadius: 10, backgroundImage: `url(${tempCoverUrl})`, backgroundSize: "cover", backgroundPosition: "center" }} />
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <label className="input-label">Full Name</label>
                      <input className="follow-btn" style={{ width: "100%" }} placeholder="Full name" value={profile.full_name || ""} onChange={(e) => setProfile((p) => ({ ...p, full_name: e.target.value }))} />
                    </div>
                    <div style={{ flex: 1, minWidth: 180 }}>
                      <label className="input-label">Email</label>
                      <input className="follow-btn" style={{ width: "100%" }} placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                    </div>
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <label className="input-label">Website</label>
                      <input className="msg-btn" style={{ width: "100%" }} placeholder="Website (https://...)" value={profile.website || ""} onChange={(e) => setProfile((p) => ({ ...p, website: e.target.value }))} />
                    </div>
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <label className="input-label">Bio</label>
                    <textarea className="msg-btn" style={{ display: "block", width: "100%" }} rows={3} placeholder="Bio" value={profile.bio || ""} onChange={(e) => setProfile((p) => ({ ...p, bio: e.target.value }))} />
                  </div>

                  <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                    {[
                      { key: "location", label: "Location" },
                      { key: "facebook", label: "Facebook URL" },
                      { key: "instagram", label: "Instagram URL" },
                      { key: "twitter", label: "Twitter URL" },
                      { key: "linkedin", label: "LinkedIn URL" },
                    ].map(({ key, label }) => (
                      <div key={key} style={{ flex: 1, minWidth: 160 }}>
                        <label className="input-label">{label}</label>
                        <input className="follow-btn" placeholder={label} value={profile[key] || ""} onChange={(e) => setProfile((p) => ({ ...p, [key]: e.target.value }))} style={{ width: "100%" }} />
                      </div>
                    ))}
                  </div>
                </div>
              </form>
            )
          )}

          <div className="profile-actions">
            {!editing ? (
              <>
                {isSelf ? (
                  <>
                    <button className="save-btn" onClick={() => setEditing(true)}>Edit Profile</button>
                    <button className="save-btn" disabled title="You can't message yourself"><FaEnvelope /> Message</button>
                  </>
                ) : (
                  <>
                    <button className="follow-btn" onClick={toggleFollow} disabled={followBusy}>{followBusy ? "Updating…" : isFollowing ? "Unfollow" : "Follow"}</button>
                    <button className="msg-btn" onClick={handleMessageClick}><FaEnvelope /> Message</button>
                  </>
                )}
              </>
            ) : (
              isSelf && (
                <>
                  <button className="save-btn" onClick={saveProfile} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
                  <button
                    className="msg-btn"
                    onClick={() => {
                      setEditing(false);
                      if (tempAvatarUrl) URL.revokeObjectURL(tempAvatarUrl);
                      if (tempCoverUrl) URL.revokeObjectURL(tempCoverUrl);
                      setTempAvatarFile(null); setTempAvatarUrl(null);
                      setTempCoverFile(null); setTempCoverUrl(null);
                    }}
                  >
                    Cancel
                  </button>
                </>
              )
            )}
          </div>

          {message && <div className="info" style={{ marginTop: 8 }}>{message}</div>}
        </div>
      </div>

      {/* Stats */}
      {canShowSellerSections && (
        <div className="profile-stats">
          <div><b>{userPosts.length}</b><span>Posts</span></div>
          <button className="stat-btn" onClick={() => openUserList("followers")} aria-label="View followers">
            <b>{followersCount}</b><span>Followers</span>
          </button>
          <button className="stat-btn" onClick={() => openUserList("following")} aria-label="View following">
            <b>{followingCount}</b><span>Following</span>
          </button>
          <div><b>{totalLikes}</b><span>Likes</span></div>
        </div>
      )}

      {/* Tabs */}
      <div className="profile-tabs">
        {canShowSellerSections ? (
          <>
            <button className={activeTab === "posts" ? "active" : ""} onClick={() => setActiveTab("posts")}>Posts</button>
            <button className={activeTab === "products" ? "active" : ""} onClick={() => setActiveTab("products")}>Products</button>
            <button className={activeTab === "saved" ? "active" : ""} onClick={() => setActiveTab("saved")}><FaRegBookmark /> Saved</button>
            <button className={activeTab === "about" ? "active" : ""} onClick={() => setActiveTab("about")}>About</button>
          </>
        ) : (
          <button className="active" disabled>About</button>
        )}
      </div>

      {/* Posts / Products / Saved / About */}
      <div className="profile-posts">
        {canShowSellerSections && activeTab === "posts" &&
          (userPosts.length ? userPosts : []).map((item) => (
            <div className="post-card" key={item.id} onClick={() => setSelectedPost(item)}>
              <div className="post-img-container">
                {renderPostThumb(item)}
                <div className="overlay">
                  <div className="overlay-actions">
                    <button onClick={(e) => e.stopPropagation()}><FaHeart /> {item.like_count || 0}</button>
                    <button onClick={(e) => e.stopPropagation()}><FaEye /> {item.comment_count || 0}</button>
                    <button onClick={(e) => e.stopPropagation()}><FaShareAlt /></button>
                  </div>
                </div>
              </div>
            </div>
          ))}

        {canShowSellerSections && activeTab === "products" && (
          <div className="products-wrap">
            {isSelf && isSellerSelf && (
              <div style={{ marginBottom: 12 }}>
                <button className="save-btn" onClick={() => setShowAddProduct(true)}>+ Add Product</button>
              </div>
            )}

            {prodLoading && <div className="s-empty">Loading products…</div>}
            {!prodLoading && products.length === 0 && <div className="s-empty">No products yet</div>}

            {!prodLoading && products.length > 0 && (
              <div className="product-grid">
                {products.map((p) => (
                  <div className="product-card" key={p.id} onClick={() => setProductDetail(p)}>
                    <div className="product-thumb">
                      {p.images?.length ? (
                        <img src={p.images[0]} alt={p.title} loading="lazy" />
                      ) : (
                        <div className="product-fallback" />
                      )}
                    </div>
                    <div className="product-meta">
                      <h4 className="product-title">{p.title}</h4>
                      {p.phone ? <div className="product-mini">📱 {p.phone}</div> : null}
                    </div>
                    {isSelf && (
                      <button
                        className="danger-btn small"
                        onClick={(e) => { e.stopPropagation(); handleDeleteProduct(p); }}
                        title="Delete product"
                      >
                        <FaTrash /> Delete
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {canShowSellerSections && activeTab === "saved" && (
          <>
            {savedPosts.length === 0 ? (
              <div className="s-empty">{isSelf ? "You haven’t saved any posts yet." : "No saved posts."}</div>
            ) : (
              (savedPosts || []).map((item) => (
                <div className="post-card" key={item.id} onClick={() => setSelectedPost(item)}>
                  <div className="post-img-container">
                    {renderPostThumb(item)}
                    <div className="overlay">
                      <div className="overlay-actions">
                        <button onClick={(e) => e.stopPropagation()}><FaHeart /> {item.like_count || 0}</button>
                        <button onClick={(e) => e.stopPropagation()}><FaEye /> {item.comment_count || 0}</button>
                        <button onClick={(e) => e.stopPropagation()}><FaShareAlt /></button>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {activeTab === "about" &&
          aboutData.map((section) => (
            <div className="about-card" key={section.id}>
              <h3>{section.title}</h3>
              {section.type === "text" && <p>{section.content}</p>}
              {section.type === "list" && (
                <ul>
                  {section.content.filter((i) => i.value).map((i, idx) => (
                    <li key={idx}>
                      {i.link ? <a href={i.link} target="_blank" rel="noreferrer">{i.label}: {i.value}</a> : `${i.label}: ${i.value}`}
                    </li>
                  ))}
                </ul>
              )}
              {section.type === "social" && section.content.length > 0 && (
                <div className="social-buttons">
                  {section.content.map((social, idx) => (
                    <a key={idx} href={social.link} target="_blank" rel="noreferrer" className="social-btn">
                      {social.icon} {social.label}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
      </div>

      {/* Post Viewer Modal */}
      {selectedPost && (
        <div className="modal-backdrop" onClick={() => setSelectedPost(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelectedPost(null)} aria-label="Close"><FaTimes /></button>

            {(selectedPost.video_url || (selectedPost.image_url && isAnyVideoUrl(selectedPost.image_url))) && (
              <>
                {(() => {
                  const u = selectedPost.video_url || selectedPost.image_url;
                  if (isYouTube(u)) {
                    return (
                      <div className="embed-wrap">
                        <iframe
                          src={ytEmbed(u)}
                          allow="autoplay; encrypted-media; picture-in-picture"
                          allowFullScreen
                          title="YouTube video"
                        />
                      </div>
                    );
                  }
                  if (isVimeo(u)) {
                    return (
                      <div className="embed-wrap">
                        <iframe
                          src={vimeoEmbed(u)}
                          allow="autoplay; fullscreen; picture-in-picture"
                          allowFullScreen
                          title="Vimeo video"
                        />
                      </div>
                    );
                  }
                  return (
                    <video
                      src={u}
                      controls
                      playsInline
                      preload="metadata"
                      style={{ display: "block", width: "100%", maxHeight: 520, borderRadius: 12, objectFit: "contain" }}
                    />
                  );
                })()}
              </>
            )}

            {selectedPost.image_url && !isAnyVideoUrl(selectedPost.image_url) && (
              <img src={selectedPost.image_url} alt="post" style={{ width: "100%", borderRadius: 12, marginTop: 12 }} />
            )}

            {(selectedPost.text_body || selectedPost.caption) && (
              <div className="text-post-full" style={{ marginTop: 12 }}>
                <p>{selectedPost.text_body || selectedPost.caption}</p>
              </div>
            )}

            <div className="modal-footer">
              <div className="counts">
                <span><FaHeart /> {selectedPost.like_count || 0}</span>
                <span><FaEye /> {selectedPost.comment_count || 0}</span>
              </div>

              {isSelf && user?.id === selectedPost.user_id && (
                <button className="danger-btn" onClick={() => deletePost(selectedPost)} disabled={deleteBusy} title="Delete post">
                  <FaTrash /> {deleteBusy ? "Deleting…" : "Delete"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Product Modal */}
      {showAddProduct && isSelf && isSellerSelf && (
        <div className="modal-backdrop" onClick={() => { setShowAddProduct(false); }}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowAddProduct(false)} aria-label="Close"><FaTimes /></button>
            <h3 style={{ marginBottom: 12 }}>Add Product</h3>

            <div className="about-card" style={{ padding: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
                <div>
                  <label className="input-label">Title</label>
                  <input
                    className="follow-btn"
                    style={{ width: "100%" }}
                    placeholder="Product title"
                    value={prodForm.title}
                    onChange={(e) => setProdForm(f => ({ ...f, title: e.target.value }))}
                  />
                </div>

                <div>
                  <label className="input-label">Description</label>
                  <textarea
                    className="msg-btn"
                    rows={4}
                    style={{ width: "100%", whiteSpace: "pre-wrap" }}
                    placeholder="Write product details..."
                    value={prodForm.description}
                    onChange={(e) => setProdForm(f => ({ ...f, description: e.target.value }))}
                  />
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <label className="input-label">Direction URL (Google Maps etc.)</label>
                    <input
                      className="msg-btn"
                      style={{ width: "100%" }}
                      placeholder="https://maps.google.com/…"
                      value={prodForm.direction_url}
                      onChange={(e) => setProdForm(f => ({ ...f, direction_url: e.target.value }))}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <label className="input-label">Phone (for Orders / WhatsApp)</label>
                    <input
                      className="follow-btn"
                      style={{ width: "100%" }}
                      placeholder="+92…"
                      value={prodForm.phone}
                      onChange={(e) => setProdForm(f => ({ ...f, phone: e.target.value }))}
                    />
                  </div>
                </div>

                <div>
                  <label className="upload-btn" style={{ display: "inline-block", cursor: "pointer" }}>
                    Select Images (multiple)
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      hidden
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        const previews = files.map(f => URL.createObjectURL(f));
                        (prodForm.previews || []).forEach(u => URL.revokeObjectURL(u));
                        setProdForm(f => ({ ...f, files, previews }));
                      }}
                    />
                  </label>
                  {prodForm.previews?.length > 0 && (
                    <div className="preview-row">
                      {prodForm.previews.map((src, i) => (
                        <div key={i} className="preview-item">
                          <img src={src} alt={`preview-${i}`} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button className="msg-btn" onClick={() => { resetProdForm(); setShowAddProduct(false); }}>
                    Cancel
                  </button>
                  <button
                    className="save-btn"
                    disabled={adding || !prodForm.title || prodForm.files.length === 0}
                    onClick={async () => {
                      if (!user?.id) { alert("Login required"); return; }
                      try {
                        setAdding(true);
                        const image_paths = await uploadProductImages(user.id, prodForm.files);
                        const { data, error } = await supabase
                          .from("products")
                          .insert({
                            user_id: user.id,
                            title: prodForm.title.trim(),
                            description_html: (prodForm.description || "").trim() || null,
                            phone: prodForm.phone?.trim() || null,
                            direction_url: prodForm.direction_url?.trim() || null,
                            image_paths,
                          })
                          .select("*")
                          .single();
                        if (error) throw error;

                        const newRow = {
                          ...data,
                          images: image_paths.map(p => toPublicUrl(PRODUCT_BUCKET, p)),
                        };
                        setProducts(arr => [newRow, ...arr]);

                        resetProdForm();
                        setShowAddProduct(false);
                      } catch (e) {
                        console.error(e);
                        alert(e.message || "Failed to add product");
                      } finally {
                        setAdding(false);
                      }
                    }}
                  >
                    {adding ? "Adding…" : "Add Product"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Followers/Following Modal */}
      {showUserList && (
        <div className="modal-backdrop" onClick={() => setShowUserList(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowUserList(false)} aria-label="Close"><FaTimes /></button>
            <h3 style={{ marginBottom: 12 }}>
              {listType === "followers" ? "Followers" : "Following"}
            </h3>

            {listLoading ? (
              <div className="s-empty">Loading…</div>
            ) : listUsers.length === 0 ? (
              <div className="s-empty">No {listType} found.</div>
            ) : (
              <ul className="userlist">
                {listUsers.map(u => {
                  const amIFollowing = !!listFollowMap.get(u.id);
                  const busy = listBusyIds.has(u.id);
                  const isMe = user?.id === u.id;

                  // Right-side action per row:
                  // - "Following" tab: always show Unfollow button
                  // - "Followers" tab: show Follow if not following; show a disabled "Following" badge if already following
                  let actionNode = null;
                  if (!isMe) {
                    if (listType === "following") {
                      actionNode = (
                        <button
                          className="danger-btn small"
                          disabled={busy || !user?.id}
                          onClick={(e) => { e.stopPropagation(); toggleFollowInList(u.id); }}
                          title="Unfollow"
                        >
                          {busy ? "…" : "Unfollow"}
                        </button>
                      );
                    } else {
                      actionNode = amIFollowing ? (
                        <span className="pill following" title="Already following">Following</span>
                      ) : (
                        <button
                          className="follow-btn small"
                          disabled={busy || !user?.id}
                          onClick={(e) => { e.stopPropagation(); toggleFollowInList(u.id); }}
                          title="Follow"
                        >
                          {busy ? "…" : "Follow"}
                        </button>
                      );
                    }
                  }

                  return (
                    <li
                      key={u.id}
                      className="user-row"
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
                      onClick={() => { setShowUserList(false); navigate(`/u/${u.id}`); }}
                    >
                      <div className="user-row-left" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <img
                          src={u.avatar_url || "https://i.pravatar.cc/96"}
                          alt={u.full_name}
                          className="user-avatar"
                          style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover" }}
                        />
                        <span className="user-name">{u.full_name}</span>
                      </div>

                      {/* Right-side action */}
                      <div onClick={(e) => e.stopPropagation()}>{actionNode}</div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export { Profile };
export default Profile;
