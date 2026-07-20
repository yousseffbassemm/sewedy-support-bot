import React, { useState, useEffect, useRef, useLayoutEffect, useContext, createContext } from "react";

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
// i18n — English / Arabic (RTL)
// ---------------------------------------------------------------------------
// Honest scope note: this translates the UI chrome. The actual search
// backend (MiniLM embeddings + your case corpus) is English-only, so the
// example queries stay in English — they need to retrieve real results,
// and translating them would silently break that. A query typed in Arabic
// will still reach the real backend, but won't match the English corpus
// well, same as any other out-of-domain query.
const TRANSLATIONS = {
  en: {
    navHow: "How it works",
    navCoverage: "Coverage",
    navSignIn: "Sign in",
    navContinue: (name) => `Continue as ${name}`,
    eyebrow: "Field Support · Internal Tool",
    heroLine1: "Answers from every",
    heroLine2: "resolved support case,",
    heroLine3: "in seconds.",
    heroSub:
      "SupportBot searches Elsewedy's device knowledge base by meaning, not just keywords — surfacing the closest past cases, their causes, and the fixes that worked.",
    getStarted: "Get started",
    openApp: "Open SupportBot",
    seeHow: "See how it works →",
    howTitle: "How it works",
    step1Title: "Ask in plain words",
    step1Text:
      "Describe the symptom the way an engineer would in the field. No error-code lookup tables needed.",
    step2Title: "Search by meaning",
    step2Text:
      "Every past case is embedded as a vector. SupportBot finds the closest matches — even with zero shared keywords.",
    step3Title: "Get the fix",
    step3Text:
      "See the matched case, its root cause, and the resolution that actually worked, ranked by closeness.",
    coverageTitle: "What it covers",
    coverageNote:
      "Connectivity · Configuration · Display · Power · Installation · Firmware · Mechanical · Measurement",
    footerNote: "Internal support tool · Demo build",
    previewLabel: "SupportBot",
    // Auth
    signInTitle: "Sign in",
    signInSub: "Welcome back. Pick up where you left off.",
    email: "Email",
    password: "Password",
    signInBtn: "Sign in",
    forgotLink: "Forgot password?",
    newHere: "New here?",
    createAccount: "Create account",
    createTitle: "Create account",
    createSub: "One minute, and SupportBot is yours.",
    username: "Username",
    continueBtn: "Continue",
    alreadyHave: "Already have an account?",
    forgotTitle: "Forgot password",
    forgotSub: "Enter your email and we'll send a reset code.",
    sendCode: "Send reset code",
    backToSignIn: "← Back to sign in",
    resetTitle: "Reset password",
    resetCodeLabel: "6-digit code",
    newPassword: "New password",
    updatePassword: "Update password",
    doneTitle: "Password updated",
    doneSub: "You can sign in with your new password now.",
    doneNotice: "All set — your password has been changed.",
    backToSignInBtn: "Back to sign in",
    backHome: "← Back",
    // Chat
    chatTitle: "SupportBot",
    chatSubtitle: (n) => `Searches by meaning across ${n} resolved cases`,
    live: "Live",
    tryAsking: "Try asking",
    signOut: "Sign out",
    composerPlaceholder: "Describe the issue…",
    send: "Send",
    suggestions: [
      "Readings drift higher after install",
      "Unit fails the compliance self-check",
      "Screen shows nothing after power on",
      "Device reboots randomly",
    ],
    previewMeta: (d) => `matched in 0.3s · cosine ${d}`,
    emptyHint:
      "Pick an example on the left, or describe your issue below — I'll surface the closest resolved cases.",
    welcome: (name) =>
      `Hi ${name || "there"} — describe a device issue and I'll find the closest resolved cases.`,
    searching: "Searching by meaning…",
    seeHowFound: "See how this was found",
    mapLoading: "Projecting the embedding space…",
    mapError: (msg) => `Couldn't load the map: ${msg}`,
    legendQuery: "Your query",
    legendMatch: "Retrieved match",
    legendOther: "Other cases in the corpus",
    mapCaption: (n) =>
      `${n} cases, projected from 384 dimensions down to 2 with PCA — distance here approximates, but doesn't replace, the real cosine search.`,
    langToggle: "العربية",
    authArtTagline: "Faster field resolutions, grounded in every case your team has already solved.",
    errInvalidEmail: "Enter a valid email address.",
    errPasswordShort: "Password must be at least 6 characters.",
    errUsernameShort: "Pick a username (2+ characters).",
    signingIn: "Signing in…",
    creatingAccount: "Creating account…",
    sendingCode: "Sending…",
    updating: "Updating…",
    atLeast6: "At least 6 characters",
    resetCodeSentPre: "Enter the code sent to",
    resetCodeSentPost: "and choose a new password.",
    consoleModeNotice:
      "Server is in console mode — no real email sent. Check the terminal running the backend for your code.",
    codeSentNotice: "Code sent — check your inbox (and spam).",
    serviceUnavailable: "Answer-writing service unavailable.",
    chatError: "Couldn't reach the chat service. Is the backend running?",
  },
  ar: {
    navHow: "كيف يعمل",
    navCoverage: "التغطية",
    navSignIn: "تسجيل الدخول",
    navContinue: (name) => `متابعة باسم ${name}`,
    eyebrow: "الدعم الميداني · أداة داخلية",
    heroLine1: "إجابات من كل حالة",
    heroLine2: "دعم تم حلّها،",
    heroLine3: "خلال ثوانٍ.",
    heroSub:
      "يبحث SupportBot في قاعدة معرفة الأجهزة الخاصة بالسويدي عبر المعنى، لا الكلمات المفتاحية فقط — ليعرض أقرب الحالات السابقة، وأسبابها، والحلول التي نجحت.",
    getStarted: "ابدأ الآن",
    openApp: "فتح SupportBot",
    seeHow: "← شاهد كيف يعمل",
    howTitle: "كيف يعمل",
    step1Title: "اسأل بكلماتك",
    step1Text: "صف العرض كما يفعل المهندس في الميدان. لا حاجة لجداول أكواد الأعطال.",
    step2Title: "بحث بالمعنى",
    step2Text:
      "كل حالة سابقة مخزّنة كمتجه رياضي. يجد SupportBot أقرب الحالات — حتى بدون أي كلمة مشتركة.",
    step3Title: "احصل على الحل",
    step3Text: "شاهد الحالة المطابقة، سببها الجذري، والحل الذي نجح فعلاً، مرتبة حسب القرب.",
    coverageTitle: "ما الذي تغطيه",
    coverageNote:
      "الاتصال · الإعدادات · الشاشة · الطاقة · التركيب · البرنامج الثابت · الميكانيكا · القياس",
    footerNote: "أداة دعم داخلية · نسخة تجريبية",
    previewLabel: "SupportBot",
    // Auth
    signInTitle: "تسجيل الدخول",
    signInSub: "أهلاً بعودتك. تابع من حيث توقفت.",
    email: "البريد الإلكتروني",
    password: "كلمة المرور",
    signInBtn: "تسجيل الدخول",
    forgotLink: "نسيت كلمة المرور؟",
    newHere: "جديد هنا؟",
    createAccount: "إنشاء حساب",
    createTitle: "إنشاء حساب",
    createSub: "دقيقة واحدة، و SupportBot أصبح لك.",
    username: "اسم المستخدم",
    continueBtn: "متابعة",
    alreadyHave: "لديك حساب بالفعل؟",
    forgotTitle: "نسيت كلمة المرور",
    forgotSub: "أدخل بريدك الإلكتروني وسنرسل رمز إعادة التعيين.",
    sendCode: "إرسال رمز إعادة التعيين",
    backToSignIn: "→ العودة لتسجيل الدخول",
    resetTitle: "إعادة تعيين كلمة المرور",
    resetCodeLabel: "رمز مكوّن من 6 أرقام",
    newPassword: "كلمة المرور الجديدة",
    updatePassword: "تحديث كلمة المرور",
    doneTitle: "تم تحديث كلمة المرور",
    doneSub: "يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة.",
    doneNotice: "تم — تم تغيير كلمة المرور بنجاح.",
    backToSignInBtn: "العودة لتسجيل الدخول",
    backHome: "→ رجوع",
    // Chat
    chatTitle: "SupportBot",
    chatSubtitle: (n) => `يبحث بالمعنى عبر ${n} حالة تم حلّها`,
    live: "متصل",
    tryAsking: "جرّب أن تسأل",
    signOut: "تسجيل الخروج",
    composerPlaceholder: "صف المشكلة…",
    send: "إرسال",
    suggestions: [
      "القراءات ترتفع تدريجياً بعد التركيب",
      "الوحدة تفشل في فحص المطابقة الذاتي",
      "الشاشة لا تعرض شيئاً بعد التشغيل",
      "الجهاز يعيد التشغيل بشكل عشوائي",
    ],
    previewMeta: (d) => `طوبِقت في 0.3 ثانية · جيب التمام ${d}`,
    emptyHint:
      "اختر مثالاً من القائمة، أو صف مشكلتك بالأسفل — وسأعرض أقرب الحالات التي تم حلّها.",
    welcome: (name) =>
      `مرحباً ${name || "بك"} — صف مشكلة الجهاز وسأجد أقرب الحالات التي تم حلّها.`,
    searching: "يبحث بالمعنى…",
    seeHowFound: "شاهد كيف تم إيجاد هذا",
    mapLoading: "جارٍ إسقاط فضاء المتجهات…",
    mapError: (msg) => `تعذّر تحميل الخريطة: ${msg}`,
    legendQuery: "سؤالك",
    legendMatch: "نتيجة مطابقة",
    legendOther: "حالات أخرى في قاعدة البيانات",
    mapCaption: (n) =>
      `${n} حالة، تم إسقاطها من 384 بُعداً إلى بُعدين باستخدام PCA — المسافة هنا تقريبية، ولا تُغني عن البحث الحقيقي بالتشابه الجيبي.`,
    langToggle: "English",
    authArtTagline: "حلول ميدانية أسرع، مبنية على كل حالة قام فريقك بحلّها بالفعل.",
    errInvalidEmail: "أدخل بريداً إلكترونياً صحيحاً.",
    errPasswordShort: "يجب ألا تقل كلمة المرور عن 6 أحرف.",
    errUsernameShort: "اختر اسم مستخدم (حرفان على الأقل).",
    signingIn: "جارٍ تسجيل الدخول…",
    creatingAccount: "جارٍ إنشاء الحساب…",
    sendingCode: "جارٍ الإرسال…",
    updating: "جارٍ التحديث…",
    atLeast6: "6 أحرف على الأقل",
    resetCodeSentPre: "أدخل الرمز المُرسَل إلى",
    resetCodeSentPost: "واختر كلمة مرور جديدة.",
    consoleModeNotice:
      "الخادم في وضع الطرفية — لم يُرسل بريد فعلي. تحقق من الطرفية التي تُشغّل الخادم للحصول على الرمز.",
    codeSentNotice: "تم إرسال الرمز — تحقق من بريدك (ومجلد الرسائل غير المرغوب فيها).",
    serviceUnavailable: "خدمة كتابة الإجابة غير متاحة.",
    chatError: "تعذّر الوصول إلى خدمة المحادثة. هل الخادم قيد التشغيل؟",
  },
};

