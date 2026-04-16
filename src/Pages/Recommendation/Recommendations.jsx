import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import supabase from "../../supabaseClient";
import "./Recommendations.css";

/** ---- Config ---- */
const PROFILES_TABLE = "profiles"; // id, full_name, avatar_url, cover_url, bio, location, created_at
const AVATAR_BUCKET = "avatars";
const COVER_BUCKET = "covers";
const PAGE_SIZE = 24;

/** If your buckets are PRIVATE, flip this to true to use signed URLs */
const USE_SIGNED_URLS = false;
const SIGNED_URL_EXPIRY = 60 * 60 * 24; // 24h

/** Debounce */
const useDebounced = (value, delay = 350) => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
};

/** Utilities */
const isAbsolute = (s = "") => /^https?:\/\//i.test(s);
const toPublicUrl = async (bucket, path) => {
  if (!path) return "";
  if (isAbsolute(path)) return path;
  if (USE_SIGNED_URLS) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, SIGNED_URL_EXPIRY);
    if (error) return "";
    return data?.signedUrl || "";
  } else {
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data?.publicUrl || "";
  }
};

/** Tabs */
const FilterTabs = ({ value, onChange, myCity }) => {
  const tabs = useMemo(
    () => [
      { key: "all", label: "All Users" },
      { key: "near", label: myCity ? `Near Me (${myCity})` : "Near Me" },
    ],
    [myCity]
  );
  return (
    <div className="reco-tabs">
      {tabs.map((t) => (
        <button
          key={t.key}
          className={`reco-tab ${t.key === value ? "is-active" : ""}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
};

/** Card */
const UserCard = ({ p }) => {
  return (
    <Link
      to={`/u/${p.id}`} /* <- reliable SPA link */
      className="reco-card"
      aria-label={`Open ${p.full_name}'s profile`}
    >
      <div className="reco-card__media">
        <img
          className="reco-card__cover"
          src={p._coverResolved || "/covers/placeholder.jpg"}
          alt={`${p.full_name}'s cover`}
          loading="lazy"
          onError={(e) => (e.currentTarget.src = "/covers/placeholder.jpg")}
        />
        <img
          className="reco-card__avatar"
          src={p._avatarResolved || "/avatars/placeholder.png"}
          alt={`${p.full_name}'s avatar`}
          loading="lazy"
          onError={(e) => (e.currentTarget.src = "/avatars/placeholder.png")}
        />
      </div>

      <div className="reco-card__body">
        <h3 className="reco-card__name">{p.full_name || "Unnamed"}</h3>
        {p.bio ? (
          <p className="reco-card__bio" title={p.bio}>
            {p.bio}
          </p>
        ) : (
          <p className="reco-card__bio reco-card__bio--muted">No bio yet</p>
        )}
        {p.location ? (
          <div className="reco-card__meta" title={p.location}>
            <span className="reco-dot" /> {p.location}
          </div>
        ) : null}
      </div>
    </Link>
  );
};

const Skeleton = () => (
  <div className="reco-card is-skeleton" aria-hidden="true">
    <div className="reco-card__media">
      <div className="reco-skel reco-skel--cover" />
      <div className="reco-skel reco-skel--avatar" />
    </div>
    <div className="reco-card__body">
      <div className="reco-skel reco-skel--line" />
      <div className="reco-skel reco-skel--line short" />
    </div>
  </div>
);

export default function Recommendations() {
  // UI state
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounced(query);
  const [tab, setTab] = useState("all");
  const [myCity, setMyCity] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const loaderRef = useRef(null);
  const bootRef = useRef(false);

  /** Read my city */
  const fetchMyCity = useCallback(async () => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const me = auth?.user;
      if (!me?.id) return;
      const { data } = await supabase
        .from(PROFILES_TABLE)
        .select("location")
        .eq("id", me.id)
        .single();
      if (data?.location) setMyCity(data.location);
    } catch {}
  }, []);

  /** Base query */
const baseQuery = useCallback(
  (from) => {
    let q = from
      .select("id, full_name, avatar_url, cover_url, bio, location, created_at, profile_type")
      .eq("profile_type", "seller") // only vendor profiles
      .order("created_at", { ascending: false });

    if (debouncedQuery?.trim()) {
      const qstr = debouncedQuery.trim();
      q = q.or(`full_name.ilike.%${qstr}%,bio.ilike.%${qstr}%`);
    }

    return q;
  },
  [debouncedQuery]
);

  /** Resolve URLs */
  const resolveBatchUrls = useCallback(async (rows) => {
    const resolved = await Promise.all(
      rows.map(async (r) => {
        const [_avatarResolved, _coverResolved] = await Promise.all([
          toPublicUrl(AVATAR_BUCKET, r.avatar_url),
          toPublicUrl(COVER_BUCKET, r.cover_url),
        ]);
        return { ...r, _avatarResolved, _coverResolved };
      })
    );
    return resolved;
  }, []);

  /** Case-insensitive city compare */
  const sameCity = (a = "", b = "") =>
    a.trim().toLowerCase() === b.trim().toLowerCase();

  /** Load a page */
  const loadPage = useCallback(
    async (reset = false) => {
      setLoading(true);
      setError("");
      try {
        const from = supabase.from(PROFILES_TABLE);
        const start = reset ? 0 : page * PAGE_SIZE;
        const end = start + PAGE_SIZE - 1;

        // Always fetch a page of results
        const { data, error } = await baseQuery(from).range(start, end);
        if (error) throw error;
        const rows = data || [];

        // Resolve storage paths -> URLs
        const withUrls = await resolveBatchUrls(rows);

        // STRICT filter when tab === 'near'
        const finalRows =
          tab === "near" && myCity
            ? withUrls.filter((u) => sameCity(u.location || "", myCity))
            : withUrls;

        if (reset) {
          setItems(finalRows);
          setPage(0);
        } else {
          setItems((prev) => [...prev, ...finalRows]);
        }

        // Keep loading while the raw page size is full; this allows more “near me”
        // matches to be found in later pages.
        setHasMore(rows.length === PAGE_SIZE);
      } catch (e) {
        setError(e?.message || "Failed to load users.");
      } finally {
        setLoading(false);
      }
    },
    [baseQuery, page, tab, myCity, resolveBatchUrls]
  );

  /** First boot */
  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    fetchMyCity().finally(() => loadPage(true));
  }, []); // eslint-disable-line

  /** Filters changed -> reset list */
  useEffect(() => {
    setPage(0);
    loadPage(true);
  }, [debouncedQuery, tab, myCity]); // eslint-disable-line

  /** Infinite scroll sentinel */
  useEffect(() => {
    if (!loaderRef.current) return;
    const el = loaderRef.current;
    const onInView = (entries) => {
      const [entry] = entries;
      if (entry.isIntersecting && !loading && hasMore) {
        setPage((p) => p + 1);
      }
    };
    const io = new IntersectionObserver(onInView, { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loading, hasMore]);

  /** Load more on page++ */
  useEffect(() => {
    if (page === 0) return;
    loadPage(false);
  }, [page]); // eslint-disable-line

  return (
    <section className="reco-wrap">
      <header className="reco-toolbar">
        <div className="reco-search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search users by name or bio…"
            aria-label="Search users"
          />
          {query && (
            <button
              className="reco-clear"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>

        <FilterTabs value={tab} onChange={setTab} myCity={myCity} />
      </header>

      {error ? (
        <div className="reco-error">{error}</div>
      ) : (
        <>
          <div className="reco-grid">
            {items.map((p) => (
              <UserCard key={p.id} p={p} />
            ))}
            {loading && items.length === 0
              ? Array.from({ length: 8 }).map((_, i) => <Skeleton key={`sk-${i}`} />)
              : null}
          </div>

          <div ref={loaderRef} className="reco-sentinel" />

          {loading && items.length > 0 ? (
            <div className="reco-tail-loading">Loading more…</div>
          ) : null}

          {!loading && items.length === 0 ? (
            <div className="reco-empty">
              {tab === "near" && !myCity
                ? "Set your city in profile to see nearby users."
                : "No users found."}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
