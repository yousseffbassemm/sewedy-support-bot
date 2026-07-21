/**
 * Screenshot harness for the presentation deck.
 *
 *   node presentation/capture_screenshots.mjs
 *
 * Drives a real headless Edge over the DevTools Protocol. Static
 * `--screenshot` captures were not usable here: the landing preview stages its
 * reveal through requestAnimationFrame, which does not advance under headless
 * virtual-time, so the box renders empty. Driving a real browser on real time
 * lets every animation settle, and lets us log in and hold a live conversation
 * before capturing.
 *
 * Requires the dev server on :5173 and the backend on :8000.
 *
 * Output: presentation/screenshots/slide-NN-name.png at 2x for print-quality
 * slides.
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9333;
const APP = "http://localhost:5173/";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "screenshots");

const SESSION = {
  username: "Youssef",
  email: "demo.deck@elsewedy.com",
  token: process.env.DECK_TOKEN || "",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- minimal CDP client ----------------------------------------------------
let ws, msgId = 0;
const pending = new Map();

function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => pending.has(id) && (pending.delete(id), reject(new Error(method + " timed out"))), 30000);
  });
}

const evaluate = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(expr.slice(0, 60) + " -> " + r.exceptionDetails.text);
  return r.result?.value;
};

async function shot(name) {
  const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const file = join(OUT, name + ".png");
  writeFileSync(file, Buffer.from(data, "base64"));
  console.log("  saved", name + ".png");
}

async function viewport(width, height, scale = 2, mobile = false) {
  await send("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: scale, mobile,
    screenWidth: width, screenHeight: height,
  });
}

async function goto(url) {
  await send("Page.navigate", { url });
  await sleep(1600); // let React mount + entrance animations settle
}

/** React overwrites .value, so set through the native setter and fire input. */
const typeInto = (selector, text) => evaluate(`
  (() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()
`);

const clickText = (text, tag = "button") => evaluate(`
  (() => {
    const els = [...document.querySelectorAll(${JSON.stringify(tag)})];
    const el = els.find(e => (e.textContent || "").trim().includes(${JSON.stringify(text)}));
    if (!el) return false;
    el.click();
    return true;
  })()
`);

const setTheme = (theme) => evaluate(`
  (() => {
    localStorage.setItem("supportbot.theme", JSON.stringify(${JSON.stringify(theme)}));
    return true;
  })()
`);

const seedSession = () => evaluate(`
  (() => {
    localStorage.setItem("supportbot.session", JSON.stringify(${JSON.stringify(SESSION)}));
    return true;
  })()
`);

const setLang = (lang) => evaluate(`
  (() => { localStorage.setItem("supportbot.lang", JSON.stringify(${JSON.stringify(lang)})); return true; })()
`);

const scrollTo = (y) => evaluate(`(() => { window.scrollTo({top:${y},behavior:"instant"}); return true; })()`);

/**
 * Send a chat message and wait for the answer to render.
 *
 * The composer is not a <form> -- it is a bare <input> plus a send button --
 * and the input carries no type attribute, so "input[type=text]" matches
 * nothing. Both cost a silent no-op the first time round. Target the last
 * input on the page (the composer) and click .sendBtn directly.
 */
async function ask(text, waitMs = 9000) {
  const typed = await evaluate(`
    (() => {
      const inputs = [...document.querySelectorAll("input")];
      const el = inputs[inputs.length - 1];
      if (!el) return "no-input";
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, ${JSON.stringify(text)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return "ok";
    })()
  `);
  if (typed !== "ok") throw new Error("composer not found: " + typed);
  await sleep(300);

  const sent = await evaluate(`
    (() => {
      const b = document.querySelector(".sendBtn");
      if (!b) return "no-button";
      b.click();
      return "ok";
    })()
  `);
  if (sent !== "ok") throw new Error("send button not found");

  // Wait for the typing indicator to clear rather than a fixed delay, so a
  // slow Gemini call is not captured mid-answer.
  const deadline = Date.now() + waitMs;
  await sleep(1200);
  while (Date.now() < deadline) {
    const busy = await evaluate(`!!document.querySelector(".typingDots, [data-typing]")`);
    if (!busy) break;
    await sleep(600);
  }
  await sleep(1200); // let the answer's entrance animation finish
}

/** True when the visible answer came from the offline fallback, not Gemini. */
const isFallback = () => evaluate(`
  document.body.innerText.includes("Answer-writing service unavailable")
`);

