/* Marée — private dashboard. No personal data lives in this file; everything
   personal loads from Supabase after sign-in and is protected by RLS. */
const SUPABASE_URL = "https://gmrdqoazdbisklpnjjnv.supabase.co";
const SUPABASE_KEY = "sb_publishable_xBdga-kiPV_LtmW6-EU7EA_J4EFjv5A"; // publishable (safe in browsers)
const TZ = "America/New_York";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit", experimental: { passkey: true } },
});

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : "#"; } catch { return "#"; } };
const todayISO = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const fmtDay = (iso, opts = { weekday: "short", month: "short", day: "numeric" }) =>
  new Date(iso + "T12:00:00").toLocaleDateString("en-US", opts);
const relTime = (iso) => {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + "m ago";
  if (s < 86400) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
};
const daysUntil = (iso) => Math.round((new Date(iso + "T12:00:00") - new Date(todayISO() + "T12:00:00")) / 86400000);
let toastTimer;
function toast(msg, action) {
  const t = $("#toast"); t.innerHTML = esc(msg);
  if (action) { const b = document.createElement("button"); b.textContent = action.label; b.onclick = () => { action.fn(); t.classList.remove("show"); }; t.append(b); }
  t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 4500);
}

/* ---------------- auth: email + 4-digit PIN, signed in once per device ---------------- */
const PIN_PREFIX = "maree-"; // Supabase password = prefix + PIN (meets minimum length)
let pinMode = true, busy = false;
function showAuth() {
  $("#app").classList.add("hidden"); $("#auth").classList.remove("hidden");
  $("#email").value = localStorage.getItem("maree_email") || "mb2568@georgetown.edu";
  setTimeout(() => $("#pin").focus(), 50);
}
function drawDots() { const n = $("#pin").value.length; document.querySelectorAll(".pin-dots i").forEach((d, i) => d.classList.toggle("on", i < n)); }
async function login(password) {
  if (busy) return; busy = true;
  const email = $("#email").value.trim().toLowerCase();
  $("#authMsg").textContent = "Signing in…";
  const { error } = await sb.auth.signInWithPassword({ email, password });
  busy = false;
  if (error) {
    $("#authMsg").textContent = /invalid/i.test(error.message) ? (pinMode ? "Wrong PIN." : "Wrong email or password.") : error.message;
    if (pinMode) { $("#pin").value = ""; drawDots(); const d = $(".pin-dots"); d.classList.remove("shake"); void d.offsetWidth; d.classList.add("shake"); $("#pin").focus(); }
    return;
  }
  localStorage.setItem("maree_email", email);
  offerPasskey();
  $("#pin").value = ""; $("#password").value = ""; drawDots(); $("#authMsg").textContent = "";
}
$("#pin").addEventListener("input", () => {
  const p = $("#pin"); p.value = p.value.replace(/\D/g, "").slice(0, 4); drawDots();
  if (p.value.length === 4) login(PIN_PREFIX + p.value);
});
$("#pinpad").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  const p = $("#pin");
  if (b.dataset.k === "back") p.value = p.value.slice(0, -1); else if (p.value.length < 4) p.value += b.textContent;
  p.dispatchEvent(new Event("input"));
});
$(".pin-dots").onclick = () => $("#pin").focus();
$("#modeToggle").onclick = () => {
  pinMode = !pinMode;
  $("#pinWrap").classList.toggle("hidden", !pinMode); $("#pwWrap").classList.toggle("hidden", pinMode);
  $("#modeToggle").textContent = pinMode ? "Use a password instead" : "Use PIN instead"; $("#authMsg").textContent = "";
  (pinMode ? $("#pin") : $("#password")).focus();
};
$("#loginForm").onsubmit = (e) => { e.preventDefault(); if (pinMode) { if ($("#pin").value.length === 4) login(PIN_PREFIX + $("#pin").value); } else login($("#password").value); };
$("#signOut").onclick = async () => { await sb.auth.signOut(); location.reload(); };
$("#menuBtn").onclick = (e) => { e.stopPropagation(); const m = $("#menu"); const open = m.classList.toggle("hidden") === false; $("#menuBtn").setAttribute("aria-expanded", open); };
document.addEventListener("click", (e) => { if (!e.target.closest(".menu-wrap")) $("#menu").classList.add("hidden"); });
$("#changePwBtn").onclick = () => { $("#menu").classList.add("hidden"); $("#pwMsg").textContent = ""; $("#pwForm").reset(); $("#pwModal").classList.remove("hidden"); $("#newPw").focus(); };
$("#pwCancel").onclick = () => $("#pwModal").classList.add("hidden");
$("#pwForm").onsubmit = async (e) => {
  e.preventDefault();
  const a = $("#newPw").value, b = $("#newPw2").value;
  if (!/^\d{4}$/.test(a)) { $("#pwMsg").textContent = "PIN must be exactly 4 digits."; return; }
  if (a !== b) { $("#pwMsg").textContent = "PINs don't match."; return; }
  $("#pwMsg").textContent = "Saving…";
  const { error } = await sb.auth.updateUser({ password: PIN_PREFIX + a });
  if (error) { $("#pwMsg").textContent = error.message; return; }
  $("#pwModal").classList.add("hidden"); toast("PIN updated");
};

