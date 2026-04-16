// src/pages/message.jsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import supabase from "../../supabaseClient";
import MessagingPage from "../../components/Messaging/MessagingPage";

export default function Messages() {
  const navigate = useNavigate();
  const [me, setMe] = useState(undefined); // undefined=loading, null=logged out

  useEffect(() => {
    let on = true;

    // 1) Initial auth check
    supabase.auth.getUser().then(({ data }) => {
      if (!on) return;
      const user = data.user ?? null;
      setMe(user);
      if (!user) navigate("/login", { replace: true });
    });

    // 2) React to future auth changes
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      const user = session?.user ?? null;
      setMe(user);
      if (!user) navigate("/login", { replace: true });
    });

    return () => {
      on = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, [navigate]);

  if (me === undefined) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "50vh" }}>
        Loading…
      </div>
    );
  }
  if (!me) return null;

  return (
    <div className="messages-page container">
      {/* Top bar (keeps header clickable; just a normal div, not fixed) */}
      <div className="msg-topbar">
        <div className="left">
          <h2>Messaging</h2>
          <div className="chips">
            <button className="chip active">Focused</button>
          </div>
        </div>
        <div className="right">
          <input className="search" placeholder="Search messages" />
        </div>
      </div>

      {/* Main two-pane layout (height only within page, header remains clickable) */}
      <div className="msg-body">
        <MessagingPage />
      </div>

      <style>{`
        /* Let your site header sit above; define a header height if you want exact fit */
        .messages-page {
    --nav-h: 72px;
    padding: 5rem 16px 0;
}

        .msg-topbar {
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: center;
          gap: 12px;
          background: #fff;
          border: 1px solid #eee;
          border-radius: 12px;
          padding: 10px 14px;
          box-shadow: 0 4px 18px rgba(0,0,0,.04);
          margin-bottom: 12px;
        }
        .msg-topbar h2 { margin: 0 12px 0 0; font-size: 18px; }
        .msg-topbar .left { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
        .msg-topbar .chips { display: flex; gap: 8px; flex-wrap: wrap; }
        .chip{
          border:1px solid #e5e7eb; background:#fafafa; border-radius:999px;
          padding:6px 12px; font-weight:600; font-size:13px; cursor:pointer;
        }
        .chip.active{ background:#0a66c2; color:#fff; border-color:#0a66c2; }

        .search{
          width: 280px; max-width: 40vw;
          border:1px solid #e5e7eb; background:#fff; border-radius:999px;
          padding:8px 12px; outline: none;
        }

        /* The two-pane area. We don't cover the whole screen;
           just fill the remaining viewport below the header area. */
        .msg-body{
          height: calc(100vh - var(--nav-h) - 24px - 60px);
          /*   ^ viewport – header – page padding – topbar approx */
          min-height: 480px;
        }

        /* MessagingPage already draws the grid and inner heights.
           No global fixed/absolute/z-index here to block header clicks. */

        /* Small screens */
        @media (max-width: 900px) {
          .search{ width: 180px; }
          .chip{ padding:5px 10px; }
          .msg-body{ height: calc(100vh - var(--nav-h) - 24px - 100px); }
        }
      `}</style>
    </div>
  );
}