// Backend HTTP errors arrive as English strings in `detail`. Map the known
// ones to Arabic so a user in Arabic mode never sees an English error. Dynamic
// messages (rate limit / lockout) are matched by prefix; anything unmapped
// falls through to the raw text (still better than hiding it).
const BACKEND_ERROR_AR = {
  "Incorrect email or password.": "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
  "An account with that email already exists.": "يوجد حساب بهذا البريد الإلكتروني بالفعل.",
  "Email not verified. Check your inbox for the code.":
    "لم يتم التحقق من البريد الإلكتروني. تحقق من بريدك للحصول على الرمز.",
  "No account found for that email.": "لا يوجد حساب بهذا البريد الإلكتروني.",
  "Incorrect code.": "الرمز غير صحيح.",
  "No pending reset for that email.": "لا يوجد طلب إعادة تعيين لهذا البريد.",
  "No pending verification for that email.": "لا يوجد طلب تحقق لهذا البريد.",
  "Code expired. Please sign up again.": "انتهت صلاحية الرمز. يرجى التسجيل مرة أخرى.",
  "Code expired. Request a new one.": "انتهت صلاحية الرمز. اطلب رمزاً جديداً.",
  "Username must be at least 2 characters.": "يجب ألا يقل اسم المستخدم عن حرفين.",
  "Password must be at least 6 characters.": "يجب ألا تقل كلمة المرور عن 6 أحرف.",
  "New password must be at least 6 characters.": "يجب ألا تقل كلمة المرور الجديدة عن 6 أحرف.",
  "Invalid or expired token.": "الجلسة غير صالحة أو منتهية الصلاحية.",
  "User not found.": "المستخدم غير موجود.",
  "Message must not be empty.": "الرسالة يجب ألا تكون فارغة.",
  "Query must not be empty.": "الاستعلام يجب ألا يكون فارغاً.",
};

function localizeError(msg, lang) {
  if (lang !== "ar" || !msg) return msg;
  if (BACKEND_ERROR_AR[msg]) return BACKEND_ERROR_AR[msg];
  if (msg.startsWith("Too many failed attempts"))
    return "محاولات فاشلة كثيرة جداً. تم قفل الحساب مؤقتاً — يرجى المحاولة لاحقاً.";
  if (msg.startsWith("Too many requests"))
    return "طلبات كثيرة جداً — يرجى الانتظار قليلاً ثم المحاولة مرة أخرى.";
  return msg;
}

const LangContext = createContext({ lang: "en", t: TRANSLATIONS.en, dir: "ltr", toggleLang: () => {} });
const useLang = () => useContext(LangContext);

// ---------------------------------------------------------------------------
// Logo — the real Elsewedy Electric mark (public/logo.png). `mono` renders it
// white for dark/branded backgrounds; `animateArc` gives it a soft reveal on
// the auth splash. Props are kept identical to the old inline-SVG version so
// every call site works unchanged.
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
        // The source art is black text + a red arc; invert it to solid white
        // for use on dark panels.
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

// Reveals its children with a rise+fade the moment they actually scroll into
// view, instead of animating once at page load (which had already finished
// long before you'd scrolled down to "How it works" or "Coverage").
function Reveal({ children, delay = 0, style }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect(); // reveal once; don't re-hide when scrolling away
        }
      },
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{
        ...style,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(28px)",
        transition: `opacity .7s cubic-bezier(.16,1,.3,1) ${delay}s, transform .7s cubic-bezier(.16,1,.3,1) ${delay}s`,
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Size of the indexed corpus — shown in the chat header. Matches the real
// clean-case count from ingestion (69 raw → 66 clean).
const CASE_COUNT = 66;

// ===========================================================================
// Root
// ===========================================================================
// Persisted UI state. Wrapped in try/catch because localStorage throws in
// private-browsing / blocked-cookie contexts — there we simply fall back to
// in-memory state rather than breaking the app.
const SESSION_KEY = "supportbot.session";
const LANG_KEY = "supportbot.lang";

function readStored(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — degrade to in-memory only */
  }
}

export default function App() {
  const [route, setRoute] = useState("landing"); // landing | auth | app
  // Restored from storage so a refresh doesn't sign the user out (the JWT is
  // valid for a week; an expired one simply fails the next API call).
  const [session, setSession] = useState(() => readStored(SESSION_KEY, null));
  const [lang, setLang] = useState(() => (readStored(LANG_KEY, "en") === "ar" ? "ar" : "en"));

  const dir = lang === "ar" ? "rtl" : "ltr";
  const t = TRANSLATIONS[lang];
  const toggleLang = () =>
    setLang((l) => {
      const next = l === "en" ? "ar" : "en";
      writeStored(LANG_KEY, next);
      return next;
    });

  const signIn = (user) => {
    setSession(user);
    writeStored(SESSION_KEY, user);
    setRoute("app");
  };
  const signOut = () => {
    setSession(null);
    writeStored(SESSION_KEY, null);
    setRoute("landing");
  };

  return (
    <LangContext.Provider value={{ lang, t, dir, toggleLang }}>
      <div style={styles.root} dir={dir} className={lang === "ar" ? "langAr" : "langEn"}>
        <GlobalStyle />
        <div key={route} className="pageIn">
          {route === "landing" && (
            <Landing session={session} onStart={() => setRoute(session ? "app" : "auth")} />
          )}
          {route === "auth" && <Auth onAuthed={signIn} onHome={() => setRoute("landing")} />}
          {route === "app" && (
            <Chat session={session} onHome={() => setRoute("landing")} onSignOut={signOut} />
          )}
        </div>
      </div>
    </LangContext.Provider>
  );
}