/* ---------------- Face ID / passkeys (Supabase Auth passkeys, beta) ---------------- */
// Shown only when the project has passkeys switched on (Auth → Passkeys) and the browser supports WebAuthn.
let passkeysOn = false;
const pkReady = (async () => {
  try {
    if (!window.PublicKeyCredential) return false;
    const s = await fetch(SUPABASE_URL + "/auth/v1/settings", { headers: { apikey: SUPABASE_KEY } }).then((r) => r.json());
    passkeysOn = !!s.passkeys_enabled;
  } catch { passkeysOn = false; }
  $("#passkeyBtn").classList.toggle("hidden", !passkeysOn);
  $("#enrollBtn").classList.toggle("hidden", !passkeysOn);
  return passkeysOn;
})();
$("#passkeyBtn").onclick = async () => {
  $("#authMsg").textContent = "Waiting for Face ID…";
  const { error } = await sb.auth.signInWithPasskey();
  $("#authMsg").textContent = error ? "Face ID didn't work. Use your PIN." : "";
  if (!error) localStorage.setItem("maree_passkey", "1");
};
async function offerPasskey(force) {
  if (!(await pkReady)) return;
  if (!force && (localStorage.getItem("maree_passkey") || localStorage.getItem("maree_passkey_skip"))) return;
  $("#enMsg").textContent = ""; $("#enrollModal").classList.remove("hidden");
}
$("#enLater").onclick = () => { localStorage.setItem("maree_passkey_skip", "1"); $("#enrollModal").classList.add("hidden"); };
$("#enYes").onclick = async () => {
  $("#enMsg").textContent = "Follow the Face ID prompt…";
  const { error } = await sb.auth.registerPasskey();
  if (error) { $("#enMsg").textContent = "Couldn't set up Face ID: " + error.message; return; }
  localStorage.setItem("maree_passkey", "1"); $("#enrollModal").classList.add("hidden"); toast("Face ID is set up for next time");
};
$("#enrollBtn").onclick = () => { $("#menu").classList.add("hidden"); offerPasskey(true); };

let started = false;
sb.auth.onAuthStateChange((ev, session) => {
  if (session?.user && !started) { started = true; if (location.hash.includes("access_token")) history.replaceState(null, "", location.pathname); boot(session.user); }
  if (!session && ev === "SIGNED_OUT") { started = false; showAuth(); }
});
(async () => {
  const { data } = await sb.auth.getSession();
  if (!data.session) showAuth();
})();

