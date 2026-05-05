// src/pages/Notification/Notification.jsx

import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import supabase from "../../supabaseClient";

import Notify from "../../components/Notify";

import { FaEye, FaChartBar } from "react-icons/fa";

const AVATAR_BUCKET = "avatars";
const COVER_BUCKET = "covers";

function Notification() {
  const { user } = useAuth();
  const navigate = useNavigate();

  /* --------------------- Helpers for public URLs --------------------- */
  const toPublicUrl = (bucket, value) => {
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value; // already a URL
    const { data } = supabase.storage.from(bucket).getPublicUrl(value);
    return data?.publicUrl || "";
  };
  const bust = (url) => {
    if (!url) return "";
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}cb=${Date.now()}`;
  };

  const fallbackAvatar = "https://placehold.co/120x120/png?text=User";
  const fallbackCover = "https://placehold.co/600x140/png?text=Cover";

  /* --------------------- LEFT: My Profile (dynamic) --------------------- */
  const [myProfile, setMyProfile] = useState({
    full_name: "",
    avatar_url: "",
    cover_url: "",
    bio: "",
  });
  const [postCount, setPostCount] = useState(0);
  const [postImpressions, setPostImpressions] = useState(0); // sum of like_count
  const [loadingProfile, setLoadingProfile] = useState(false);

  const avatarUrl = useMemo(
    () => bust(toPublicUrl(AVATAR_BUCKET, myProfile.avatar_url)) || fallbackAvatar,
    [myProfile.avatar_url]
  );
  const coverUrl = useMemo(
    () => bust(toPublicUrl(COVER_BUCKET, myProfile.cover_url)) || fallbackCover,
    [myProfile.cover_url]
  );

  useEffect(() => {
    let on = true;

    async function loadMe() {
      if (!user?.id) {
        setMyProfile({ full_name: "", avatar_url: "", cover_url: "", bio: "" });
        setPostCount(0);
        setPostImpressions(0);
        return;
      }
      setLoadingProfile(true);

      // 1) profile row
      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select("full_name, avatar_url, cover_url, bio")
        .eq("id", user.id)
        .maybeSingle();

      if (!on) return;

      if (!profErr && prof) {
        setMyProfile({
          full_name: prof.full_name || "User",
          avatar_url: prof.avatar_url || "",
          cover_url: prof.cover_url || "",
          bio: prof.bio || "Food Enthusiast | Recipe Creator",
        });
      } else {
        setMyProfile({
          full_name: "User",
          avatar_url: "",
          cover_url: "",
          bio: "Food Enthusiast | Recipe Creator",
        });
      }

      // 2) posts → count + impressions (sum of like_count)
      const { data: myPosts, error: postsErr } = await supabase
        .from("posts")
        .select("id, like_count")
        .eq("user_id", user.id);

      if (!on) return;

      if (!postsErr && Array.isArray(myPosts)) {
        setPostCount(myPosts.length);
        const sumLikes = myPosts.reduce((s, p) => s + (p.like_count || 0), 0);
        setPostImpressions(sumLikes);
      } else {
        setPostCount(0);
        setPostImpressions(0);
      }

      setLoadingProfile(false);
    }

    loadMe();

    // realtime update if profile row changes
    const ch =
      user?.id &&
      supabase
        .channel(`profile-${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "profiles",
            filter: `id=eq.${user.id}`,
          },
          (payload) => {
            const p = payload.new || {};
            setMyProfile((prev) => ({
              ...prev,
              full_name: p.full_name ?? prev.full_name,
              avatar_url: p.avatar_url ?? prev.avatar_url,
              cover_url: p.cover_url ?? prev.cover_url,
              bio: p.bio ?? prev.bio,
            }));
          }
        )
        .subscribe();

    return () => {
      on = false;
      if (ch) supabase.removeChannel(ch);
    };
  }, [user?.id]);

  /* --------------------- RIGHT: Dynamic suggestions --------------------- */
  const [suggestions, setSuggestions] = useState([]);
  const [loadingSug, setLoadingSug] = useState(false);

  useEffect(() => {
    let on = true;

    async function loadSuggestions() {
      if (!user?.id) {
        setSuggestions([]);
        return;
      }
      setLoadingSug(true);

      // who I already follow
      const { data: followingRows } = await supabase
        .from("follows")
        .select("following_id")
        .eq("follower_id", user.id);

      const followingSet = new Set((followingRows || []).map((r) => r.following_id));

      // newest profiles
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url, bio, created_at")
        .order("created_at", { ascending: false })
        .limit(24);

      if (!on) return;

      const filtered = (profs || [])
        .filter((p) => p.id !== user.id && !followingSet.has(p.id))
        .slice(0, 6)
        .map((p) => ({
          id: p.id,
          full_name: p.full_name || "User",
          avatar: bust(toPublicUrl(AVATAR_BUCKET, p.avatar_url)) || fallbackAvatar,
          bio: p.bio || "Food lover • New on FF",
          created_at: p.created_at,
        }));

      setSuggestions(filtered);
      setLoadingSug(false);
    }

    loadSuggestions();
    return () => {
      on = false;
    };
  }, [user?.id]);

  const handleFollow = async (targetId) => {
    if (!user?.id || !targetId) return;
    try {
      setSuggestions((list) => list.filter((x) => x.id !== targetId)); // optimistic
      const { error } = await supabase
        .from("follows")
        .insert({ follower_id: user.id, following_id: targetId });
      if (error && !String(error.message).includes("duplicate")) throw error;
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert(e.message || "Unable to follow");
    }
  };

  /* --------------------- Handlers for navigation --------------------- */
  const goToMyProfile = () => {
    navigate("/profile");
  };

  const goToUserProfile = (id) => {
    if (!id) return;
    navigate(`/profile?id=${id}`);
  };

  return (
    <div className="linkedin-layout">
      {/* LEFT SIDEBAR */}
      <aside className="sidebar left">
        <div className="profile-card">
          <div
            className="cover-pic"
            style={{
              backgroundImage: `url(${coverUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
          <img
            src={avatarUrl}
            alt="Profile"
            className="profile-pic"
            onError={(e) => (e.currentTarget.src = fallbackAvatar)}
          />
          <h3>{loadingProfile ? "Loading…" : myProfile.full_name || "User"}</h3>
          <p>{myProfile.bio || "Food Enthusiast | Recipe Creator"}</p>

          <div className="profile-stats">
            <div title="Post count">
              <FaEye /> <p>Posts</p>
              <b>{postCount}</b>
            </div>
            <div title="Sum of likes across your posts">
              <FaChartBar /> <p>Post Impressions</p>
              <b>{postImpressions}</b>
            </div>
          </div>

          <div className="profile-progress">
            <p>Profile Strength</p>
            <div className="progress-bar">
              <span style={{ width: "70%" }} />
            </div>
          </div>

          <div className="quick-actions" style={{ display: "flex", gap: 8 }}>
            <button type="button" className="follow-btn" onClick={goToMyProfile}>
              View Profile
            </button>
          </div>
        </div>

      </aside>

      {/* MAIN FEED */}
      <main className="feed">
        <Notify />
      </main>

      {/* RIGHT SIDEBAR */}
      <aside className="right right-side-panel">
        <div className="suggest-card">
          <h4>Sponsored Deals</h4>
          <ul className="trending-list">
            <li>🍕 Pizza Supreme</li>
            <li>🍩 Strawberry Donuts</li>
            <li>🥗 Vegan Salad</li>
            <li>🍔 Cheese Burger</li>
          </ul>
        </div>

        <div className="suggest-card add-feed">
          <h4>Add to your feed</h4>

          {loadingSug && <p style={{ padding: 8, color: "#6b7280" }}>Loading…</p>}
          {!loadingSug && suggestions.length === 0 && (
            <p style={{ padding: 8, color: "#6b7280" }}>
              No new people to follow right now.
            </p>
          )}

          {suggestions.map((s) => (
            <div
              className="feed-suggest"
              key={s.id}
              role="button"
              tabIndex={0}
              onClick={() => goToUserProfile(s.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") goToUserProfile(s.id);
              }}
              style={{ cursor: "pointer" }}
            >
              <img
                src={s.avatar}
                alt={s.full_name}
                className="suggest-avatar"
                onClick={(e) => {
                  e.stopPropagation();
                  goToUserProfile(s.id);
                }}
                onError={(e) => (e.currentTarget.src = fallbackAvatar)}
              />
              <div className="suggest-info">
                <p
                  className="name"
                  onClick={(e) => {
                    e.stopPropagation();
                    goToUserProfile(s.id);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  {s.full_name}
                </p>
                <small>{s.bio}</small>

                {/* Follow button should NOT trigger navigation */}
                <button
                  className="follow-btn"
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFollow(s.id);
                  }}
                >
                  + Follow
                </button>
              </div>
            </div>
          ))}

          <Link to="/discover" className="view-all">
            View all recommendations →
          </Link>
        </div>

        <footer className="footer">
          <div className="footer-links">
            <Link to="/about">About</Link>
            <Link to="/accessibility">Accessibility</Link>
            <Link to="/help">Help Center</Link>
            <Link to="/privacy">Privacy & Terms</Link>
            <Link to="/ads">Ad Choices</Link>
            <Link to="/advertising">Advertising</Link>
            <Link to="/business">Business Services</Link>
            <Link to="/apps">Get the App</Link>
            <Link to="/more">More</Link>
          </div>

          <div className="footer-bottom">
            <strong>FF</strong>
            <span> FoodFeed Corporation © 2025</span>
          </div>
        </footer>
      </aside>
    </div>
  );
}

export default Notification;
