import React, { useState, useEffect, useRef } from "react";

/* ============================================================================
   Elsewedy Electric — SupportBot  (BACKEND-CONNECTED build)

   This version talks to the real FastAPI backend:
   - Auth (signup / verify / login / forgot / reset) hits /auth/* endpoints,
     which use a real SQLite database, bcrypt-hashed passwords, and JWT tokens.
   - Chat hits /search, which runs real MiniLM + ChromaDB semantic search.
   - Verification codes are emailed (or printed to the server console if Gmail
     isn't configured — check the uvicorn terminal for the code).

   Requires the backend running at API_BASE (default http://localhost:8000).
   ========================================================================== */

// ---------------------------------------------------------------------------
// Backend API
// ---------------------------------------------------------------------------
// Where the FastAPI server is running. Change if you host it elsewhere.
const API_BASE = "http://localhost:8000";

async function api(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // FastAPI puts error text in `detail`
    throw new Error(data.detail || `Request failed (${res.status})`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Brand tokens
// ---------------------------------------------------------------------------
const C = {
  red: "#E30613",
  redDark: "#B00410",
  ink: "#1A1A1A",
  paper: "#FAFAF8",
  paper2: "#FFFFFF",
  line: "#E7E4DE",
  mute: "#6B6B6B",
  ok: "#1F9D55",
};

// ---------------------------------------------------------------------------
// Logo — the real Elsewedy Electric mark (public/logo.png, white background
// removed so it drops cleanly onto any surface). `mono` inverts it to solid
// white for dark/branded backgrounds; `animateArc` gives a soft reveal on the
// auth splash. Props kept identical to the old inline-SVG version so every
// call site works unchanged.
// ---------------------------------------------------------------------------
function Logo({ height = 34, mono = false, animateArc = false }) {
  return (
    <img
      src="/logo.png"
      alt="Elsewedy Electric"
      height={height}
      style={{
        height,
        width: "auto",
        display: "block",
        filter: mono ? "brightness(0) invert(1)" : "none",
        animation: animateArc ? "logoReveal 0.7s ease forwards" : undefined,
      }}
    />
  );
}

// The arc on its own — used as a divider / accent.
function Arc({ width = 120, stroke = C.red, sw = 5 }) {
  return (
    <svg viewBox="0 0 200 40" width={width} aria-hidden="true" style={{ display: "block" }}>
      <path
        d="M10 12 Q100 52 190 12"
        fill="none"
        stroke={stroke}
        strokeWidth={sw}
        strokeLinecap="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// ===========================================================================
// Root
// ===========================================================================
export default function App() {
  const [route, setRoute] = useState("landing"); // landing | auth | app
  const [session, setSession] = useState(null); // {username, email, token}

  return (
    <div style={styles.root}>
      <GlobalStyle />
      {route === "landing" && <Landing onStart={() => setRoute("auth")} />}
      {route === "auth" && (
        <Auth
          onAuthed={(u) => {
            setSession(u);
            setRoute("app");
          }}
          onHome={() => setRoute("landing")}
        />
      )}
      {route === "app" && (
        <Chat
          session={session}
          onSignOut={() => {
            setSession(null);
            setRoute("landing");
          }}
        />
      )}
    </div>
  );
}

// ===========================================================================
// Landing
// ===========================================================================
function Landing({ onStart }) {
  return (
    <div style={styles.landingWrap}>
      <header style={styles.nav}>
        <Logo height={30} />
        <nav style={styles.navLinks}>
          <a style={styles.navLink} href="#how">How it works</a>
          <a style={styles.navLink} href="#cases">Coverage</a>
          <button style={styles.navBtn} onClick={onStart}>
            Sign in
          </button>
        </nav>
      </header>

      <section style={styles.hero} className="hero-grid">
        <div style={styles.heroInner}>
          <p style={styles.eyebrow} className="rise" >
            Field Support · Internal Tool
          </p>
          <h1 style={styles.h1}>
            <span className="rise d1">Answers from every</span>
            <br />
            <span className="rise d2">resolved support case,</span>
            <br />
            <span className="rise d3" style={{ color: C.red }}>
              in seconds.
            </span>
          </h1>
          <div className="rise d4" style={{ margin: "22px 0 0" }}>
            <Arc width={150} />
          </div>
          <p style={styles.sub} className="rise d5">
            SupportBot searches Elsewedy's device knowledge base by meaning, not
            just keywords — surfacing the closest past cases, their causes, and
            the fixes that worked.
          </p>
          <div style={styles.heroCtas} className="rise d6">
            <button style={styles.primaryBtn} onClick={onStart}>
              Get started
            </button>
            <a style={styles.ghostBtn} href="#how">
              See how it works
            </a>
          </div>
        </div>

        <div style={styles.heroPanel} className="floatIn">
          <MockChatPreview />
        </div>
      </section>

      <section id="how" style={styles.how}>
        <div style={styles.howHead}>
          <h2 style={styles.h2}>How it works</h2>
          <Arc width={110} />
        </div>
        <div style={styles.steps}>
          {[
            ["Ask in plain words", "Describe the symptom the way an engineer would in the field. No error-code lookup tables needed."],
            ["Search by meaning", "Every past case is embedded as a vector. SupportBot finds the closest matches — even with zero shared keywords."],
            ["Get the fix", "See the matched case, its root cause, and the resolution that actually worked, ranked by closeness."],
          ].map(([t, d], i) => (
            <div key={i} style={styles.step}>
              <div style={styles.stepNum}>{String(i + 1).padStart(2, "0")}</div>
              <h3 style={styles.stepTitle}>{t}</h3>
              <p style={styles.stepText}>{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="cases" style={styles.coverage}>
        <div style={styles.howHead}>
          <h2 style={styles.h2}>What it covers</h2>
          <Arc width={110} />
        </div>
        <div style={styles.chips}>
          {["AeroSense G3", "ThermoNode T5", "PowerTrack P1", "GridLink Hub", "FlowMeter X100", "FlowMeter X200"].map(
            (p) => (
              <span key={p} style={styles.chip}>
                {p}
              </span>
            )
          )}
        </div>
        <p style={styles.coverageNote}>
          Connectivity · Configuration · Display · Power · Installation ·
          Firmware · Mechanical · Measurement
        </p>
      </section>

      <footer style={styles.footer}>
        <Logo height={24} />
        <span style={styles.footNote}>
          Internal support tool · Demo build
        </span>
      </footer>
    </div>
  );
}

function MockChatPreview() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s + 1) % 4), 1600);
    return () => clearInterval(t);
  }, []);
  return (
    <div style={styles.preview}>
      <div style={styles.previewBar}>
        <span style={{ ...styles.dot, background: "#FF5F56" }} />
        <span style={{ ...styles.dot, background: "#FFBD2E" }} />
        <span style={{ ...styles.dot, background: "#27C93F" }} />
        <span style={styles.previewTitle}>SupportBot</span>
      </div>
      <div style={styles.previewBody}>
        <div style={styles.bubbleUser}>Readings drift higher after install</div>
        {step >= 1 && (
          <div style={styles.bubbleBot} className="pop">
            <strong>AeroSense G3 · Connectivity</strong>
            <div style={styles.previewMatch}>
              Sensor contaminated by dust ingress
            </div>
            <div style={styles.previewFix}>
              → Cleaned sensor chamber, replaced intake filter
            </div>
          </div>
        )}
        {step >= 2 && (
          <div style={{ ...styles.bubbleBot, opacity: 0.85 }} className="pop">
            <strong>ThermoNode T5 · Installation</strong>
            <div style={styles.previewMatch}>Thermal offset not calibrated</div>
          </div>
        )}
        {step >= 3 && (
          <div style={styles.previewMeta} className="pop">
            matched in 0.3s · cosine 0.37
          </div>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Auth (login / signup / forgot-password) — DEMO
// ===========================================================================
function Auth({ onAuthed, onHome }) {
  const [mode, setMode] = useState("login"); // login | signup | forgot
  return (
    <div style={styles.authWrap} className="auth-grid">
      <div style={styles.authArt} className="authArt auth-art-hide">
        <div style={{ position: "relative", zIndex: 2 }}>
          <Logo height={40} mono animateArc />
          <h2 style={styles.authArtTitle}>SupportBot</h2>
          <p style={styles.authArtText}>
            Faster field resolutions, grounded in every case your team has
            already solved.
          </p>
        </div>
        <div className="arcField" aria-hidden="true" />
      </div>

      <div style={styles.authPanel}>
        <button style={styles.backLink} onClick={onHome}>
          ← Back
        </button>
        <div style={styles.authCard}>
          {mode === "login" && <Login onAuthed={onAuthed} switchTo={setMode} />}
          {mode === "signup" && <Signup onAuthed={onAuthed} switchTo={setMode} />}
          {mode === "forgot" && <Forgot switchTo={setMode} />}
        </div>
      </div>
    </div>
  );
}

function Field({ label, ...props }) {
  return (
    <label style={styles.field}>
      <span style={styles.fieldLabel}>{label}</span>
      <input style={styles.input} {...props} />
    </label>
  );
}

function Notice({ kind = "info", children }) {
  const bg = kind === "error" ? "#FDECEC" : kind === "ok" ? "#EAF7EF" : "#F1F0EC";
  const fg = kind === "error" ? C.redDark : kind === "ok" ? C.ok : C.ink;
  return <div style={{ ...styles.notice, background: bg, color: fg }}>{children}</div>;
}

function Login({ onAuthed, switchTo }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr("");
    if (!emailOk(email)) return setErr("Enter a valid email address.");
    setBusy(true);
    try {
      const r = await api("/auth/login", { email, password });
      onAuthed({ username: r.username, email: r.email, token: r.token });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h3 style={styles.cardTitle}>Sign in</h3>
      <p style={styles.cardSub}>Welcome back. Pick up where you left off.</p>
      {err && <Notice kind="error">{err}</Notice>}
      <Field
        label="Email"
        type="email"
        placeholder="you@elsewedy.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Field
        label="Password"
        type="password"
        placeholder="••••••••"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <button style={styles.authBtn} onClick={submit} disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <div style={styles.authLinks}>
        <button style={styles.linkBtn} onClick={() => switchTo("forgot")}>
          Forgot password?
        </button>
        <span style={{ color: C.mute }}>
          New here?{" "}
          <button style={styles.linkBtn} onClick={() => switchTo("signup")}>
            Create account
          </button>
        </span>
      </div>
    </>
  );
}

function Signup({ onAuthed, switchTo }) {
  const [stage, setStage] = useState("form"); // form | verify
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [entered, setEntered] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [emailMode, setEmailMode] = useState("console");

  const startVerify = async () => {
    setErr("");
    if (username.trim().length < 2) return setErr("Pick a username (2+ characters).");
    if (!emailOk(email)) return setErr("Enter a valid email address.");
    if (password.length < 6) return setErr("Password must be at least 6 characters.");
    setBusy(true);
    try {
      const r = await api("/auth/signup", { username, email, password });
      setEmailMode(r.email_mode || "console");
      setStage("verify");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setErr("");
    setBusy(true);
    try {
      const r = await api("/auth/verify", { email, code: entered });
      onAuthed({ username: r.username, email: r.email, token: r.token });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (stage === "verify") {
    return (
      <>
        <h3 style={styles.cardTitle}>Verify your email</h3>
        <p style={styles.cardSub}>
          We sent a 6-digit code to <strong>{email}</strong>.
        </p>
        {emailMode === "console" ? (
          <Notice kind="info">
            Server is in console mode — no real email sent. Check the terminal
            running the backend for your code.
          </Notice>
        ) : (
          <Notice kind="ok">Code sent — check your inbox (and spam).</Notice>
        )}
        {err && <Notice kind="error">{err}</Notice>}
        <Field
          label="6-digit code"
          inputMode="numeric"
          maxLength={6}
          placeholder="••••••"
          value={entered}
          onChange={(e) => setEntered(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && finish()}
        />
        <button style={styles.authBtn} onClick={finish} disabled={busy}>
          {busy ? "Verifying…" : "Verify & create account"}
        </button>
        <div style={styles.authLinks}>
          <button style={styles.linkBtn} onClick={() => setStage("form")}>
            ← Edit details
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <h3 style={styles.cardTitle}>Create account</h3>
      <p style={styles.cardSub}>One minute, and SupportBot is yours.</p>
      {err && <Notice kind="error">{err}</Notice>}
      <Field
        label="Username"
        placeholder="e.g. y.bassem"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <Field
        label="Email"
        type="email"
        placeholder="you@elsewedy.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Field
        label="Password"
        type="password"
        placeholder="At least 6 characters"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && startVerify()}
      />
      <button style={styles.authBtn} onClick={startVerify} disabled={busy}>
        {busy ? "Sending code…" : "Continue"}
      </button>
      <div style={styles.authLinks}>
        <span style={{ color: C.mute }}>
          Already have an account?{" "}
          <button style={styles.linkBtn} onClick={() => switchTo("login")}>
            Sign in
          </button>
        </span>
      </div>
    </>
  );
}

function Forgot({ switchTo }) {
  const [stage, setStage] = useState("email"); // email | reset | done
  const [email, setEmail] = useState("");
  const [entered, setEntered] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [emailMode, setEmailMode] = useState("console");

  const send = async () => {
    setErr("");
    if (!emailOk(email)) return setErr("Enter a valid email address.");
    setBusy(true);
    try {
      const r = await api("/auth/forgot", { email });
      setEmailMode(r.email_mode || "console");
      setStage("reset");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setErr("");
    if (pw.length < 6) return setErr("New password must be at least 6 characters.");
    setBusy(true);
    try {
      await api("/auth/reset", { email, code: entered, new_password: pw });
      setStage("done");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (stage === "done") {
    return (
      <>
        <h3 style={styles.cardTitle}>Password updated</h3>
        <p style={styles.cardSub}>You can sign in with your new password now.</p>
        <Notice kind="ok">All set — your password has been changed.</Notice>
        <button style={styles.authBtn} onClick={() => switchTo("login")}>
          Back to sign in
        </button>
      </>
    );
  }

  if (stage === "reset") {
    return (
      <>
        <h3 style={styles.cardTitle}>Reset password</h3>
        <p style={styles.cardSub}>
          Enter the code sent to <strong>{email}</strong> and choose a new
          password.
        </p>
        {emailMode === "console" ? (
          <Notice kind="info">
            Server is in console mode — no real email sent. Check the terminal
            running the backend for your code.
          </Notice>
        ) : (
          <Notice kind="ok">Code sent — check your inbox (and spam).</Notice>
        )}
        {err && <Notice kind="error">{err}</Notice>}
        <Field
          label="6-digit code"
          inputMode="numeric"
          maxLength={6}
          placeholder="••••••"
          value={entered}
          onChange={(e) => setEntered(e.target.value.replace(/\D/g, ""))}
        />
        <Field
          label="New password"
          type="password"
          placeholder="At least 6 characters"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && reset()}
        />
        <button style={styles.authBtn} onClick={reset} disabled={busy}>
          {busy ? "Updating…" : "Update password"}
        </button>
      </>
    );
  }

  return (
    <>
      <h3 style={styles.cardTitle}>Forgot password</h3>
      <p style={styles.cardSub}>
        Enter your email and we'll send a reset code.
      </p>
      {err && <Notice kind="error">{err}</Notice>}
      <Field
        label="Email"
        type="email"
        placeholder="you@elsewedy.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && send()}
      />
      <button style={styles.authBtn} onClick={send} disabled={busy}>
        {busy ? "Sending…" : "Send reset code"}
      </button>
      <div style={styles.authLinks}>
        <button style={styles.linkBtn} onClick={() => switchTo("login")}>
          ← Back to sign in
        </button>
      </div>
    </>
  );
}

// ===========================================================================
// Chat app
// ===========================================================================
function Chat({ session, onSignOut }) {
  const [messages, setMessages] = useState([
    {
      who: "bot",
      kind: "text",
      text: `Hi ${session?.username || "there"} — describe a device issue and I'll find the closest resolved cases.`,
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const send = async () => {
    const q = input.trim();
    if (!q || busy) return;
    setMessages((m) => [...m, { who: "user", kind: "text", text: q }]);
    setInput("");
    setBusy(true);
    try {
      const hits = await api("/search", { query: q });
      setBusy(false);
      if (!hits || hits.length === 0) {
        setMessages((m) => [
          ...m,
          {
            who: "bot",
            kind: "empty",
            text: "No close matches in the case base. This corpus is device support — try describing a hardware symptom (readings, display, reboot, connectivity).",
          },
        ]);
      } else {
        setMessages((m) => [...m, { who: "bot", kind: "hits", hits }]);
      }
    } catch (e) {
      setBusy(false);
      setMessages((m) => [
        ...m,
        {
          who: "bot",
          kind: "empty",
          text: `Couldn't reach the search service: ${e.message}. Is the backend running at ${API_BASE}?`,
        },
      ]);
    }
  };

  const suggestions = [
    "Readings drift higher after install",
    "Config resets after power cycle",
    "Screen shows nothing after power on",
    "Device reboots randomly",
  ];

  return (
    <div style={styles.chatShell}>
      <aside style={styles.sidebar} className="sidebar-hide">
        <div style={{ padding: "20px 18px" }}>
          <Logo height={26} />
        </div>
        <div style={styles.sideSection}>
          <div style={styles.sideLabel}>Try asking</div>
          {suggestions.map((s) => (
            <button
              key={s}
              style={styles.suggest}
              onClick={() => setInput(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <div style={{ marginTop: "auto", padding: 18, borderTop: `1px solid ${C.line}` }}>
          <div style={styles.userRow}>
            <div style={styles.avatar}>
              {(session?.username || "U").slice(0, 1).toUpperCase()}
            </div>
            <div style={{ overflow: "hidden" }}>
              <div style={styles.userName}>{session?.username}</div>
              <div style={styles.userMail}>{session?.email}</div>
            </div>
          </div>
          <button style={styles.signOut} onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </aside>

      <main style={styles.chatMain}>
        <header style={styles.chatHead}>
          <div>
            <div style={styles.chatTitle}>SupportBot</div>
            <div style={styles.chatSubtitle}>
              Semantic search over resolved device cases
            </div>
          </div>
          <Arc width={90} />
        </header>

        <div ref={scroller} style={styles.stream}>
          {messages.map((m, i) => (
            <Message key={i} m={m} />
          ))}
          {busy && <Typing />}
        </div>

        <div style={styles.composer}>
          <input
            style={styles.composerInput}
            placeholder="Describe the issue…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button
            style={{ ...styles.sendBtn, opacity: input.trim() && !busy ? 1 : 0.5 }}
            onClick={send}
            aria-label="Send"
          >
            <SendArc />
          </button>
        </div>
      </main>
    </div>
  );
}

function Message({ m }) {
  if (m.who === "user") {
    return (
      <div style={styles.rowRight}>
        <div style={styles.userBubble}>{m.text}</div>
      </div>
    );
  }
  if (m.kind === "text" || m.kind === "empty") {
    return (
      <div style={styles.rowLeft}>
        <div style={styles.botBubble} className="pop">
          {/* This splits the text at " / " and replaces it with a real newline */}
          {m.text.split(" / ").join("\n")}
        </div>
      </div>
    );
  }
  // hits — real backend shape: {case_id, product, category, problem, distance, document}
  return (
    <div style={styles.rowLeft}>
      <div style={{ ...styles.botBubble, padding: 0, background: "transparent", boxShadow: "none" }}>
        <div style={styles.hitIntro}>Closest resolved cases</div>
        <div style={styles.hitList}>
          {m.hits.map((h, idx) => {
            const parts = parseDocument(h.document);
            return (
              <div key={h.case_id} style={styles.hitCard} className="pop">
                <div style={styles.hitTop}>
                  <span style={styles.hitRank}>{String(idx + 1).padStart(2, "0")}</span>
                  <span style={styles.hitProduct}>{h.product}</span>
                  <span style={styles.hitCat}>{h.category}</span>
                  <span style={styles.hitDist}>{h.distance.toFixed(3)}</span>
                  <span style={styles.hitId}>#{h.case_id}</span>
                </div>
                <div style={styles.hitProblem}>{h.problem}</div>
                {(parts.Cause || parts.Resolution) && (
                  <div style={styles.hitGrid}>
                    {parts.Cause && (
                      <>
                        <span style={styles.hitKey}>Cause</span>
                        <span style={styles.hitVal}>{parts.Cause}</span>
                      </>
                    )}
                    {parts.Resolution && (
                      <>
                        <span style={styles.hitKey}>Fix</span>
                        <span style={{ ...styles.hitVal, color: C.ink, fontWeight: 600 }}>
                          {parts.Resolution}
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Parse the labelled `document` text ("Product: … / Category: … / Problem: …
// / Cause: … / Resolution: …") back into fields for display.
function parseDocument(doc) {
  const out = {};
  if (!doc) return out;
  for (const seg of doc.split(" / ")) {
    const i = seg.indexOf(": ");
    if (i > 0) out[seg.slice(0, i).trim()] = seg.slice(i + 2).trim();
  }
  return out;
}

function Typing() {
  return (
    <div style={styles.rowLeft}>
      <div style={{ ...styles.botBubble, display: "flex", gap: 5, alignItems: "center" }}>
        <span style={styles.tdot} className="td1" />
        <span style={styles.tdot} className="td2" />
        <span style={styles.tdot} className="td3" />
      </div>
    </div>
  );
}

function SendArc() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 12h14M12 5l7 7-7 7" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ===========================================================================
// Global styles / keyframes
// ===========================================================================
function GlobalStyle() {
  return (
    <style>{`
      * { box-sizing: border-box; }
      html, body, #root { margin: 0; height: 100%; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        color: ${C.ink};
        background: ${C.paper};
        -webkit-font-smoothing: antialiased;
      }
      button { font-family: inherit; cursor: pointer; }
      a { text-decoration: none; }

      @keyframes drawArc { to { stroke-dashoffset: 0; } }
      @keyframes logoReveal {
        from { opacity: 0; transform: translateY(8px) scale(0.98); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes riseUp {
        from { opacity: 0; transform: translateY(16px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes floatIn {
        from { opacity: 0; transform: translateY(24px) scale(0.98); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes popIn {
        from { opacity: 0; transform: translateY(8px) scale(0.98); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes bob { 0%,100% { transform: translateY(0);} 50% { transform: translateY(-5px);} }
      @keyframes arcDrift {
        0% { transform: translate(0,0) rotate(0deg); }
        100% { transform: translate(0,-14px) rotate(3deg); }
      }

      .rise { opacity: 0; animation: riseUp .7s cubic-bezier(.2,.7,.2,1) forwards; }
      .d1 { animation-delay: .05s } .d2 { animation-delay: .13s }
      .d3 { animation-delay: .21s } .d4 { animation-delay: .32s }
      .d5 { animation-delay: .42s } .d6 { animation-delay: .52s }
      .floatIn { opacity: 0; animation: floatIn .9s cubic-bezier(.2,.7,.2,1) forwards .35s; }
      .pop { animation: popIn .4s cubic-bezier(.2,.7,.2,1) both; }

      .td1 { animation: bob 1s ease-in-out infinite; }
      .td2 { animation: bob 1s ease-in-out infinite .15s; }
      .td3 { animation: bob 1s ease-in-out infinite .3s; }

      .authArt { position: relative; overflow: hidden; }
      .arcField {
        position: absolute; inset: 0; z-index: 1; opacity: .18;
        background-image:
          radial-gradient(circle at 20% 30%, transparent 60%, ${C.red} 61%, transparent 62%),
          radial-gradient(circle at 70% 60%, transparent 40%, rgba(255,255,255,.5) 41%, transparent 42%);
        background-size: 240px 240px, 300px 300px;
        animation: arcDrift 9s ease-in-out infinite alternate;
      }

      input:focus { outline: none; border-color: ${C.red} !important; box-shadow: 0 0 0 3px rgba(227,6,19,.12); }
      button.primary:hover { transform: translateY(-1px); }

      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { animation: none !important; transition: none !important; }
        .rise, .floatIn, .pop { opacity: 1 !important; }
      }

      @media (max-width: 900px) {
        .hero-grid { grid-template-columns: 1fr !important; }
        .auth-grid { grid-template-columns: 1fr !important; }
        .auth-art-hide { display: none !important; }
        .sidebar-hide { display: none !important; }
      }
    `}</style>
  );
}

// ===========================================================================
// Styles
// ===========================================================================
const styles = {
  root: { minHeight: "100%", background: C.paper },

  // Landing
  landingWrap: { maxWidth: 1180, margin: "0 auto", padding: "0 24px" },
  nav: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "22px 0",
  },
  navLinks: { display: "flex", alignItems: "center", gap: 26 },
  navLink: { color: C.ink, fontSize: 14, fontWeight: 500, opacity: 0.8 },
  navBtn: {
    border: `1.5px solid ${C.ink}`, background: "transparent", color: C.ink,
    padding: "9px 18px", borderRadius: 999, fontSize: 14, fontWeight: 600,
  },

  hero: {
    display: "grid", gridTemplateColumns: "1.05fr .95fr", gap: 40,
    alignItems: "center", padding: "40px 0 70px",
  },
  heroInner: {},
  eyebrow: {
    textTransform: "uppercase", letterSpacing: 3, fontSize: 12, fontWeight: 700,
    color: C.red, margin: "0 0 18px",
  },
  h1: { fontSize: 56, lineHeight: 1.05, fontWeight: 800, letterSpacing: -1.5, margin: 0 },
  sub: { fontSize: 17, lineHeight: 1.6, color: C.mute, maxWidth: 480, margin: "22px 0 0" },
  heroCtas: { display: "flex", gap: 14, marginTop: 30, alignItems: "center" },
  primaryBtn: {
    background: C.red, color: "#fff", border: "none", padding: "14px 26px",
    borderRadius: 999, fontSize: 15, fontWeight: 700,
    boxShadow: "0 8px 20px rgba(227,6,19,.28)", transition: "transform .15s ease",
  },
  ghostBtn: { color: C.ink, fontWeight: 600, fontSize: 15, padding: "14px 8px" },

  heroPanel: { display: "flex", justifyContent: "center" },
  preview: {
    width: "100%", maxWidth: 380, background: C.paper2, borderRadius: 18,
    border: `1px solid ${C.line}`, boxShadow: "0 24px 60px rgba(26,26,26,.12)",
    overflow: "hidden",
  },
  previewBar: {
    display: "flex", alignItems: "center", gap: 7, padding: "12px 16px",
    borderBottom: `1px solid ${C.line}`, background: "#fff",
  },
  dot: { width: 10, height: 10, borderRadius: 999, display: "inline-block" },
  previewTitle: { marginLeft: 8, fontSize: 13, fontWeight: 700, color: C.mute },
  previewBody: { padding: 16, display: "flex", flexDirection: "column", gap: 10, minHeight: 230 },
  bubbleUser: {
    alignSelf: "flex-end", background: C.ink, color: "#fff", padding: "10px 14px",
    borderRadius: "14px 14px 4px 14px", fontSize: 13.5, maxWidth: "85%",
  },
  bubbleBot: {
    alignSelf: "flex-start", background: C.paper, border: `1px solid ${C.line}`,
    padding: "11px 14px", borderRadius: "14px 14px 14px 4px", fontSize: 13, maxWidth: "90%",
  },
  previewMatch: { color: C.mute, marginTop: 4 },
  previewFix: { color: C.red, marginTop: 5, fontWeight: 600 },
  previewMeta: { textAlign: "center", fontSize: 11, color: C.mute, letterSpacing: 0.5 },

  how: { padding: "30px 0 20px" },
  howHead: { display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start", marginBottom: 34 },
  h2: { fontSize: 32, fontWeight: 800, letterSpacing: -0.8, margin: 0 },
  steps: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 22 },
  step: { background: C.paper2, border: `1px solid ${C.line}`, borderRadius: 16, padding: 26 },
  stepNum: { fontSize: 13, fontWeight: 800, color: C.red, letterSpacing: 1 },
  stepTitle: { fontSize: 18, fontWeight: 700, margin: "12px 0 8px" },
  stepText: { fontSize: 14.5, lineHeight: 1.6, color: C.mute, margin: 0 },

  coverage: { padding: "56px 0" },
  chips: { display: "flex", flexWrap: "wrap", gap: 12 },
  chip: {
    border: `1.5px solid ${C.line}`, background: C.paper2, borderRadius: 999,
    padding: "9px 18px", fontSize: 14, fontWeight: 600,
  },
  coverageNote: { color: C.mute, fontSize: 14, marginTop: 18, letterSpacing: 0.3 },

  footer: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "34px 0", borderTop: `1px solid ${C.line}`, marginTop: 20,
  },
  footNote: { color: C.mute, fontSize: 13 },

  // Auth
  authWrap: {
    minHeight: "100vh", display: "grid", gridTemplateColumns: "1fr 1fr",
  },
  authArt: {
    background: `linear-gradient(150deg, ${C.ink} 0%, #2a2a2a 100%)`,
    color: "#fff", padding: "60px 56px", display: "flex", flexDirection: "column",
    justifyContent: "center",
  },
  authArtTitle: { fontSize: 40, fontWeight: 800, margin: "26px 0 14px", letterSpacing: -1 },
  authArtText: { fontSize: 16, lineHeight: 1.6, color: "rgba(255,255,255,.7)", maxWidth: 360 },

  authPanel: {
    display: "flex", flexDirection: "column", justifyContent: "center",
    alignItems: "center", padding: "40px 24px", position: "relative",
  },
  backLink: {
    position: "absolute", top: 24, left: 24, background: "transparent",
    border: "none", color: C.mute, fontSize: 14, fontWeight: 600,
  },
  authCard: { width: "100%", maxWidth: 380 },
  cardTitle: { fontSize: 26, fontWeight: 800, margin: "0 0 6px", letterSpacing: -0.5 },
  cardSub: { fontSize: 14.5, color: C.mute, margin: "0 0 22px", lineHeight: 1.5 },

  field: { display: "block", marginBottom: 15 },
  fieldLabel: { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 7, color: C.ink },
  input: {
    width: "100%", padding: "12px 14px", borderRadius: 11, fontSize: 15,
    border: `1.5px solid ${C.line}`, background: "#fff", color: C.ink,
    transition: "border-color .15s ease, box-shadow .15s ease",
  },
  authBtn: {
    width: "100%", background: C.red, color: "#fff", border: "none",
    padding: "13px", borderRadius: 11, fontSize: 15, fontWeight: 700, marginTop: 6,
    boxShadow: "0 8px 20px rgba(227,6,19,.24)",
  },
  authLinks: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    marginTop: 16, fontSize: 13.5, flexWrap: "wrap", gap: 8,
  },
  linkBtn: { background: "none", border: "none", color: C.red, fontWeight: 700, fontSize: 13.5, padding: 0 },
  notice: { padding: "10px 13px", borderRadius: 10, fontSize: 13.5, marginBottom: 15, lineHeight: 1.5 },

  // Chat
  chatShell: { display: "flex", height: "100vh", background: C.paper },
  sidebar: {
    width: 270, borderRight: `1px solid ${C.line}`, background: "#fff",
    display: "flex", flexDirection: "column",
  },
  sideSection: { padding: "6px 12px" },
  sideLabel: {
    fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.2,
    color: C.mute, padding: "10px 10px 8px",
  },
  suggest: {
    display: "block", width: "100%", textAlign: "left", background: C.paper,
    border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 12px",
    fontSize: 13.5, color: C.ink, marginBottom: 8, lineHeight: 1.4,
  },
  userRow: { display: "flex", gap: 10, alignItems: "center", marginBottom: 12 },
  avatar: {
    width: 38, height: 38, borderRadius: 999, background: C.red, color: "#fff",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontWeight: 800, fontSize: 16, flexShrink: 0,
  },
  userName: { fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  userMail: { fontSize: 12, color: C.mute, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  signOut: {
    width: "100%", background: "transparent", border: `1.5px solid ${C.line}`,
    borderRadius: 10, padding: "10px", fontSize: 13.5, fontWeight: 600, color: C.ink,
  },

  chatMain: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0 },
  chatHead: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "18px 28px", borderBottom: `1px solid ${C.line}`, background: "#fff",
  },
  chatTitle: { fontSize: 18, fontWeight: 800, letterSpacing: -0.3 },
  chatSubtitle: { fontSize: 13, color: C.mute, marginTop: 2 },

  stream: { flex: 1, overflowY: "auto", padding: "28px", display: "flex", flexDirection: "column", gap: 18 },
  rowLeft: { display: "flex", justifyContent: "flex-start" },
  rowRight: { display: "flex", justifyContent: "flex-end" },
  userBubble: {
    background: C.ink, color: "#fff", padding: "12px 16px", borderRadius: "16px 16px 4px 16px",
    fontSize: 14.5, maxWidth: 560, lineHeight: 1.5,
  },
  botBubble: {
    background: "#fff", border: `1px solid ${C.line}`, padding: "12px 16px",
    borderRadius: "16px 16px 16px 4px", fontSize: 14.5, maxWidth: 620, lineHeight: 1.55,
    boxShadow: "0 4px 14px rgba(26,26,26,.05)",
  },

  hitIntro: { fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: C.mute, marginBottom: 12 },
  hitList: { display: "flex", flexDirection: "column", gap: 12 },
  hitCard: {
    background: "#fff", border: `1px solid ${C.line}`, borderLeft: `3px solid ${C.red}`,
    borderRadius: 12, padding: "14px 16px", maxWidth: 620,
    boxShadow: "0 4px 14px rgba(26,26,26,.05)",
  },
  hitTop: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 },
  hitRank: { fontSize: 12, fontWeight: 800, color: C.red },
  hitProduct: { fontSize: 14.5, fontWeight: 700 },
  hitCat: {
    fontSize: 11.5, fontWeight: 600, color: C.mute, border: `1px solid ${C.line}`,
    borderRadius: 999, padding: "2px 9px",
  },
  hitId: { fontSize: 12, color: C.mute, marginLeft: "auto", fontVariantNumeric: "tabular-nums" },
  hitDist: {
    fontSize: 11.5, fontWeight: 700, color: C.red, background: "#FDECEC",
    borderRadius: 999, padding: "2px 9px", fontVariantNumeric: "tabular-nums",
  },
  hitProblem: { fontSize: 14, color: C.ink, marginBottom: 10, lineHeight: 1.5 },
  hitGrid: { display: "grid", gridTemplateColumns: "auto 1fr", gap: "5px 12px", fontSize: 13.5 },
  hitKey: { color: C.mute, fontWeight: 600 },
  hitVal: { color: C.mute, lineHeight: 1.45 },

  tdot: { width: 7, height: 7, borderRadius: 999, background: C.mute, display: "inline-block" },

  composer: {
    display: "flex", gap: 12, padding: "16px 28px 22px", borderTop: `1px solid ${C.line}`,
    background: "#fff", alignItems: "center",
  },
  composerInput: {
    flex: 1, padding: "13px 16px", borderRadius: 999, fontSize: 15,
    border: `1.5px solid ${C.line}`, background: C.paper, color: C.ink,
  },
  sendBtn: {
    width: 46, height: 46, borderRadius: 999, background: C.red, border: "none",
    display: "flex", alignItems: "center", justifyContent: "center",
    boxShadow: "0 6px 16px rgba(227,6,19,.3)", transition: "opacity .15s ease", flexShrink: 0,
  },
};