/* ---------------- boot ---------------- */
let me = null;
async function boot(user) {
  me = user;
  $("#menuWho").textContent = user.email || "";
  $("#auth").classList.add("hidden"); $("#app").classList.remove("hidden");
  renderHeader();
  setupPlans();
  await Promise.all([loadDigest(), loadPlans(), loadCredits(), loadHoldings(), loadMarkets(), loadFx()]);
  weather(false);
  sb.channel("live")
    .on("postgres_changes", { event: "*", schema: "public", table: "plans" }, () => loadPlans())
    .on("postgres_changes", { event: "*", schema: "public", table: "credit_marks" }, () => loadCredits())
    .on("postgres_changes", { event: "*", schema: "public", table: "holdings" }, () => loadHoldings())
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "digest" }, () => loadDigest())
    .subscribe();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { renderHeader(); loadPlans(); loadCredits(); loadMarkets(); loadDigest(); }
  });
  setInterval(() => { if (document.visibilityState === "visible") loadMarkets(); }, 5 * 60 * 1000);
}

function renderHeader() {
  const now = new Date();
  $("#todayDate").textContent = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: TZ });
  const h = +new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: TZ }).format(now);
  const part = h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const name = (me?.user_metadata?.display_name) || "";
  $("#greeting").textContent = part + (name ? ", " + name : "");
}

/* ---------------- weather (live, device location) ---------------- */
const WMO = { 0: ["☀️", "Clear"], 1: ["🌤️", "Mostly clear"], 2: ["⛅", "Partly cloudy"], 3: ["☁️", "Overcast"], 45: ["🌫️", "Fog"], 48: ["🌫️", "Fog"],
  51: ["🌦️", "Drizzle"], 53: ["🌦️", "Drizzle"], 55: ["🌦️", "Drizzle"], 61: ["🌧️", "Light rain"], 63: ["🌧️", "Rain"], 65: ["🌧️", "Heavy rain"],
  66: ["🌧️", "Freezing rain"], 67: ["🌧️", "Freezing rain"], 71: ["🌨️", "Light snow"], 73: ["🌨️", "Snow"], 75: ["❄️", "Heavy snow"], 77: ["🌨️", "Snow grains"],
  80: ["🌦️", "Showers"], 81: ["🌦️", "Showers"], 82: ["⛈️", "Heavy showers"], 85: ["🌨️", "Snow showers"], 86: ["🌨️", "Snow showers"], 95: ["⛈️", "Thunderstorm"], 96: ["⛈️", "Thunderstorm"], 99: ["⛈️", "Thunderstorm"] };
$("#weather").onclick = () => weather(true);
async function weather(prompted) {
  if (!("geolocation" in navigator)) return;
  if (!prompted && navigator.permissions) {
    try { const p = await navigator.permissions.query({ name: "geolocation" }); if (p.state !== "granted") return; } catch {}
  }
  $("#wxDesc").textContent = "Locating…";
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude: la, longitude: lo } = pos.coords;
    try {
      const [w, g] = await Promise.all([
        fetch(`https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&current=temperature_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=1`).then((r) => r.json()),
        fetch(`https://api-bdc.io/data/reverse-geocode-client?latitude=${la}&longitude=${lo}&localityLanguage=en`).then((r) => r.json()).catch(() => ({})),
      ]);
      const [ico, desc] = WMO[w.current.weather_code] || ["◌", ""];
      $("#wxIcon").textContent = ico;
      $("#wxTemp").textContent = Math.round(w.current.temperature_2m) + "°F";
      const place = g.city || g.locality || g.principalSubdivision || "";
      $("#wxDesc").textContent = `${desc} · H ${Math.round(w.daily.temperature_2m_max[0])}° L ${Math.round(w.daily.temperature_2m_min[0])}°${place ? " · " + place : ""}`;
    } catch { $("#wxDesc").textContent = "Weather unavailable"; }
  }, () => { $("#wxDesc").textContent = "Allow location for weather"; }, { maximumAge: 30 * 60 * 1000, timeout: 15000 });
}

