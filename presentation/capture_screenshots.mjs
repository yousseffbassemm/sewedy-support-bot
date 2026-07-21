/**
 * Screenshot harness for the presentation deck.
 *
 *   DECK_EMAIL=you@example.com DECK_PASSWORD=... node presentation/capture_screenshots.mjs
 *   node presentation/capture_screenshots.mjs chat dark      # only matching steps
 *
 * Drives a real headless Edge over the DevTools Protocol. Static
 * `--screenshot` captures are not usable here: the landing preview stages its
 * reveal through requestAnimationFrame, which does not advance under headless
 * virtual-time, so the box renders empty. A real browser on real time lets every
 * animation settle, and lets us log in and hold a live conversation first.
 *
 * Credentials come from the environment and are never written to disk. The
 * harness logs in against the real API and seeds the returned session, so the
 * screenshots show a genuine signed-in state.
 *
 * Requires: frontend on :5173, backend on :8000.
 * Output: presentation/screenshots/slide-NN-name.png at 2x.
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9350;
const APP = "http://localhost:5173/";
const API = "http://127.0.0.1:8000";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "screenshots");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- minimal CDP client ----------------------------------------------------
let ws, msgId = 0;
const pending = new Map();

function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => pending.has(id) && (pending.delete(id), reject(new Error(method + " timed out"))), 40000);
  });
}

const evaluate = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(expr.slice(0, 70) + " -> " + r.exceptionDetails.text);
  return r.result?.value;
};

async function shot(name) {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, name + ".png"), Buffer.from(data, "base64"));
  console.log("  saved", name + ".png");
}

const viewport = (width, height, scale = 2, mobile = false) =>
  send("Emulation.setDeviceMetricsOverride",
    { width, height, deviceScaleFactor: scale, mobile, screenWidth: width, screenHeight: height });

async function goto(url = APP) {
  await send("Page.navigate", { url });
  await sleep(1800);
}

const clickText = (text, tag = "button") => evaluate(`
  (() => {
    const el = [...document.querySelectorAll(${JSON.stringify(tag)})]
      .find(e => (e.textContent || "").trim().includes(${JSON.stringify(text)}));
    if (!el) return false;
    el.click(); return true;
  })()
`);

const store = (key, value) => evaluate(
  `(() => { localStorage.setItem(${JSON.stringify(key)}, JSON.stringify(${JSON.stringify(value)})); return true; })()`);

/**
 * Ask a question and wait for the answer.
 *
 * The composer is not a <form> -- it is a bare <input> plus a send button --
 * and the input has no type attribute, so "input[type=text]" matches nothing.
 */
async function ask(text, waitMs = 25000) {
  const typed = await evaluate(`
    (() => {
      const inputs = [...document.querySelectorAll("input")];
      const el = inputs[inputs.length - 1];
      if (!el) return "no-input";
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")
        .set.call(el, ${JSON.stringify(text)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return "ok";
    })()
  `);
  if (typed !== "ok") throw new Error("composer not found");
  await sleep(300);
  if (await evaluate(`(() => { const b = document.querySelector(".sendBtn"); if (!b) return false; b.click(); return true; })()`) !== true)
    throw new Error("send button not found");

  // Poll for the answer instead of a fixed sleep: a live Gemini call varies a
  // lot, and a fixed wait either captures a typing indicator or wastes time.
  const deadline = Date.now() + waitMs;
  let last = 0;
  while (Date.now() < deadline) {
    await sleep(700);
    const n = await evaluate(`document.body.innerText.length`);
    if (n > last + 40) { last = n; continue; }     // still growing
    if (last > 0 && !(await evaluate(`!!document.querySelector(".typingDots")`))) break;
    last = n;
  }
  await sleep(1500); // entrance animation
}

const isFallback = () => evaluate(`document.body.innerText.includes("Answer-writing service unavailable")`);

/** Scroll the chat transcript (its own scroll container, not the window). */
const scrollChatToBottom = () => evaluate(`
  (() => {
    const els = [...document.querySelectorAll("div")].filter(d => d.scrollHeight > d.clientHeight + 30);
    const el = els[els.length - 1];
    if (el) el.scrollTop = el.scrollHeight;
    return !!el;
  })()
`);