// --- run -------------------------------------------------------------------
async function main() {
  mkdirSync(OUT, { recursive: true });

  const edge = spawn(EDGE, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--mute-audio",
    `--remote-debugging-port=${PORT}`,
    "--user-data-dir=" + join(OUT, "..", ".edge-profile"),
    "about:blank",
  ], { stdio: "ignore" });

  await sleep(2500);
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  const { WebSocket } = globalThis;
  ws = new WebSocket(page.webSocketDebuggerUrl);
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

  // Global default so any step can be run in isolation and still render at
  // desktop size; the mobile step overrides it explicitly.
  await viewport(1440, 900);

  const steps = [];
  const step = (n, fn) => steps.push([n, fn]);

  // ---- desktop, light -----------------------------------------------------
  step("desktop light", async () => {
    await viewport(1440, 900);
    await goto(APP);
    await setTheme("light"); await setLang("en");
    await goto(APP);
    await sleep(2600); // preview conversation animates in
    await shot("slide-03-landing-hero-light");

    await scrollTo(900); await sleep(1400);
    await shot("slide-05-how-it-works");
    await scrollTo(1750); await sleep(1400);
    await shot("slide-06-coverage-stats");
  });

  // ---- auth ---------------------------------------------------------------
  step("auth screen", async () => {
    await goto(APP);
    await setTheme("light"); await setLang("en");
    await evaluate(`localStorage.removeItem("supportbot.session"); true`);
    await goto(APP);
    await clickText("Get started");
    await sleep(1600);
    await shot("slide-14-auth-signin");
  });

  // ---- chat: grounded answer ---------------------------------------------
  step("chat grounded", async () => {
    // Navigate first: localStorage throws on about:blank (no origin), so every
    // step has to reach the app before it can seed anything.
    await goto(APP);
    await setTheme("light"); await setLang("en");
    await seedSession();
    await goto(APP);
    await clickText("Open SupportBot");
    await sleep(1500);
    await shot("slide-09-chat-empty-state");

    await ask("my ThermoNode T5 firmware update keeps failing halfway", 14000);
    // Gemini's free tier allows 20 requests PER DAY. When it is spent the app
    // serves its offline fallback, which is a real feature and gets its own
    // slide -- but it is not the grounded-answer slide, so label it honestly
    // rather than passing it off as one.
    if (await isFallback()) {
      await shot("slide-15-offline-fallback");
      console.log("    NOTE: Gemini daily quota spent -> captured the fallback as slide-15.");
      console.log("    Re-run `node presentation/capture_screenshots.mjs chat` after the quota resets for slide-10/11.");
    } else {
      await shot("slide-10-grounded-answer-case-id");
    }
    // follow-up: exercises conversation memory + query contextualization
    await ask("does it happen on the FlowMeter X100 too", 14000);
    if (await isFallback()) {
      console.log("    NOTE: follow-up also on fallback; slide-11 needs a re-run after quota reset.");
    } else {
      await shot("slide-11-followup-memory");
    }
  });

  // ---- embedding visualization -------------------------------------------
  step("embedding map", async () => {
    // Self-sufficient so it can be run alone. The panel renders the real
    // retrieved hits, so it is correct even when Gemini is rate-limited and
    // the answer text itself came from the fallback.
    await goto(APP);
    await setTheme("light"); await setLang("en");
    await seedSession();
    await goto(APP);
    await clickText("Open SupportBot");
    await sleep(1500);
    await ask("readings drift higher after install", 14000);
    // The toggle is labelled "See how this was found" -- not "Show".
    const opened = await clickText("See how this was found");
    if (!opened) throw new Error("map toggle not found");
    await sleep(2200);            // SVD projection + point transitions
    await evaluate(`window.scrollTo({top: document.querySelector("main").scrollHeight, behavior:"instant"}); true`);
    await sleep(600);
    await shot("slide-12-embedding-visualization");
  });

  // ---- out of scope / small talk -----------------------------------------
  step("guardrail", async () => {
    await ask("who is your favourite football player", 12000);
    await shot("slide-13-guardrail-small-talk");
  });

  // ---- dark mode ----------------------------------------------------------
  step("dark mode", async () => {
    await goto(APP);
    await seedSession();
    await setTheme("dark");
    await goto(APP);
    await sleep(2600);
    await shot("slide-17-landing-dark");
    await clickText("Open SupportBot");
    await sleep(1500);
    await ask("the display stays blank after power on", 11000);
    await shot("slide-17b-chat-dark");
  });

  // ---- Arabic RTL ---------------------------------------------------------
  step("arabic", async () => {
    await goto(APP);
    await setTheme("light"); await setLang("ar");
    await goto(APP);
    await sleep(2600);
    await shot("slide-16-arabic-landing-rtl");
  });

  // ---- mobile -------------------------------------------------------------
  step("mobile", async () => {
    await goto(APP);
    await setLang("en"); await setTheme("light");
    await viewport(390, 844, 3, true);
    await goto(APP);
    await sleep(2400);
    await shot("slide-18-mobile-landing");
  });

  // Optional filter: `node capture_screenshots.mjs chat dark` runs only those
  // steps. Useful because the chat steps consume Gemini free-tier quota.
  const only = process.argv.slice(2);
  for (const [name, fn] of steps) {
    if (only.length && !only.some((o) => name.includes(o))) continue;
    console.log("→", name);
    try { await fn(); } catch (e) { console.log("  FAILED:", e.message); }
  }

  edge.kill();
  console.log("\nDone. Screenshots in", OUT);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