/* ---------------- plans ---------------- */
let planKind = "todo", plans = [], showDone = false;
function setupPlans() {
  document.querySelectorAll("#plansCard .seg button").forEach((b) => b.onclick = () => {
    planKind = b.dataset.kind; document.querySelectorAll("#plansCard .seg button").forEach((x) => x.classList.toggle("on", x === b));
    $("#addInput").placeholder = planKind === "weekend" ? "Add a weekend plan…" : "Add a plan or to-do…"; renderPlans();
  });
  $("#addForm").onsubmit = async (e) => {
    e.preventDefault();
    const text = $("#addInput").value.trim(); if (!text) return;
    $("#addInput").value = "";
    const row = { kind: planKind, text, source: "manual", due_date: todayISO() };
    plans.push({ ...row, id: "tmp" + Date.now(), done: false, created_at: new Date().toISOString() }); renderPlans();
    const { error } = await sb.from("plans").insert(row);
    if (error) toast("Couldn't save: " + error.message);
    loadPlans();
  };
  $("#showDone").onclick = () => { showDone = !showDone; renderPlans(); };
}
async function loadPlans() {
  await sb.rpc("roll_unfinished").then(() => {}, () => {});
  const { data, error } = await sb.from("plans").select("*").or(`done.eq.false,done_at.gte."${new Date(Date.now() - 2 * 86400000).toISOString()}"`)
    .order("done").order("sort").order("created_at");
  if (error) { $("#planList").innerHTML = `<li class="empty">Couldn't load plans.</li>`; return; }
  plans = data; renderPlans();
}
function renderPlans() {
  const t = todayISO();
  const mine = plans.filter((p) => planKind === "weekend" ? p.kind === "weekend" : (p.kind === "todo" || p.kind === "daily"));
  const open = mine.filter((p) => !p.done), done = mine.filter((p) => p.done);
  const list = showDone ? [...open, ...done] : open;
  $("#planList").innerHTML = list.length ? "" : `<li class="empty">${planKind === "weekend" ? "No weekend plans yet." : "Nothing on today's list. Enjoy the swell."}</li>`;
  for (const p of list) {
    const li = document.createElement("li"); li.className = "plan" + (p.done ? " done" : "");
    const rolled = p.kind !== "weekend" && p.created_at && new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(p.created_at)) < t && !p.done;
    li.innerHTML = `<button class="check" aria-label="${p.done ? "Mark not done" : "Mark done"}">✓</button>
      <span class="ptext" tabindex="0">${esc(p.text)}</span>
      ${p.source === "bot" ? `<span class="tag bot" title="Suggested by your bots">bot</span>` : ""}
      ${rolled ? `<span class="tag" title="Carried over from an earlier day">since ${esc(fmtDay(new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(p.created_at)), { weekday: "short" }))}</span>` : ""}
      <button class="del" aria-label="Delete">✕</button>`;
    const txt = li.querySelector(".ptext");
    li.querySelector(".check").onclick = () => toggleDone(p);
    li.querySelector(".del").onclick = () => removePlan(p);
    txt.ondblclick = txt.onclick = () => { if (String(p.id).startsWith("tmp")) return; txt.contentEditable = "true"; txt.focus(); };
    txt.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); txt.blur(); } if (e.key === "Escape") { txt.textContent = p.text; txt.blur(); } };
    txt.onblur = async () => {
      txt.contentEditable = "false"; const v = txt.textContent.trim();
      if (v && v !== p.text) { p.text = v; const { error } = await sb.from("plans").update({ text: v }).eq("id", p.id); if (error) toast("Couldn't save edit"); }
      else txt.textContent = p.text;
    };
    $("#planList").append(li);
  }
  $("#showDone").textContent = done.length ? (showDone ? "Hide finished" : `Show finished (${done.length})`) : "";
}
async function toggleDone(p) {
  const done = !p.done; p.done = done; renderPlans();
  const { error } = await sb.from("plans").update({ done, done_at: done ? new Date().toISOString() : null }).eq("id", p.id);
  if (error) { toast("Couldn't update"); p.done = !done; renderPlans(); return; }
  if (done) toast("Done ✓", { label: "Undo", fn: () => toggleDone(p) });
}
async function removePlan(p) {
  plans = plans.filter((x) => x !== p); renderPlans();
  const { error } = await sb.from("plans").delete().eq("id", p.id);
  if (error) { toast("Couldn't delete"); loadPlans(); return; }
  toast("Deleted", { label: "Undo", fn: async () => { const { id, ...rest } = p; await sb.from("plans").insert({ ...rest }); loadPlans(); } });
}