/**
 * Wait until the landing preview is actually showing a conversation.
 *
 * The preview cycles through four canned conversations and fades between them
 * (`opacity: phase === "idle" ? 1 : 0`), revealing hits one at a time. A fixed
 * sleep lands in a fade often enough that slides 3/15/16 were captured with an
 * empty window. So: poll until the card is opaque AND its text has stopped
 * growing, i.e. the conversation is fully revealed rather than mid-reveal.
 */
async function waitForPreview(maxMs = 30000) {
  const probe = `(() => {
    const qs = ["Readings drift higher","Unit fails the compliance","Screen shows nothing",
                "Device reboots randomly","القراءات ترتفع","الوحدة تفشل","الشاشة لا تعرض","الجهاز يعيد"];
    const cards = [...document.querySelectorAll("div")].filter(d => {
      const t = d.textContent || "";
      return t.includes("SupportBot") && qs.some(q => t.includes(q));
    });
    const card = cards[cards.length - 1];
    if (!card) return JSON.stringify({ ok: false, len: 0 });
    // any ancestor mid-fade makes it invisible regardless of its own opacity
    let el = card, opaque = true;
    while (el && el !== document.body) {
      if (parseFloat(getComputedStyle(el).opacity) < 0.99) { opaque = false; break; }
      el = el.parentElement;
    }
    return JSON.stringify({ ok: opaque, len: (card.innerText || "").length });
  })()`;

  const deadline = Date.now() + maxMs;
  let stable = 0, lastLen = -1;
  while (Date.now() < deadline) {
    const { ok, len } = JSON.parse(await evaluate(probe));
    // A revealed conversation is question + at least one case card.
    if (ok && len > 90) {
      stable = len === lastLen ? stable + 1 : 0;
      if (stable >= 2) return true;            // steady for ~1s
    } else {
      stable = 0;
    }
    lastLen = len;
    await sleep(500);
  }
  console.log("   NOTE: preview never settled; capturing anyway");
  return false;
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  const email = process.env.DECK_EMAIL;
  const password = process.env.DECK_PASSWORD;
  if (!email || !password) {
    console.error("Set DECK_EMAIL and DECK_PASSWORD in the environment.");
    process.exit(1);
  }

  // Real login against the real API -- the screenshots show a genuine session.
  const res = await fetch(API + "/auth/login", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const auth = await res.json();
  if (!auth.token) { console.error("login failed:", auth); process.exit(1); }
  const SESSION = { username: auth.username, email: auth.email, token: auth.token };
  console.log("logged in as", auth.username);

  const edge = spawn(EDGE, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--mute-audio",
    `--remote-debugging-port=${PORT}`,
    "--user-data-dir=" + join(OUT, "..", ".edge-profile"),
    "about:blank",
  ], { stdio: "ignore" });

  await sleep(2500);
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl);
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  };
  await new Promise((r) => (ws.onopen = r));
  await send("Page.enable");
  await send("Runtime.enable");
  await viewport(1440, 900);

  /** Reset to a known state: desktop, light, English, signed in. */
  async function fresh({ theme = "light", lang = "en", signedIn = true } = {}) {
    await viewport(1440, 900);
    await goto();
    await store("supportbot.theme", theme);
    await store("supportbot.lang", lang);
    if (signedIn) await store("supportbot.session", SESSION);
    else await evaluate(`localStorage.removeItem("supportbot.session"); true`);
    await goto();
    await sleep(1000);
  }

  async function enterChat() {
    if (!(await clickText("Open SupportBot"))) await clickText("Get started");
    await sleep(1800);
  }

  const steps = [];
  const step = (n, fn) => steps.push([n, fn]);

  // --- 03 landing, light ---------------------------------------------------
  step("landing", async () => {
    await fresh();
    await waitForPreview();
    await shot("slide-03-landing-hero-light");
  });

  // --- 08 out-of-domain refusal -------------------------------------------
  step("threshold", async () => {
    await fresh();
    await viewport(1440, 760);
    await enterChat();
    await ask("what is the capital of France");
    await scrollChatToBottom(); await sleep(400);
    await shot("slide-08-threshold-rejected");
  });

  // --- 09 + 10 grounded answer and follow-up ------------------------------
  step("chat", async () => {
    await fresh();
    await viewport(1440, 760);
    await enterChat();
    await ask("my ThermoNode T5 firmware update keeps failing halfway");
    await scrollChatToBottom(); await sleep(400);
    if (await isFallback()) {
      console.log("  WARNING: Gemini quota spent -- slide 09 would show the fallback. Not saving.");
    } else {
      await shot("slide-09-grounded-answer");
    }

    await ask("does it happen on the FlowMeter X100 too");
    await scrollChatToBottom(); await sleep(400);
    if (await isFallback()) {
      console.log("  WARNING: Gemini quota spent -- slide 10 not saved.");
    } else {
      await shot("slide-10-followup-memory");
    }
  });

  // --- 11 embedding map ----------------------------------------------------
  step("embedding", async () => {
    await fresh();
    await viewport(1440, 1000);
    await enterChat();
    await ask("readings drift higher after install");

    // Click, then confirm the panel is really open. A click that lands while
    // the answer is still animating reports success but leaves it collapsed,
    // so assert on the rendered plot rather than on the click return value.
    let open = false;
    for (let i = 0; i < 4 && !open; i++) {
      await clickText("See how this was found");
      await sleep(1800);
      open = await evaluate(`(() => {
        const svgs = [...document.querySelectorAll("svg")];
        return svgs.some(s => s.querySelectorAll("circle").length >= 3);
      })()`);
    }
    if (!open) throw new Error("embedding panel did not open");
    await sleep(1200);                        // point tweens settle
    await scrollChatToBottom(); await sleep(800);
    await shot("slide-11-embedding-map");
  });

  // --- 12 small talk -------------------------------------------------------
  step("smalltalk", async () => {
    await fresh();
    await viewport(1440, 760);
    await enterChat();
    await ask("who is your favourite football player");
    await scrollChatToBottom(); await sleep(400);
    await shot("slide-12-small-talk");
  });

  // --- 13 offline fallback -------------------------------------------------
  // Run this one with the backend started WITHOUT a Gemini key, so the app
  // serves its offline path. Triggering it by exhausting the real quota would
  // work too, but it burns the day's allowance and leaves nothing for a demo.
  step("fallback", async () => {
    await fresh();
    await viewport(1440, 820);
    await enterChat();
    await ask("my ThermoNode T5 firmware update keeps failing halfway");
    await scrollChatToBottom(); await sleep(400);
    if (!(await isFallback())) {
      console.log("  SKIPPED: backend still has a working LLM key, so this is not the fallback path.");
      return;
    }
    await shot("slide-13-offline-fallback");
  });

  // --- 14 sign-in ----------------------------------------------------------
  step("auth", async () => {
    await fresh({ signedIn: false });
    await clickText("Get started");
    await sleep(1900);
    await shot("slide-14-auth-signin");
  });

  // --- 15 Arabic RTL -------------------------------------------------------
  step("arabic", async () => {
    await fresh({ lang: "ar" });
    await waitForPreview();
    await shot("slide-15-arabic-rtl");
  });

  // --- 16 dark mode --------------------------------------------------------
  step("dark", async () => {
    await fresh({ theme: "dark" });
    await waitForPreview();
    await shot("slide-16-dark-mode");
    await enterChat();
    await ask("the display stays blank after power on");
    await scrollChatToBottom(); await sleep(400);
    await shot("slide-16b-dark-chat");
  });

  // --- 17 mobile -----------------------------------------------------------
  step("mobile", async () => {
    await fresh();
    await viewport(390, 844, 3, true);
    await goto();
    await waitForPreview();
    await shot("slide-17-mobile-landing");

    await enterChat();
    await sleep(1200);
    await evaluate(`(() => { const b=document.querySelector(".mobileMenuBtn"); if(b) b.click(); return !!b; })()`);
    await sleep(1100);                        // drawer slide-in
    await shot("slide-17b-mobile-drawer");
  });

  const only = process.argv.slice(2);
  for (const [name, fn] of steps) {
    if (only.length && !only.some((o) => name.includes(o))) continue;
    console.log("->", name);
    try { await fn(); } catch (e) { console.log("   FAILED:", e.message); }
  }

  edge.kill();
  console.log("\nDone ->", OUT);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