// ===========================================================================
// Landing
// ===========================================================================
function Landing({ onStart, session }) {
  const { t, dir, toggleLang } = useLang();
  return (
    <div style={styles.landingWrap}>
      <header style={styles.nav}>
        <div className="logoWiggle"><Logo height={30} /></div>
        <nav style={styles.navLinks}>
          <a style={styles.navLink} href="#how">{t.navHow}</a>
          <a style={styles.navLink} href="#cases">{t.navCoverage}</a>
          <button style={styles.langBtn} onClick={toggleLang}>{t.langToggle}</button>
          <button style={styles.navBtn} className="navBtn" onClick={onStart}>
            {session ? t.navContinue(session.username) : t.navSignIn}
          </button>
        </nav>
      </header>

      <section style={{ ...styles.hero, position: "relative" }} className="hero-grid">
        <div style={styles.heroInner}>
          <p style={styles.eyebrow} className="rise" >
            {t.eyebrow}
          </p>
          <h1 style={styles.h1} className="h1Mobile">
            <span className="rise d1">{t.heroLine1}</span>
            <br />
            <span className="rise d2">{t.heroLine2}</span>
            <br />
            <span className="rise d3" style={{ color: C.red }}>
              {t.heroLine3}
            </span>
          </h1>
          <div className="rise d4 arcAccent" style={{ margin: "22px 0 0", display: "inline-block" }}>
            <Arc width={150} />
          </div>
          <p style={styles.sub} className="rise d5">
            {t.heroSub}
          </p>
          <div style={styles.heroCtas} className="rise d6">
            <button style={styles.primaryBtn} className="primaryBtn" onClick={onStart}>
              {session ? t.openApp : t.getStarted}
            </button>
            <a style={styles.ghostBtn} className="ghostBtn" href="#how">
              {t.seeHow}
            </a>
          </div>
        </div>

        <div style={styles.heroPanel} className="floatIn">
          <div className="floatLoop">
            <MockChatPreview />
          </div>
        </div>
      </section>

      <section id="how" style={styles.how}>
        <Reveal>
          <div style={styles.howHead}>
            <h2 style={styles.h2}>{t.howTitle}</h2>
            <Arc width={110} />
          </div>
        </Reveal>
        <div style={styles.steps}>
          {[
            [t.step1Title, t.step1Text],
            [t.step2Title, t.step2Text],
            [t.step3Title, t.step3Text],
          ].map(([title, desc], i) => (
            <Reveal key={i} delay={i * 0.12}>
              <div style={styles.step} className="stepCard">
                <div style={styles.stepNum}>{String(i + 1).padStart(2, "0")}</div>
                <h3 style={styles.stepTitle}>{title}</h3>
                <p style={styles.stepText}>{desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="cases" style={styles.coverage}>
        <Reveal>
          <div style={styles.howHead}>
            <h2 style={styles.h2}>{t.coverageTitle}</h2>
            <Arc width={110} />
          </div>
        </Reveal>
        <div style={styles.chips}>
          {["AeroSense G2", "AeroSense G3", "ThermoNode T5", "PowerTrack P1", "GridLink Hub", "FlowMeter X100", "FlowMeter X200"].map(
            (p, i) => (
              <Reveal key={p} delay={i * 0.06} style={{ display: "inline-block" }}>
                <span style={styles.chip} className="chipHover" dir="ltr">
                  {p}
                </span>
              </Reveal>
            )
          )}
        </div>
        <Reveal delay={0.3}>
          <p style={styles.coverageNote}>
            {t.coverageNote}
          </p>
        </Reveal>
      </section>

      <footer style={styles.footer}>
        <Logo height={24} />
        <span style={styles.footNote}>
          {t.footerNote}
        </span>
      </footer>
    </div>
  );
}

// Rotating example conversations for the landing-page preview widget.
// Distances shown match what the real system actually returns for these
// exact queries (verified during Day 2) — this preview isn't hooked up to
// the live backend, but the numbers aren't made up either.
const PREVIEW_CONVOS = [
  {
    q: "Readings drift higher after install",
    dist: "0.374",
    hits: [
      { product: "AeroSense G3", category: "Connectivity", cause: "Sensor contaminated by dust ingress", fix: "Cleaned sensor chamber, replaced intake filter" },
      { product: "ThermoNode T5", category: "Installation", cause: "Thermal offset not calibrated" },
    ],
  },
  {
    q: "Unit fails the compliance self-check",
    dist: "0.398",
    hits: [
      { product: "PowerTrack P1", category: "Configuration", cause: "Configuration below the regional threshold", fix: "Applied the Policy 7 configuration profile" },
    ],
  },
  {
    q: "Screen shows nothing after power on",
    dist: "0.421",
    hits: [
      { product: "ThermoNode T5", category: "Display", cause: "Backlight fuse blown", fix: "Replaced the backlight fuse" },
    ],
  },
  {
    q: "Device reboots randomly",
    dist: "0.487",
    hits: [
      { product: "GridLink Hub", category: "Mechanical", cause: "Vibration loosening the terminal block", fix: "Re-torqued terminals, added thread-lock" },
    ],
  },
];

// Arabic parallel of the landing-page preview. Product names stay as-is
// (brand identifiers); everything else is translated so Arabic mode has no
// English leaking into the hero.
const PREVIEW_CONVOS_AR = [
  {
    q: "القراءات ترتفع تدريجياً بعد التركيب",
    dist: "0.374",
    hits: [
      { product: "AeroSense G3", category: "الاتصال", cause: "تلوّث المستشعر بدخول الغبار", fix: "تنظيف حجرة المستشعر واستبدال فلتر السحب" },
      { product: "ThermoNode T5", category: "التركيب", cause: "لم تتم معايرة الإزاحة الحرارية" },
    ],
  },
  {
    q: "الوحدة تفشل في فحص المطابقة الذاتي",
    dist: "0.398",
    hits: [
      { product: "PowerTrack P1", category: "الإعدادات", cause: "الإعدادات أقل من الحد الإقليمي", fix: "تطبيق ملف إعدادات السياسة 7" },
    ],
  },
  {
    q: "الشاشة لا تعرض شيئاً بعد التشغيل",
    dist: "0.421",
    hits: [
      { product: "ThermoNode T5", category: "الشاشة", cause: "احتراق منصهر الإضاءة الخلفية", fix: "استبدال منصهر الإضاءة الخلفية" },
    ],
  },
  {
    q: "الجهاز يعيد التشغيل بشكل عشوائي",
    dist: "0.487",
    hits: [
      { product: "GridLink Hub", category: "الميكانيكا", cause: "الاهتزاز يُرخي كتلة التوصيل", fix: "إعادة ربط الأطراف وإضافة مانع ارتخاء" },
    ],
  },
];

function MockChatPreview() {
  const { t, lang } = useLang();
  const convos = lang === "ar" ? PREVIEW_CONVOS_AR : PREVIEW_CONVOS;
  const [convoIdx, setConvoIdx] = useState(0);
  const [step, setStep] = useState(0); // 0=question only, 1=typing, 2..=hits revealed, last=meta
  const [phase, setPhase] = useState("entering"); // entering -> idle -> exiting
  const contentRef = useRef(null);
  const [boxHeight, setBoxHeight] = useState(null);
  const cardRef = useRef(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const convo = convos[convoIdx % convos.length];

  // Subtle mouse-tilt parallax — the card leans gently toward the cursor.
  // Mouse-only by nature (no mousemove on touch), so it degrades gracefully.
  const handleTiltMove = (e) => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: py * -7, y: px * 9 });
  };
  const handleTiltLeave = () => setTilt({ x: 0, y: 0 });

  // Measure the actual content height every time what's rendered changes,
  // and animate the WRAPPER to that height. This is what makes the box
  // itself glide to its new size instead of snapping — CSS can't transition
  // "height: auto", so we measure the real pixel height with a ref and
  // transition to that explicit number instead.
  useLayoutEffect(() => {
    if (contentRef.current) {
      setBoxHeight(contentRef.current.scrollHeight);
    }
  }, [step, convoIdx]);

  useEffect(() => {
    setStep(0);
    setPhase("entering");
    let cancelled = false;
    const timers = [];
    const after = (fn, delay) => {
      const t = setTimeout(() => !cancelled && fn(), delay);
      timers.push(t);
    };

    // Force the browser to paint the "entering" (offset + transparent) state
    // on its own frame BEFORE switching to "idle" — otherwise the opacity/
    // transform change happens in the same paint and there's nothing to
    // transition between.
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => !cancelled && setPhase("idle"));
      timers.push({ cancel: () => cancelAnimationFrame(raf2) });
    });

    let delay = 550;
    after(() => setStep(1), delay); // show typing dots
    convo.hits.forEach((_, i) => {
      delay += 950;
      after(() => setStep(2 + i), delay); // reveal each hit in turn
    });
    delay += 950;
    after(() => setStep(2 + convo.hits.length), delay); // show meta line
    delay += 2200; // hold the finished conversation on screen
    after(() => setPhase("exiting"), delay);
    delay += 650; // must be >= the content fade duration, or we cut it short
    after(() => setConvoIdx((c) => (c + 1) % convos.length), delay);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      timers.forEach((t) => (typeof t === "number" ? clearTimeout(t) : t.cancel()));
    };
  }, [convoIdx]);

  const contentStyle = {
    ...styles.previewBody,
    opacity: phase === "idle" ? 1 : 0,
    transform:
      phase === "exiting" ? "translateY(-14px)" : phase === "entering" ? "translateY(14px)" : "translateY(0)",
    transition: "opacity .6s ease, transform .6s ease",
  };

  return (
    <div
      ref={cardRef}
      style={{
        ...styles.preview,
        transform: `perspective(900px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
        transition: "transform .25s ease-out",
      }}
      onMouseMove={handleTiltMove}
      onMouseLeave={handleTiltLeave}
    >
      <div style={styles.previewBar}>
        <span style={{ ...styles.dot, background: "#FF5F56" }} />
        <span style={{ ...styles.dot, background: "#FFBD2E" }} />
        <span style={{ ...styles.dot, background: "#27C93F" }} />
        <span style={styles.previewTitle}>SupportBot</span>
      </div>
      <div
        style={{
          overflow: "hidden",
          transition: "height .45s cubic-bezier(.16,1,.3,1)",
          height: boxHeight != null ? `${boxHeight}px` : "auto",
        }}
      >
        <div ref={contentRef} style={contentStyle} dir={lang === "ar" ? "rtl" : "ltr"}>
          <div key={`q-${convoIdx}`} style={styles.bubbleUser}>
            {convo.q}
          </div>

          {step === 1 && (
            <div style={{ ...styles.bubbleBot, display: "flex", gap: 5, alignItems: "center" }} className="pop">
              <span style={styles.tdot} className="td1" />
              <span style={styles.tdot} className="td2" />
              <span style={styles.tdot} className="td3" />
            </div>
          )}

          {convo.hits.map(
            (h, i) =>
              step >= 2 + i && (
                <div key={`hit-${convoIdx}-${i}`} style={{ ...styles.bubbleBot, opacity: i === 0 ? 1 : 0.85 }} className="pop">
                  <strong>
                    {h.product} · {h.category}
                  </strong>
                  <div style={styles.previewMatch}>{h.cause}</div>
                  {h.fix && <div style={styles.previewFix}>→ {h.fix}</div>}
                </div>
              )
          )}

          {step >= 2 + convo.hits.length && (
            <div key={`meta-${convoIdx}`} style={styles.previewMeta} className="pop">
              {t.previewMeta(convo.dist)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Auth (login / signup / forgot-password) — DEMO
// ===========================================================================
function Auth({ onAuthed, onHome }) {
  const [mode, setMode] = useState("login"); // login | signup | forgot
  const { t } = useLang();
  return (
    <div style={styles.authWrap} className="auth-grid">
      <div style={styles.authArt} className="authArt auth-art-hide">
        <div style={{ position: "relative", zIndex: 2 }}>
          <Logo height={40} mono animateArc />
          <h2 style={styles.authArtTitle}>{t.chatTitle}</h2>
          <p style={styles.authArtText}>
            {t.authArtTagline}
          </p>
        </div>
        <div className="arcField" aria-hidden="true" />
      </div>

      <div style={styles.authPanel}>
        <button style={styles.backLink} onClick={onHome}>
          {t.backHome}
        </button>
        <div style={styles.authCard}>
          <div key={mode} className="pageIn">
            {mode === "login" && <Login onAuthed={onAuthed} switchTo={setMode} />}
            {mode === "signup" && <Signup onAuthed={onAuthed} switchTo={setMode} />}
            {mode === "forgot" && <Forgot switchTo={setMode} />}
          </div>
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
  return (
    <div
      style={{ ...styles.notice, background: bg, color: fg }}
      className={kind === "error" ? "noticeShake" : "pop"}
    >
      {children}
    </div>
  );
}

function Login({ onAuthed, switchTo }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const { t, lang } = useLang();

  const submit = async () => {
    setErr("");
    if (!emailOk(email)) return setErr(t.errInvalidEmail);
    setBusy(true);
    try {
      const r = await api("/auth/login", { email, password });
      onAuthed({ username: r.username, email: r.email, token: r.token });
    } catch (e) {
      setErr(localizeError(e.message, lang));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h3 style={styles.cardTitle}>{t.signInTitle}</h3>
      <p style={styles.cardSub}>{t.signInSub}</p>
      {err && <Notice kind="error">{err}</Notice>}
      <Field
        label={t.email}
        type="email"
        placeholder="you@elsewedy.com"
        dir="ltr"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Field
        label={t.password}
        type="password"
        placeholder="••••••••"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <button style={styles.authBtn} className="authBtnAnim" onClick={submit} disabled={busy}>
        {busy ? t.signingIn : t.signInBtn}
      </button>
      <div style={styles.authLinks}>
        <button style={styles.linkBtn} onClick={() => switchTo("forgot")}>
          {t.forgotLink}
        </button>
        <span style={{ color: C.mute }}>
          {t.newHere}{" "}
          <button style={styles.linkBtn} onClick={() => switchTo("signup")}>
            {t.createAccount}
          </button>
        </span>
      </div>
    </>
  );
}

function Signup({ onAuthed, switchTo }) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const { t, lang } = useLang();

  const submit = async () => {
    setErr("");
    if (username.trim().length < 2) return setErr(t.errUsernameShort);
    if (!emailOk(email)) return setErr(t.errInvalidEmail);
    if (password.length < 6) return setErr(t.errPasswordShort);
    setBusy(true);
    try {
      const r = await api("/auth/signup", { username, email, password });
      onAuthed({ username: r.username, email: r.email, token: r.token });
    } catch (e) {
      setErr(localizeError(e.message, lang));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h3 style={styles.cardTitle}>{t.createTitle}</h3>
      <p style={styles.cardSub}>{t.createSub}</p>
      {err && <Notice kind="error">{err}</Notice>}
      <Field
        label={t.username}
        placeholder="e.g. y.bassem"
        dir="ltr"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <Field
        label={t.email}
        type="email"
        placeholder="you@elsewedy.com"
        dir="ltr"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Field
        label={t.password}
        type="password"
        placeholder={t.atLeast6}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <button style={styles.authBtn} className="authBtnAnim" onClick={submit} disabled={busy}>
        {busy ? t.creatingAccount : t.createAccount}
      </button>
      <div style={styles.authLinks}>
        <span style={{ color: C.mute }}>
          {t.alreadyHave}{" "}
          <button style={styles.linkBtn} onClick={() => switchTo("login")}>
            {t.signInBtn}
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
  const { t, lang } = useLang();

  const send = async () => {
    setErr("");
    if (!emailOk(email)) return setErr(t.errInvalidEmail);
    setBusy(true);
    try {
      const r = await api("/auth/forgot", { email });
      setEmailMode(r.email_mode || "console");
      setStage("reset");
    } catch (e) {
      setErr(localizeError(e.message, lang));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setErr("");
    if (pw.length < 6) return setErr(t.errPasswordShort);
    setBusy(true);
    try {
      await api("/auth/reset", { email, code: entered, new_password: pw });
      setStage("done");
    } catch (e) {
      setErr(localizeError(e.message, lang));
    } finally {
      setBusy(false);
    }
  };

  if (stage === "done") {
    return (
      <>
        <h3 style={styles.cardTitle}>{t.doneTitle}</h3>
        <p style={styles.cardSub}>{t.doneSub}</p>
        <Notice kind="ok">{t.doneNotice}</Notice>
        <button style={styles.authBtn} className="authBtnAnim" onClick={() => switchTo("login")}>
          {t.backToSignInBtn}
        </button>
      </>
    );
  }

  if (stage === "reset") {
    return (
      <>
        <h3 style={styles.cardTitle}>{t.resetTitle}</h3>
        <p style={styles.cardSub}>
          {t.resetCodeSentPre} <strong dir="ltr">{email}</strong> {t.resetCodeSentPost}
        </p>
        {emailMode === "console" ? (
          <Notice kind="info">{t.consoleModeNotice}</Notice>
        ) : (
          <Notice kind="ok">{t.codeSentNotice}</Notice>
        )}
        {err && <Notice kind="error">{err}</Notice>}
        <Field
          label={t.resetCodeLabel}
          inputMode="numeric"
          maxLength={6}
          placeholder="••••••"
          dir="ltr"
          value={entered}
          onChange={(e) => setEntered(e.target.value.replace(/\D/g, ""))}
        />
        <Field
          label={t.newPassword}
          type="password"
          placeholder={t.atLeast6}
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && reset()}
        />
        <button style={styles.authBtn} className="authBtnAnim" onClick={reset} disabled={busy}>
          {busy ? t.updating : t.updatePassword}
        </button>
      </>
    );
  }

  return (
    <>
      <h3 style={styles.cardTitle}>{t.forgotTitle}</h3>
      <p style={styles.cardSub}>
        {t.forgotSub}
      </p>
      {err && <Notice kind="error">{err}</Notice>}
      <Field
        label={t.email}
        type="email"
        placeholder="you@elsewedy.com"
        dir="ltr"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && send()}
      />
      <button style={styles.authBtn} className="authBtnAnim" onClick={send} disabled={busy}>
        {busy ? t.sendingCode : t.sendCode}
      </button>
      <div style={styles.authLinks}>
        <button style={styles.linkBtn} onClick={() => switchTo("login")}>
          {t.backToSignIn}
        </button>
      </div>
    </>
  );
}

// ===========================================================================
// Chat app
// ===========================================================================
function Chat({ session, onHome, onSignOut }) {
  const { t, lang, toggleLang } = useLang();
  const [messages, setMessages] = useState([
    {
      who: "bot",
      kind: "text",
      text: t.welcome(session?.username),
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false); // mobile sidebar drawer
  const scroller = useRef(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  // Keep the opening welcome bubble in the active language: it's created once
  // at mount, so a later language toggle would otherwise leave it stranded.
  useEffect(() => {
    setMessages((m) =>
      m.length === 1 && m[0].who === "bot" && m[0].kind === "text"
        ? [{ ...m[0], text: t.welcome(session?.username) }]
        : m
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  const send = async () => {
    const q = input.trim();
    if (!q || busy) return;
    // Greet only on the very first question: true iff no user message has been
    // sent yet this chat. The opening bubble is the bot's own, so it doesn't count.
    const isFirst = !messages.some((m) => m.who === "user");
    // Recent turns for conversational memory, so a follow-up ("and it still
    // fails") has context. Only real text turns, last 6, mapped to {role,text}.
    const history = messages
      .filter((m) => m.text && (m.kind === "text" || m.kind === "answer"))
      .slice(-6)
      .map((m) => ({ role: m.who, text: m.text }));
    setMessages((m) => [...m, { who: "user", kind: "text", text: q }]);
    setInput("");
    setBusy(true);
    try {
      const r = await api("/chat", { query: q, first: isFirst, history });
      setBusy(false);
      setMessages((m) => [
        ...m,
        { who: "bot", kind: "answer", text: r.reply, hits: r.hits, grounded: r.grounded, query: q },
      ]);
    } catch (e) {
      setBusy(false);
      setMessages((m) => [
        ...m,
        {
          who: "bot",
          kind: "empty",
          text: t.chatError,
        },
      ]);
    }
  };

  // Example queries, localized. Each is backed by a real resolved case in the
  // corpus. The backend translates a non-English query to English before
  // retrieval (translate_to_english), so the Arabic versions still match.
  const suggestions = t.suggestions;

  return (
    <div style={styles.chatShell}>
      <div
        className={`chatBackdrop${menuOpen ? " open" : ""}`}
        onClick={() => setMenuOpen(false)}
        aria-hidden="true"
      />
      <aside style={styles.sidebar} className={`chatSidebar${menuOpen ? " open" : ""}`}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 18px 0" }}>
          <button
            onClick={onHome}
            className="logoWiggle"
            title="Back to home"
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
          >
            <Logo height={38} />
          </button>
          <button style={styles.langBtnSmall} onClick={toggleLang}>{t.langToggle}</button>
        </div>
        <div style={styles.sideSection}>
          <div style={styles.sideLabel}>{t.tryAsking}</div>
          {suggestions.map((s, i) => (
            <button
              key={s}
              style={{ ...styles.suggest, animationDelay: `${0.15 + i * 0.08}s` }}
              className="suggestBtn rise"
              dir={lang === "ar" ? "rtl" : "ltr"}
              onClick={() => {
                setInput(s);
                setMenuOpen(false);
              }}
            >
              {s}
            </button>
          ))}
        </div>
        <div style={{ marginTop: "auto", padding: 18, borderTop: `1px solid ${C.line}` }}>
          <div style={styles.userRow}>
            <div style={styles.avatar} className="avatarHover">
              {(session?.username || "U").slice(0, 1).toUpperCase()}
            </div>
            <div style={{ overflow: "hidden" }}>
              <div style={styles.userName}>{session?.username}</div>
              <div style={styles.userMail} dir="ltr">{session?.email}</div>
            </div>
          </div>
          <button style={styles.signOut} className="signOutBtn" onClick={onSignOut}>
            {t.signOut}
          </button>
        </div>
      </aside>

      <main style={styles.chatMain}>
        <header style={styles.chatHead}>
          <div style={styles.chatHeadInner} className="chatPad">
            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
              <button
                className="mobileMenuBtn"
                aria-label="Menu"
                onClick={() => setMenuOpen(true)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              </button>
              <div style={{ minWidth: 0 }}>
                <div style={styles.chatTitle}>{t.chatTitle}</div>
                <div style={styles.chatSubtitle}>
                  {t.chatSubtitle(CASE_COUNT)}
                </div>
              </div>
            </div>
            <div style={styles.livePill}>
              <span style={styles.liveDot} className="livePulse" />
              {t.live}
            </div>
          </div>
        </header>

        <div ref={scroller} style={styles.stream} className="themedScroll chatPad">
          <div style={styles.streamInner}>
            {messages.map((m, i) => (
              <Message key={i} m={m} />
            ))}
            {messages.filter((m) => m.who === "user").length === 0 && !busy && (
              <div style={styles.emptyWrap} className="emptyFade">
                <div className="emptyArc">
                  <Arc width={150} />
                </div>
                <div style={styles.emptyHint}>{t.emptyHint}</div>
              </div>
            )}
            {busy && <Typing />}
          </div>
        </div>

        <div style={styles.composer} className="chatPad">
          <div style={styles.composerInner}>
            <input
              style={styles.composerInput}
              placeholder={t.composerPlaceholder}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
            />
            <button
              style={{ ...styles.sendBtn, opacity: input.trim() && !busy ? 1 : 0.5 }}
              onClick={send}
              aria-label={t.send}
              className="sendBtn"
            >
              <SendArc />
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

// A line that opens with a short label, e.g. "Problem: readings drift".
// The label is matched rather than hardcoded to Problem/Resolution so an
// Arabic reply, whose labels come back translated, styles identically. The
// length cap keeps ordinary prose that merely contains a colon ("Couldn't
// reach the service: ...") from being mistaken for a label.
const LABEL_LINE = /^([^\s:][^:\n]{0,24}):\s*(.*)$/;

// The reply arrives as plain text laid out in "Problem:" / "Resolution:"
// lines separated by blank lines. HTML collapses newlines, so that layout has
// to be rebuilt as real elements or the whole answer renders as one run-on
// paragraph -- which is what it did before.
function FormattedReply({ text }) {
  const blocks = String(text ?? "").trim().split(/\n\s*\n+/);

  return blocks.map((block, blockIndex) => (
    <div key={blockIndex} style={blockIndex > 0 ? styles.replyBlock : undefined}>
      {block.split("\n").map((line, lineIndex) => {
        const labelled = line.match(LABEL_LINE);
        return (
          <div key={lineIndex}>
            {labelled ? (
              <>
                <strong>{labelled[1]}:</strong> {labelled[2]}
              </>
            ) : (
              line
            )}
          </div>
        );
      })}
    </div>
  ));
}

// Copy the answer text to the clipboard — handy for pasting a resolution into
// a ticket. Bilingual, with a brief "copied" confirmation.
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const { lang } = useLang();
  const label = lang === "ar" ? (copied ? "تم النسخ" : "نسخ") : copied ? "Copied" : "Copy";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked (insecure context) — nothing useful to show */
    }
  };
  return (
    <button onClick={copy} className="answerBtn" title={label}>
      <span aria-hidden="true">{copied ? "✓" : "⧉"}</span>
      {label}
    </button>
  );
}

// Thumbs up/down on a grounded answer -> POST /feedback. Anonymous; fire and
// forget (a failed vote must never disrupt the chat). Closes the quality loop.
function AnswerFeedback({ query, caseId }) {
  const [voted, setVoted] = useState(null); // "up" | "down" | null
  const { lang } = useLang();
  const txt =
    lang === "ar"
      ? { prompt: "هل كان هذا مفيدًا؟", thanks: "شكرًا على ملاحظتك!" }
      : { prompt: "Was this helpful?", thanks: "Thanks for your feedback!" };

  const send = async (vote) => {
    if (voted) return;
    setVoted(vote);
    try {
      await api("/feedback", { query, vote, case_id: caseId || null });
    } catch {
      /* a lost vote is not worth surfacing to the user */
    }
  };

  if (voted) {
    return <span style={{ fontSize: 12, color: C.mute }}>{txt.thanks}</span>;
  }
  return (
    <>
      <span style={{ fontSize: 12, color: C.mute, marginInlineStart: 2 }}>{txt.prompt}</span>
      <button className="answerBtn up" onClick={() => send("up")} aria-label="Helpful" title="Helpful">👍</button>
      <button className="answerBtn down" onClick={() => send("down")} aria-label="Not helpful" title="Not helpful">👎</button>
    </>
  );
}

function Message({ m }) {
  const { t } = useLang();
  if (m.who === "user") {
    return (
      <div style={styles.rowRight}>
        <div style={styles.userBubble} className="userBubbleIn">{m.text}</div>
      </div>
    );
  }
  if (m.kind === "text" || m.kind === "empty") {
    return (
      <div style={styles.rowLeft}>
        <div style={styles.botBubble} className="pop botBubbleHover">
          <FormattedReply text={m.text} />
        </div>
      </div>
    );
  }
  // answer — Gemini's grounded reply, plus an optional "see how this was
  // found" disclosure showing the real embedding-space geometry.
  return (
    <div style={styles.rowLeft}>
      <div style={{ maxWidth: 660 }}>
        <div style={styles.botBubble} className="pop botBubbleHover">
          <FormattedReply text={m.text} />
          {m.grounded === false && (
            <div style={styles.fallbackNote}>{t.serviceUnavailable}</div>
          )}
        </div>
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <CopyButton text={m.text} />
          {m.hits && m.hits.length > 0 && (
            <>
              <span style={{ width: 1, height: 16, background: C.line, margin: "0 2px" }} aria-hidden="true" />
              <AnswerFeedback query={m.query} caseId={m.hits[0]?.case_id} />
            </>
          )}
        </div>
        {m.query && <EmbeddingMapView query={m.query} />}
      </div>
    </div>
  );
}

// The signature feature: shows the REAL embedding-space geometry behind a
// search — where the query landed relative to every case, and which ones
// were the actual retrieved matches. Collapsed by default (restraint —
// this is the one bold element, not something to force on every message).
function EmbeddingMapView({ query }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState("idle"); // idle | loading | ready | error
  const [data, setData] = useState(null);
  const [errMsg, setErrMsg] = useState("");
  const { t, dir } = useLang();

  const toggle = async () => {
    if (!open && state === "idle") {
      setState("loading");
      try {
        const r = await api("/embedding_map", { query });
        setData(r);
        setState("ready");
      } catch (e) {
        setErrMsg(e.message);
        setState("error");
      }
    }
    setOpen((o) => !o);
  };

  const arrow = open ? "▾" : dir === "rtl" ? "◂" : "▸";

  return (
    <div style={{ marginTop: 8 }}>
      <button style={styles.mapToggle} onClick={toggle}>
        {arrow} {t.seeHowFound}
      </button>
      {open && (
        <div style={styles.mapPanel} className="pop">
          {state === "loading" && (
            <div style={styles.mapLoading}>
              <span style={styles.tdot} className="td1" />
              <span style={styles.tdot} className="td2" />
              <span style={styles.tdot} className="td3" />
              <span style={{ marginInlineStart: 8 }}>{t.mapLoading}</span>
            </div>
          )}
          {state === "error" && (
            <div style={styles.mapLoading}>{t.mapError(errMsg)}</div>
          )}
          {state === "ready" && data && <EmbeddingScatter data={data} />}
        </div>
      )}
    </div>
  );
}

// Renders the PCA-projected points as an SVG scatter: grey dots for the
// full corpus, red dots for the actual retrieved matches, a black diamond
// for the query itself, with thin lines connecting the query to each hit.
// The SVG geometry itself is never mirrored for RTL (a scatter plot's axes
// aren't a reading-direction concept) — only the surrounding text is.
function EmbeddingScatter({ data }) {
  const { t } = useLang();
  const { query_point, points } = data;
  const allX = [query_point.x, ...points.map((p) => p.x)];
  const allY = [query_point.y, ...points.map((p) => p.y)];
  const minX = Math.min(...allX), maxX = Math.max(...allX);
  const minY = Math.min(...allY), maxY = Math.max(...allY);
  const pad = 24;
  const W = 460, H = 260;

  const sx = (x) => pad + ((x - minX) / (maxX - minX || 1)) * (W - 2 * pad);
  const sy = (y) => H - pad - ((y - minY) / (maxY - minY || 1)) * (H - 2 * pad);

  const qx = sx(query_point.x), qy = sy(query_point.y);
  const hits = points.filter((p) => p.is_hit);

  return (
    <div dir="ltr">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
        {hits.map((h) => (
          <line
            key={`line-${h.id}`}
            x1={qx} y1={qy} x2={sx(h.x)} y2={sy(h.y)}
            stroke={C.red} strokeWidth="1" strokeOpacity="0.35" strokeDasharray="3 3"
          />
        ))}
        {points.map((p) => (
          <circle
            key={p.id}
            cx={sx(p.x)} cy={sy(p.y)}
            r={p.is_hit ? 5.5 : 3.5}
            fill={p.is_hit ? C.red : "#C9C6C0"}
            opacity={p.is_hit ? 1 : 0.55}
          >
            <title>{`${p.product} · ${p.category}`}</title>
          </circle>
        ))}
        <path
          d={`M${qx - 6} ${qy} L${qx} ${qy - 6} L${qx + 6} ${qy} L${qx} ${qy + 6} Z`}
          fill={C.ink}
        >
          <title>{t.legendQuery}</title>
        </path>
      </svg>
      <div style={styles.mapLegend}>
        <span><span style={{ ...styles.legendSwatch, background: C.ink, borderRadius: 2, transform: "rotate(45deg)" }} /> {t.legendQuery}</span>
        <span><span style={{ ...styles.legendSwatch, background: C.red }} /> {t.legendMatch}</span>
        <span><span style={{ ...styles.legendSwatch, background: "#C9C6C0" }} /> {t.legendOther}</span>
      </div>
      <p style={styles.mapCaption}>
        {t.mapCaption(points.length)}
      </p>
    </div>
  );
}

function Typing() {
  const { t } = useLang();
  return (
    <div style={styles.rowLeft}>
      <div style={styles.searchingBox}>
        <div style={styles.searchingScan} className="searchScan" />
        <span style={styles.searchingText}>
          <span style={styles.tdot} className="td1" />
          <span style={styles.tdot} className="td2" />
          <span style={styles.tdot} className="td3" />
          <span style={{ marginInlineStart: 8 }}>{t.searching}</span>
        </span>
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
      @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800&display=swap');

      * { box-sizing: border-box; }
      html, body, #root { margin: 0; height: 100%; }
      html { scroll-behavior: smooth; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        color: ${C.ink};
        background: ${C.paper};
        -webkit-font-smoothing: antialiased;
      }
      .langAr {
        font-family: "Cairo", -apple-system, "Segoe UI", Tahoma, Arial, sans-serif;
      }
      button { font-family: inherit; cursor: pointer; }
      a { text-decoration: none; }

      @keyframes drawArc { to { stroke-dashoffset: 0; } }
      @keyframes logoReveal {
        from { opacity: 0; transform: translateY(8px) scale(0.98); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes riseUp {
        from { opacity: 0; transform: translateY(22px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes floatIn {
        from { opacity: 0; transform: translateY(30px) scale(0.96); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes popIn {
        from { opacity: 0; transform: translateY(14px) scale(0.9); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes bob { 0%,100% { transform: translateY(0);} 50% { transform: translateY(-8px);} }
      @keyframes bobSlow { 0%,100% { transform: translateY(0) rotate(0deg);} 50% { transform: translateY(-10px) rotate(0.6deg);} }
      @keyframes arcDrift {
        0% { transform: translate(0,0) rotate(0deg); }
        100% { transform: translate(0,-14px) rotate(3deg); }
      }
      @keyframes pageIn {
        from { opacity: 0; transform: translateY(14px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes pulseGlow {
        0%,100% { box-shadow: 0 8px 20px rgba(227,6,19,.28); }
        50%     { box-shadow: 0 10px 30px rgba(227,6,19,.48); }
      }
      @keyframes shimmerArc {
        0%,100% { opacity: .55; transform: scaleX(1); }
        50%     { opacity: 1;   transform: scaleX(1.06); }
      }
      @keyframes wiggle {
        0%,100% { transform: rotate(0deg); }
        25%     { transform: rotate(-2deg); }
        75%     { transform: rotate(2deg); }
      }
      @keyframes shake {
        10%, 90% { transform: translateX(-1px); }
        20%, 80% { transform: translateX(2px); }
        30%, 50%, 70% { transform: translateX(-4px); }
        40%, 60% { transform: translateX(4px); }
      }
      @keyframes livePulseKf {
        0%, 100% { box-shadow: 0 0 0 0 rgba(31,157,85,.5); }
        50%      { box-shadow: 0 0 0 5px rgba(31,157,85,0); }
      }
      @keyframes searchScanKf {
        0%   { left: -40%; }
        100% { left: 100%; }
      }
      .livePulse { animation: livePulseKf 2s ease-in-out infinite; }
      .searchScan { animation: searchScanKf 1.1s ease-in-out infinite; }
      .rise { opacity: 0; animation: riseUp .75s cubic-bezier(.16,1,.3,1) forwards; }
      .d1 { animation-delay: .05s } .d2 { animation-delay: .14s }
      .d3 { animation-delay: .23s } .d4 { animation-delay: .34s }
      .d5 { animation-delay: .45s } .d6 { animation-delay: .56s }
      .floatIn { opacity: 0; animation: floatIn 1s cubic-bezier(.16,1,.3,1) forwards .35s; }
      .floatLoop { animation: bobSlow 5s ease-in-out infinite; }
      .pop { animation: popIn .5s cubic-bezier(.34,1.56,.64,1) both; }
      .pageIn { animation: pageIn .5s cubic-bezier(.16,1,.3,1) both; }

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

      /* ---- real hover / press interactions (need actual classes) ---- */
      .primaryBtn { transition: transform .18s cubic-bezier(.34,1.56,.64,1), box-shadow .2s ease; animation: pulseGlow 3s ease-in-out infinite; }
      .primaryBtn:hover { transform: translateY(-3px) scale(1.03); }
      .primaryBtn:active { transform: translateY(-1px) scale(.97); }

      .ghostBtn { transition: transform .15s ease, opacity .15s ease; display: inline-block; }
      .ghostBtn:hover { transform: translateX(3px); opacity: .7; }

      .navBtn { transition: transform .15s ease, background .15s ease, color .15s ease; }
      .navBtn:hover { transform: translateY(-2px); background: ${C.ink}; color: #fff; }

      .suggestBtn { transition: transform .18s cubic-bezier(.34,1.56,.64,1), border-color .15s ease, box-shadow .2s ease; }
      .suggestBtn:hover { transform: translateX(4px) scale(1.02); border-color: ${C.red}; box-shadow: 0 6px 16px rgba(227,6,19,.12); }

      .hitCardHover { transition: transform .2s cubic-bezier(.34,1.56,.64,1), box-shadow .2s ease; }
      .hitCardHover:hover { transform: translateY(-3px) scale(1.015); box-shadow: 0 12px 28px rgba(26,26,26,.1); }

      .chipHover { transition: transform .18s cubic-bezier(.34,1.56,.64,1), box-shadow .2s ease, border-color .15s ease; }
      .chipHover:hover { transform: translateY(-3px) scale(1.05); border-color: ${C.red}; box-shadow: 0 8px 20px rgba(227,6,19,.22); }

      .stepCard { transition: transform .25s cubic-bezier(.34,1.56,.64,1), box-shadow .25s ease; }
      .stepCard:hover { transform: translateY(-6px); box-shadow: 0 16px 34px rgba(26,26,26,.1); }

      .sendBtn { transition: transform .15s cubic-bezier(.34,1.56,.64,1); }
      .sendBtn:hover { transform: scale(1.08) rotate(4deg); }
      .sendBtn:active { transform: scale(.9); }

      .logoWiggle:hover svg { animation: wiggle .4s ease; }

      .arcAccent { animation: shimmerArc 2.4s ease-in-out infinite; transform-origin: center; }

      .noticeShake { animation: shake .5s cubic-bezier(.36,.07,.19,.97) both, popIn .3s ease both; }

      .themedScroll::-webkit-scrollbar { width: 8px; height: 8px; }
      .themedScroll::-webkit-scrollbar-track { background: transparent; }
      .themedScroll::-webkit-scrollbar-thumb { background: rgba(227,6,19,.22); border-radius: 999px; }
      .themedScroll::-webkit-scrollbar-thumb:hover { background: rgba(227,6,19,.4); }

      .avatarHover { transition: transform .2s cubic-bezier(.34,1.56,.64,1), box-shadow .2s ease; }
      .avatarHover:hover { transform: scale(1.08); box-shadow: 0 0 0 4px rgba(227,6,19,.15); }

      .authBtnAnim { transition: transform .18s cubic-bezier(.34,1.56,.64,1), box-shadow .2s ease; }
      .authBtnAnim:hover { transform: translateY(-2px); box-shadow: 0 12px 26px rgba(227,6,19,.32); }
      .authBtnAnim:active { transform: translateY(0) scale(.98); }

      .signOutBtn { transition: transform .15s ease, border-color .15s ease; }
      .signOutBtn:hover { transform: translateY(-2px); border-color: ${C.red}; color: ${C.red}; }

      .userBubbleIn { animation: popIn .35s cubic-bezier(.34,1.56,.64,1) both; }

      input:focus { outline: none; border-color: ${C.red} !important; box-shadow: 0 0 0 3px rgba(227,6,19,.12); }

      ::selection { background: rgba(227,6,19,.16); }

      /* Keyboard focus only (not on mouse click): a branded ring so the whole
         app is navigable by keyboard, which it previously wasn't visibly. */
      button:focus-visible, a:focus-visible, [tabindex]:focus-visible {
        outline: 2px solid ${C.red};
        outline-offset: 2px;
        border-radius: 10px;
      }

      /* Unified answer-toolbar buttons (copy / thumbs) — ghost, not boxed. */
      .answerBtn {
        background: transparent; border: 1px solid transparent; border-radius: 9px;
        color: ${C.mute}; font-size: 12px; padding: 5px 10px;
        display: inline-flex; align-items: center; gap: 5px; line-height: 1;
        transition: background .16s ease, color .16s ease, transform .16s cubic-bezier(.34,1.56,.64,1);
      }
      .answerBtn:hover { background: rgba(26,26,26,.055); color: ${C.ink}; transform: translateY(-1px); }
      .answerBtn.up:hover { background: rgba(31,157,85,.13); color: ${C.ok}; }
      .answerBtn.down:hover { background: rgba(227,6,19,.10); color: ${C.red}; }
      .answerBtn:active { transform: scale(.92); }

      /* Answer bubbles lift a touch on hover — subtle depth, not a toy. */
      .botBubbleHover { transition: box-shadow .28s ease, transform .28s ease; }
      .botBubbleHover:hover { transform: translateY(-2px); box-shadow: 0 14px 34px rgba(26,26,26,.10), 0 2px 8px rgba(26,26,26,.05); }

      @keyframes floatArc {
        0%,100% { transform: translateY(0) scaleX(1); opacity: .5; }
        50%     { transform: translateY(-7px) scaleX(1.05); opacity: .8; }
      }
      .emptyArc { animation: floatArc 4.5s ease-in-out infinite; }
      .emptyFade { animation: floatIn 1.1s cubic-bezier(.16,1,.3,1) both .15s; }

      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { animation: none !important; transition: none !important; }
        .rise, .floatIn, .pop, .pageIn { opacity: 1 !important; }
        html { scroll-behavior: auto; }
      }

      /* --- mobile drawer (chat sidebar) --- */
      .mobileMenuBtn { display: none; }
      .chatBackdrop { display: none; }
      @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }

      @media (max-width: 900px) {
        .hero-grid { grid-template-columns: 1fr !important; }
        .auth-grid { grid-template-columns: 1fr !important; }
        .auth-art-hide { display: none !important; }

        .mobileMenuBtn {
          display: inline-flex !important; align-items: center; justify-content: center;
          width: 40px; height: 40px; border-radius: 11px; border: 1.5px solid ${C.line};
          background: #fff; color: ${C.ink}; flex-shrink: 0;
          transition: border-color .15s ease, transform .15s ease;
        }
        .mobileMenuBtn:hover { border-color: ${C.red}; }
        .mobileMenuBtn:active { transform: scale(.94); }

        .chatSidebar {
          position: fixed; top: 0; bottom: 0; inset-inline-start: 0; z-index: 60;
          width: 284px; max-width: 82vw;
          transform: translateX(-110%);
          transition: transform .34s cubic-bezier(.16,1,.3,1);
          box-shadow: 0 0 50px rgba(0,0,0,.28);
        }
        [dir="rtl"] .chatSidebar { transform: translateX(110%); }
        .chatSidebar.open { transform: translateX(0) !important; }

        .chatBackdrop.open {
          display: block; position: fixed; inset: 0; z-index: 55;
          background: rgba(20,18,16,.45); backdrop-filter: blur(2px);
          animation: fadeIn .25s ease both;
        }

        .chatPad { padding-inline: 16px !important; }
        .h1Mobile { font-size: 40px !important; }
      }

      @media (max-width: 520px) {
        .h1Mobile { font-size: 33px !important; }
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
  langBtn: {
    border: `1.5px solid ${C.line}`, background: "transparent", color: C.mute,
    padding: "8px 14px", borderRadius: 999, fontSize: 13, fontWeight: 600,
  },
  langBtnSmall: {
    border: `1.5px solid ${C.line}`, background: "transparent", color: C.mute,
    padding: "5px 11px", borderRadius: 999, fontSize: 11.5, fontWeight: 700,
  },

  hero: {
    display: "grid", gridTemplateColumns: "1.05fr .95fr", gap: 40,
    alignItems: "center", padding: "40px 0 70px",
  },
  heroInner: { position: "relative", zIndex: 1 },
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

  heroPanel: { display: "flex", justifyContent: "center", position: "relative", zIndex: 1 },
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
  previewBody: { padding: 16, display: "flex", flexDirection: "column", gap: 10 },
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
    minHeight: "100vh", width: "100%", display: "grid", gridTemplateColumns: "1fr 1fr",
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
    background: "#FFFFFF",
  },
  backLink: {
    position: "absolute", top: 24, insetInlineStart: 24, background: "transparent",
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

  chatMain: {
    flex: 1, display: "flex", flexDirection: "column", minWidth: 0,
    background:
      "radial-gradient(1100px 460px at 82% -12%, rgba(227,6,19,.055), transparent 62%)," +
      "radial-gradient(820px 480px at -8% 112%, rgba(26,26,26,.04), transparent 60%)," +
      "linear-gradient(180deg, #FAFAF8 0%, #F4F2EE 100%)",
  },
  chatHead: {
    padding: "0 28px", borderBottom: `1px solid ${C.line}`, background: "#fff",
  },
  chatHeadInner: {
    width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "18px 0", maxWidth: 820, marginLeft: "auto", marginRight: "auto",
  },
  chatTitle: { fontSize: 18, fontWeight: 800, letterSpacing: -0.3 },
  chatSubtitle: { fontSize: 13, color: C.mute, marginTop: 2 },
  livePill: {
    display: "flex", alignItems: "center", gap: 7, padding: "6px 13px",
    borderRadius: 999, border: `1px solid ${C.line}`, background: "#fff",
    fontSize: 12, fontWeight: 700, color: C.ink, letterSpacing: 0.3,
  },
  liveDot: { width: 7, height: 7, borderRadius: 999, background: C.ok, display: "inline-block" },
  searchingBox: {
    position: "relative", overflow: "hidden",
    background: "#fff", border: `1px solid ${C.line}`,
    padding: "12px 16px", borderRadius: "16px 16px 16px 4px",
    boxShadow: "0 6px 20px rgba(26,26,26,.06), 0 1px 3px rgba(26,26,26,.04)",
  },
  searchingScan: {
    position: "absolute", top: 0, bottom: 0, width: "40%",
    background: "linear-gradient(90deg, transparent, rgba(227,6,19,.08), transparent)",
  },
  searchingText: {
    position: "relative", display: "flex", alignItems: "center",
    fontSize: 14, color: C.mute, fontWeight: 500,
  },

  stream: { flex: 1, overflowY: "auto", padding: "28px" },
  streamInner: {
    width: "100%", maxWidth: 820, marginLeft: "auto", marginRight: "auto",
    display: "flex", flexDirection: "column", gap: 18,
  },
  rowLeft: { display: "flex", justifyContent: "flex-start" },
  rowRight: { display: "flex", justifyContent: "flex-end" },
  userBubble: {
    background: C.ink, color: "#fff", padding: "12px 16px", borderRadius: "16px 16px 4px 16px",
    fontSize: 14.5, maxWidth: 560, lineHeight: 1.5,
  },
  botBubble: {
    background: "#fff", border: `1px solid ${C.line}`, padding: "14px 18px",
    borderRadius: "18px 18px 18px 5px", fontSize: 14.5, maxWidth: 620, lineHeight: 1.55,
    boxShadow: "0 6px 20px rgba(26,26,26,.06), 0 1px 3px rgba(26,26,26,.04)",
  },

  // Gap between consecutive Problem/Resolution cases in one reply.
  replyBlock: { marginTop: 12 },

  emptyWrap: {
    display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
    margin: "44px auto 10px", textAlign: "center", maxWidth: 340,
  },
  emptyHint: { fontSize: 13.5, color: C.mute, lineHeight: 1.65 },

  fallbackNote: { fontSize: 12, color: C.mute, marginTop: 8, fontStyle: "italic" },

  mapToggle: {
    background: "none", border: "none", padding: "4px 2px", fontSize: 12.5,
    fontWeight: 700, color: C.red, cursor: "pointer",
  },
  mapPanel: {
    marginTop: 8, background: "#fff", border: `1px solid ${C.line}`,
    borderRadius: 14, padding: "16px 18px", boxShadow: "0 6px 20px rgba(26,26,26,.06), 0 1px 3px rgba(26,26,26,.04)",
  },
  mapLoading: {
    display: "flex", alignItems: "center", fontSize: 13.5, color: C.mute, padding: "20px 0",
  },
  mapLegend: {
    display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10,
    fontSize: 12, color: C.mute,
  },
  legendSwatch: {
    display: "inline-block", width: 9, height: 9, borderRadius: 999,
    marginRight: 5, verticalAlign: "middle",
  },
  mapCaption: {
    fontSize: 11.5, color: C.mute, marginTop: 10, lineHeight: 1.5, fontStyle: "italic",
  },
  hitIntro: { fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, color: C.mute, marginBottom: 12 },
  hitList: { display: "flex", flexDirection: "column", gap: 12 },
  hitCard: {
    background: "#fff", border: `1px solid ${C.line}`, borderLeft: `3px solid ${C.red}`,
    borderRadius: 12, padding: "14px 16px", maxWidth: 620,
    boxShadow: "0 6px 20px rgba(26,26,26,.06), 0 1px 3px rgba(26,26,26,.04)",
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
    padding: "16px 28px 22px", borderTop: `1px solid ${C.line}`, background: "#fff",
    boxShadow: "0 -4px 18px rgba(26,26,26,.035)",
  },
  composerInner: {
    width: "100%", display: "flex", gap: 12, alignItems: "center",
    maxWidth: 820, marginLeft: "auto", marginRight: "auto",
  },
  composerInput: {
    flex: 1, padding: "13px 16px", borderRadius: 999, fontSize: 15,
    border: `1.5px solid ${C.line}`, background: C.paper, color: C.ink,
    transition: "border-color .2s ease, box-shadow .2s ease",
  },
  sendBtn: {
    width: 46, height: 46, borderRadius: 999, background: C.red, border: "none",
    display: "flex", alignItems: "center", justifyContent: "center",
    boxShadow: "0 6px 16px rgba(227,6,19,.3)", transition: "opacity .15s ease", flexShrink: 0,
  },
};