/* ---------------- digest (morning run) ---------------- */
let digest = null, newsTab = "tech";
async function loadDigest() {
  const { data, error } = await sb.from("digest").select("created_at,payload").order("created_at", { ascending: false }).limit(1);
  if (error || !data?.length) { $("#digestAge").textContent = "No morning digest yet"; renderDigest(null); return; }
  digest = data[0].payload; digest._at = data[0].created_at;
  $("#digestAge").textContent = "Updated " + relTime(data[0].created_at);
  $("#foot").textContent = "Morning digest: " + new Date(data[0].created_at).toLocaleString("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", minute: "2-digit" }) + " ET" +
    (digest.run_notes?.length ? " · " + digest.run_notes.join(" · ") : "");
  renderDigest(digest);
}
function renderDigest(d) {
  renderTravel(d?.travel); renderNotifs(d?.notifications); renderNews(d?.news); renderAdeline(d?.adeline);
}
function renderTravel(trips) {
  const el = $("#travelBody");
  if (!trips) { el.innerHTML = `<p class="empty">Waiting for the morning digest.</p>`; return; }
  if (!trips.length) { el.innerHTML = `<p class="empty">No upcoming trips.</p>`; return; }
  $("#travelMeta").textContent = trips.length + " upcoming";
  const ico = { flight: "✈", hotel: "🏨", stay: "🏠", train: "🚆", car: "🚗" };
  el.innerHTML = trips.map((t) => {
    const n = daysUntil(t.start);
    const when = n > 0 ? `in ${n} day${n === 1 ? "" : "s"}` : (daysUntil(t.end) >= 0 ? "now" : "");
    return `<div class="trip"><div class="trip-h"><b>${esc(t.title)}</b><span class="count">${esc(when)}</span></div>
      <div class="small muted">${esc(fmtDay(t.start))} – ${esc(fmtDay(t.end, { month: "short", day: "numeric", year: t.end.slice(0, 4) !== t.start.slice(0, 4) ? "numeric" : undefined }))}</div>
      <ul class="legs">${t.items.map((i) => `<li class="leg"><span class="when">${esc(fmtDay(i.date))}</span> ${ico[i.type] || "•"} ${esc(i.label)}
        <div class="meta">${esc(i.time || "")}${i.seat ? " · seat " + esc(i.seat) : ""}${i.conf ? " · conf " + esc(i.conf) : ""}</div></li>`).join("")}</ul></div>`;
  }).join("");
}
function renderNotifs(n) {
  const el = $("#notifList");
  const off = (n?.not_connected || ["WhatsApp", "iMessage"]).map((c) => `<li class="off"><span class="avatar" style="background:rgba(255,255,255,.08)">·</span><div class="nbody"><div class="nsub">${esc(c)}</div><div class="nsnip">Not connected yet</div></div></li>`).join("");
  if (!n || !n.items) { el.innerHTML = `<li class="empty">${n ? "Messages couldn't be gathered this morning." : "Waiting for the morning digest."}</li>` + off; return; }
  const items = [...n.items].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  el.innerHTML = (items.length ? items.map((m) => {
    const ini = (m.from || "?").replace(/\(.*\)/, "").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
    return `<li><span class="avatar">${esc(ini)}</span><div class="nbody">
      <div class="nrow"><b>${esc(m.from)}</b><span class="chip">${esc(m.channel)}</span></div>
      <a class="nsub" href="${esc(safeUrl(m.url))}" target="_blank" rel="noopener">${esc(m.subject)}</a>
      <div class="nsnip">${esc(m.snippet || "")} · ${m.date ? esc(relTime(m.date)) : ""}</div></div></li>`;
  }).join("") : `<li class="empty">No new messages from people.</li>`) + (n.note ? `<li class="off"><div class="nbody nsnip">${esc(n.note)}</div></li>` : "") + off;
}
const NEWS_TABS = [["tech", "Tech"], ["business", "Business"], ["france", "France"], ["brazil", "Brazil"], ["barrons", "Your holdings"]];
function renderNews(news) {
  $("#newsTabs").innerHTML = NEWS_TABS.map(([k, l]) => `<button role="tab" data-k="${k}" class="${k === newsTab ? "on" : ""}">${l}</button>`).join("");
  $("#newsTabs").querySelectorAll("button").forEach((b) => b.onclick = () => { newsTab = b.dataset.k; renderNews(news); });
  const el = $("#newsList");
  if (!news) { el.innerHTML = `<li class="empty">Waiting for the morning digest.</li>`; return; }
  const items = newsTab === "barrons" ? news.barrons : news.wsj?.[newsTab];
  if (!items?.length) { el.innerHTML = `<li class="empty">No fresh ${newsTab === "barrons" ? "Barron's stories on your holdings" : "WSJ headlines here"} this morning.</li>`; return; }
  el.innerHTML = items.map((i) => `<li><a href="${esc(safeUrl(i.url))}" target="_blank" rel="noopener">${esc(i.title)}</a>
    <div class="nmeta"><span>${esc(i.source || (newsTab === "barrons" ? "Barron's" : "WSJ"))}</span>${i.published ? `<span>${esc(relTime(i.published))}</span>` : ""}${(i.tickers || []).map((t) => `<span class="tk">${esc(t)}</span>`).join("")}</div></li>`).join("");
}
function renderAdeline(a) {
  const el = $("#adelineBody");
  if (!a) { el.innerHTML = `<p class="empty">Waiting for the morning digest.</p>`; return; }
  el.innerHTML = `<div class="stats">
      <div class="stat"><b>${esc(a.sent_total)}</b><span>jobs sent</span></div>
      <div class="stat"><b>${esc(a.this_week)}</b><span>this week</span></div>
      <div class="stat"><b>${esc(a.report_days)}</b><span>report days</span></div></div>
    ${a.last_date ? `<div class="small muted">Latest picks · ${esc(fmtDay(a.last_date))}</div>` : ""}
    <ul class="roles">${(a.last_roles || []).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
    ${a.tracker_url ? `<p class="small"><a href="${esc(safeUrl(a.tracker_url))}" target="_blank" rel="noopener">Open her tracker →</a></p>` : ""}`;
}

/* ---------------- markets (live via edge function) + FX (live) ---------------- */
function spark(vals, up) {
  if (!vals || vals.length < 2) return "";
  const mn = Math.min(...vals), mx = Math.max(...vals), w = 120, h = 26, r = mx - mn || 1;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1) * w).toFixed(1)},${(h - 2 - (v - mn) / r * (h - 4)).toFixed(1)}`).join(" ");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline fill="none" stroke="${up ? "#7fd8b4" : "#f3a3a3"}" stroke-width="1.5" points="${pts}" vector-effect="non-scaling-stroke"/></svg>`;
}
const nf = (v, d = 2) => Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
async function loadMarkets() {
  const el = $("#mktTiles");
  if (!el.innerHTML) el.innerHTML = `<div class="skel"></div><div class="skel"></div>`;
  try {
    const { data, error } = await sb.functions.invoke("markets", { method: "GET" });
    if (error) throw error;
    el.innerHTML = data.indices.map((q) => {
      if (q.error) return `<a class="tile" href="${esc(q.barrons)}" target="_blank" rel="noopener"><div class="nm">${esc(q.name)}</div><div class="px">—</div><div class="ch muted">unavailable</div></a>`;
      const up = (q.changePct ?? 0) >= 0;
      return `<a class="tile" href="${esc(safeUrl(q.barrons))}" target="_blank" rel="noopener" title="Open on Barron's">
        <div class="nm">${esc(q.name)}</div><div class="px">${nf(q.last)}</div>
        <div class="ch ${up ? "up" : "down"}">${up ? "▲" : "▼"} ${nf(Math.abs(q.changePct ?? 0))}%</div>${spark(q.closes, up)}</a>`;
    }).join("");
    const t = data.indices.find((q) => q.time)?.time;
    $("#mktMeta").textContent = t ? "as of " + new Date(t).toLocaleString("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", minute: "2-digit" }) + " ET" : "";
  } catch (e) { el.innerHTML = `<p class="empty">Market data is unavailable right now.</p>`; }
}
async function loadFx() {
  const start = new Date(Date.now() - 35 * 86400000).toISOString().slice(0, 10);
  const pairs = [["BRL", "BRL → USD", "https://www.barrons.com/market-data/currencies/brlusd"], ["EUR", "EUR → USD", "https://www.barrons.com/market-data/currencies/eurusd"]];
  try {
    const tiles = await Promise.all(pairs.map(async ([base, label, link]) => {
      const j = await fetch(`https://api.frankfurter.dev/v1/${start}..?base=${base}&symbols=USD`).then((r) => r.json());
      const days = Object.keys(j.rates).sort(); const vals = days.map((d) => j.rates[d].USD);
      const last = vals.at(-1), prev = vals.at(-2), pct = prev ? (last - prev) / prev * 100 : 0, up = pct >= 0;
      return `<a class="tile" href="${link}" target="_blank" rel="noopener" title="Open on Barron's"><div class="nm">${label}</div>
        <div class="px">$${nf(last, base === "BRL" ? 4 : 4)}</div><div class="ch ${up ? "up" : "down"}">${up ? "▲" : "▼"} ${nf(Math.abs(pct))}% <span class="muted">· ${esc(fmtDay(days.at(-1), { month: "short", day: "numeric" }))}</span></div>${spark(vals.slice(-22), up)}</a>`;
    }));
    $("#fxTiles").innerHTML = tiles.join("");
  } catch { $("#fxTiles").innerHTML = `<p class="empty">Exchange rates unavailable.</p>`; }
}

/* ---------------- holdings ---------------- */
let holdings = [];
async function loadHoldings() {
  const { data } = await sb.from("holdings").select("*").order("weight", { ascending: false, nullsFirst: false });
  holdings = data || []; renderHoldings();
}
function renderHoldings() {
  $("#holdList").innerHTML = holdings.map((h) => `<li class="hold ${h.track_news ? "" : "off"}" data-t="${esc(h.ticker)}">
    <b>${esc(h.ticker)}</b><span class="muted">${h.weight != null ? nf(h.weight, 1) + "%" : ""}</span>
    <button data-a="news" title="${h.track_news ? "Stop news" : "Track news"}">${h.track_news ? "◉" : "○"}</button>
    <button data-a="del" title="Remove">✕</button></li>`).join("");
  $("#holdList").querySelectorAll(".hold").forEach((li) => li.onclick = async (e) => {
    const a = e.target.dataset.a; const t = li.dataset.t; if (!a) return;
    if (a === "del") await sb.from("holdings").delete().eq("ticker", t);
    if (a === "news") { const h = holdings.find((x) => x.ticker === t); await sb.from("holdings").update({ track_news: !h.track_news, updated_at: new Date().toISOString() }).eq("ticker", t); }
    loadHoldings();
  });
}
$("#holdForm").onsubmit = async (e) => {
  e.preventDefault();
  const ticker = $("#holdTicker").value.trim().toUpperCase(); if (!ticker) return;
  const w = parseFloat($("#holdWeight").value);
  const { error } = await sb.from("holdings").upsert({ ticker, weight: isNaN(w) ? null : w, track_news: isNaN(w) || w >= 5, updated_at: new Date().toISOString() });
  if (error) toast("Couldn't save holding"); $("#holdTicker").value = $("#holdWeight").value = ""; loadHoldings();
};

/* ---------------- Amex credits (manual) ---------------- */
let credits = [], marks = {};
function periodKey(period, d = new Date()) {
  const [y, m] = todayISO().split("-").map(Number);
  if (period === "monthly") return `${y}-${String(m).padStart(2, "0")}`;
  if (period === "quarterly") return `${y}-Q${Math.ceil(m / 3)}`;
  if (period === "semiannual") return `${y}-H${m <= 6 ? 1 : 2}`;
  return `${y}`;
}
function periodLabel(period) {
  const [y, m] = todayISO().split("-").map(Number);
  if (period === "quarterly") { const q = Math.ceil(m / 3); const end = new Date(y, q * 3, 0); return `Q${q} · ends ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`; }
  if (period === "semiannual") return m <= 6 ? "Jan–Jun · ends Jun 30" : "Jul–Dec · ends Dec 31";
  return "";
}
function creditAmount(c) { const m = +todayISO().split("-")[1]; return c.id === "plat_uber" && m === 12 ? 35 : Number(c.amount); }
async function loadCredits() {
  const [{ data: cs }, { data: ms }] = await Promise.all([
    sb.from("credits").select("*").order("sort"),
    sb.from("credit_marks").select("*"),
  ]);
  credits = cs || []; marks = {};
  (ms || []).forEach((m) => marks[m.credit_id + "|" + m.period_key] = m.used);
  renderCredits();
}
function renderCredits() {
  const el = $("#moneyBody");
  if (!credits.length) { el.innerHTML = `<p class="empty">No credits loaded.</p>`; return; }
  const month = new Date().toLocaleDateString("en-US", { month: "long", timeZone: TZ });
  const daysLeft = (() => { const [y, m, d] = todayISO().split("-").map(Number); return new Date(y, m, 0).getDate() - d; })();
  let html = `<div class="small muted">${month} · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left this month</div>`;
  for (const card of ["Platinum", "Gold"]) {
    const monthly = credits.filter((c) => c.card === card && c.period === "monthly");
    const tot = monthly.reduce((s, c) => s + creditAmount(c), 0);
    const used = monthly.filter((c) => marks[c.id + "|" + periodKey(c.period)]).reduce((s, c) => s + creditAmount(c), 0);
    html += `<div class="money-sec"><div class="cardsum"><h3>${card}</h3><b>$${nf(used, 0)} used · $${nf(tot - used, 0)} left</b></div>
      <div class="bar"><i style="width:${tot ? used / tot * 100 : 0}%"></i></div>
      ${credits.filter((c) => c.card === card).map((c) => {
        const on = !!marks[c.id + "|" + periodKey(c.period)];
        return `<div class="credit"><div class="cn">${esc(c.name)}<small>${c.period === "monthly" ? "Monthly" : esc(periodLabel(c.period))}${c.note ? " · " + esc(c.note) : ""}</small></div>
          <span class="amt">$${nf(creditAmount(c), 0)}</span>
          <button class="toggle" role="switch" aria-checked="${on}" aria-label="Mark ${esc(c.name)} used" data-id="${esc(c.id)}"></button></div>`;
      }).join("")}</div>`;
  }
  el.innerHTML = html;
  el.querySelectorAll(".toggle").forEach((b) => b.onclick = async () => {
    const c = credits.find((x) => x.id === b.dataset.id); const k = periodKey(c.period); const used = !marks[c.id + "|" + k];
    marks[c.id + "|" + k] = used; renderCredits();
    const { error } = await sb.from("credit_marks").upsert({ credit_id: c.id, period_key: k, used, updated_at: new Date().toISOString() });
    if (error) { toast("Couldn't save"); loadCredits(); }
  });
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
