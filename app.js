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
  setupDenver();
  setMktView(mktView);
  weather(false); // never gated on the data loads (one failed load used to stop weather from ever starting)
  await Promise.allSettled([loadDigest(), loadPlans(), loadCredits(), loadHoldings(), loadMarkets(), loadFx()]);
  setInterval(() => { if (document.visibilityState === "visible") weather(false); }, 15 * 60 * 1000);
  sb.channel("live")
    .on("postgres_changes", { event: "*", schema: "public", table: "plans" }, () => loadPlans())
    .on("postgres_changes", { event: "*", schema: "public", table: "credit_marks" }, () => loadCredits())
    .on("postgres_changes", { event: "*", schema: "public", table: "holdings" }, () => loadHoldings())
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "digest" }, () => loadDigest())
    .subscribe();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { renderHeader(); weather(false); loadPlans(); loadCredits(); loadMarkets(); loadDigest(); }
  });
  setInterval(() => { if (document.visibilityState === "visible") { loadMarkets(); if (mktView === "holdings") loadHoldingQuotes(); } }, 5 * 60 * 1000);
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
$("#weather").onclick = (e) => { if (e.target.closest(".wx-place")) { e.stopPropagation(); openCityPicker(); } else weather(true); };
// Location order (Nov 21): a city Marlon picks by tapping the place name (pinned, per device) >
// fresh browser GPS fix > last GPS fix > St. Helena Island, SC. No IP geolocation (it was the bug: geojs put him in
// Lawrenceville). The best non-GPS location renders instantly; a GPS fix replaces it whenever it arrives.
let wxBusy = false;
const HOME = { la: 32.38, lo: -80.57, place: "St. Helena Island, SC" };
const GEO_ERR = { 1: "location blocked", 2: "location unavailable", 3: "location timed out" };
const getJSON = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
async function renderWeather(loc, src) {
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${(+loc.la).toFixed(3)}&longitude=${(+loc.lo).toFixed(3)}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=auto&forecast_days=1`, { cache: "no-store" });
  if (!r.ok) throw new Error("Open-Meteo HTTP " + r.status);
  const w = await r.json();
  const [ico, desc] = WMO[w.current.weather_code] || ["◌", ""];
  $("#wxIcon").textContent = ico;
  $("#wxTemp").textContent = Math.round(w.current.temperature_2m) + "°F";
  $("#wxDesc").innerHTML = `${esc(desc)} · H ${Math.round(w.daily.temperature_2m_max[0])}° L ${Math.round(w.daily.temperature_2m_min[0])}° · <span class="wx-place" role="button" tabindex="0" title="Change city">📍 ${esc(loc.place || "Set city")}</span> <span class="wx-src">${esc(src)}</span>`;
}
async function placeName(la, lo) {
  try { const g = await fetch(`https://api-bdc.io/data/reverse-geocode-client?latitude=${la}&longitude=${lo}&localityLanguage=en`).then((r) => r.json()); return g.city || g.locality || g.principalSubdivision || ""; } catch { return ""; }
}
async function weather(userTap) {
  const manual = getJSON("maree_loc_manual");
  if (manual) { renderWeather(manual, "(your city)").catch(wxFail); return; }
  const lastGps = getJSON("maree_loc_gps");
  const interim = lastGps ? [lastGps, "(last GPS)"] : [HOME, "(default)"];
  let gotFix = false;
  if (!wxBusy || userTap) renderWeather(...interim).catch(wxFail);
  if (!("geolocation" in navigator) || wxBusy) return;
  wxBusy = true;
  navigator.geolocation.getCurrentPosition(async (pos) => {
    wxBusy = false; gotFix = true;
    if (getJSON("maree_loc_manual")) return;
    const la = pos.coords.latitude, lo = pos.coords.longitude;
    const moved = !lastGps || Math.abs(lastGps.la - la) > 0.02 || Math.abs(lastGps.lo - lo) > 0.02;
    const loc = { la, lo, place: (moved ? await placeName(la, lo) : lastGps.place) || "Your location", at: Date.now() };
    localStorage.setItem("maree_loc_gps", JSON.stringify(loc));
    renderWeather(loc, "(GPS)").catch(wxFail);
  }, (err) => {
    wxBusy = false;
    console.warn("[weather] geolocation error", err.code, err.message);
    if (!getJSON("maree_loc_manual")) renderWeather(interim[0], interim[1].replace(")", " · " + (GEO_ERR[err.code] || "error " + err.code) + ")")).catch(wxFail);
  }, { enableHighAccuracy: false, maximumAge: 2 * 60 * 1000, timeout: 15000 });
}
function wxFail(e) { console.warn("[weather] forecast failed", e?.message); $("#wxDesc").textContent = "Weather unavailable (" + (e?.message || "network") + ") — tap to retry"; }
localStorage.removeItem("maree_loc"); // old cache could hold an IP-based guess
/* city picker (tap the 📍 place name) */
function openCityPicker() {
  $("#cityModal").classList.remove("hidden"); $("#cityQ").value = ""; $("#cityRes").innerHTML = ""; $("#cityQ").focus();
  $("#cityAuto").classList.toggle("hidden", !getJSON("maree_loc_manual"));
}
let cityT;
$("#cityQ").oninput = () => { clearTimeout(cityT); cityT = setTimeout(async () => {
  const q = $("#cityQ").value.trim(); if (q.length < 2) { $("#cityRes").innerHTML = ""; return; }
  try {
    const g = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`).then((r) => r.json());
    $("#cityRes").innerHTML = (g.results || []).map((c, i) => `<li><button type="button" data-i="${i}">${esc(c.name)}<span class="muted small"> · ${esc([c.admin1, c.country_code].filter(Boolean).join(", "))}</span></button></li>`).join("") || `<li class="small muted">No match</li>`;
    $("#cityRes").querySelectorAll("button").forEach((b) => b.onclick = () => {
      const c = g.results[+b.dataset.i];
      localStorage.setItem("maree_loc_manual", JSON.stringify({ la: c.latitude, lo: c.longitude, place: c.name + (c.admin1_code || c.admin1 ? ", " + (c.country_code === "US" ? (c.admin1_code || c.admin1) : c.country_code) : "") }));
      $("#cityModal").classList.add("hidden"); weather(true);
    });
  } catch { $("#cityRes").innerHTML = `<li class="small muted">City search unavailable</li>`; }
}, 250); };
$("#cityAuto").onclick = () => { localStorage.removeItem("maree_loc_manual"); $("#cityModal").classList.add("hidden"); weather(true); };
$("#cityCancel").onclick = () => $("#cityModal").classList.add("hidden");

/* ---------------- plans ---------------- */
let planKind = "todo", plans = [], showDone = false, showDenverDone = false;
function renderPlanLists() { renderPlans(); renderDenver(); }
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
    plans.push({ ...row, id: "tmp" + Date.now(), done: false, created_at: new Date().toISOString() }); renderPlanLists();
    const { error } = await sb.from("plans").insert(row);
    if (error) toast("Couldn't save: " + error.message);
    loadPlans();
  };
  $("#showDone").onclick = () => { showDone = !showDone; renderPlans(); };
}
async function loadPlans() {
  await sb.rpc("roll_unfinished").then(() => {}, () => {});
  const { data, error } = await sb.from("plans").select("*").or(`done.eq.false,done_at.gte."${new Date(Date.now() - 2 * 86400000).toISOString()}",kind.eq.denver`)
    .order("done").order("sort").order("created_at");
  if (error) {
    $("#planList").innerHTML = `<li class="empty">Couldn't load plans.</li>`;
    if ($("#denverList")) $("#denverList").innerHTML = `<li class="empty">Couldn't load to-dos.</li>`;
    $("#denverCard")?.classList.remove("hidden");
    return;
  }
  plans = data; renderPlanLists();
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
  const done = !p.done; p.done = done; renderPlanLists();
  const { error } = await sb.from("plans").update({ done, done_at: done ? new Date().toISOString() : null }).eq("id", p.id);
  if (error) { toast("Couldn't update"); p.done = !done; renderPlanLists(); return; }
  if (done) toast("Done ✓", { label: "Undo", fn: () => toggleDone(p) });
}
async function removePlan(p) {
  plans = plans.filter((x) => x !== p); renderPlanLists();
  const { error } = await sb.from("plans").delete().eq("id", p.id);
  if (error) { toast("Couldn't delete"); loadPlans(); return; }
  toast("Deleted", { label: "Undo", fn: async () => { const { id, ...rest } = p; await sb.from("plans").insert({ ...rest }); loadPlans(); } });
}


function denverLabel(p) {
  return p.due_label || (p.due_date ? fmtDay(p.due_date, { weekday: "short", month: "short", day: "numeric" }) : "Anytime");
}
function setupDenver() {
  const form = $("#denverAddForm");
  if (!form) return;
  const date = $("#denverAddDate");
  if (date && !date.value) date.value = todayISO();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const text = $("#denverAddInput").value.trim(); if (!text) return;
    $("#denverAddInput").value = "";
    const due = ($("#denverAddDate").value || todayISO());
    const row = { kind: "denver", text, source: "manual", created_by: me?.email || "manual", due_date: due, due_label: fmtDay(due, { weekday: "short", month: "short", day: "numeric" }), sort: 50 };
    plans.push({ ...row, id: "tmp" + Date.now(), done: false, created_at: new Date().toISOString() }); renderPlanLists();
    const { error } = await sb.from("plans").insert(row);
    if (error) toast("Couldn't save: " + error.message);
    loadPlans();
  };
  $("#denverShowDone").onclick = () => { showDenverDone = !showDenverDone; renderDenver(); };
}
function renderDenver() {
  const card = $("#denverCard"), ul = $("#denverList");
  if (!card || !ul) return;
  const mine = plans.filter((p) => p.kind === "denver").slice()
    .sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999") || (a.sort || 0) - (b.sort || 0) || (a.created_at || "").localeCompare(b.created_at || ""));
  if (!mine.length) { card.classList.add("hidden"); return; }
  card.classList.remove("hidden");
  const t = todayISO();
  const open = mine.filter((p) => !p.done), done = mine.filter((p) => p.done);
  const list = showDenverDone ? mine : open;
  const lastDue = mine.map((p) => p.due_date).filter(Boolean).sort().at(-1);
  $("#denverMeta").textContent = `${open.length} open · ${mine.length} total` + (lastDue ? ` · through ${fmtDay(lastDue, { month: "short", day: "numeric" })}` : "");
  ul.innerHTML = list.length ? "" : `<li class="empty">All caught up on the Denver move list.</li>`;
  let lastLabel = null;
  for (const p of list) {
    const label = denverLabel(p);
    if (label !== lastLabel) {
      lastLabel = label;
      const group = list.filter((x) => denverLabel(x) === label);
      const due = p.due_date;
      const h = document.createElement("li");
      h.className = "dgroup" + (due === t ? " today" : (due && due < t && group.some((x) => !x.done) ? " overdue" : ""));
      h.textContent = label;
      ul.append(h);
    }
    const li = document.createElement("li"); li.className = "plan" + (p.done ? " done" : "");
    const dueTag = !p.done && p.due_date === t ? `<span class="tag" title="Due today">today</span>` : (!p.done && p.due_date && p.due_date < t ? `<span class="tag" title="Past its date">overdue</span>` : "");
    li.innerHTML = `<button class="check" aria-label="${p.done ? "Mark not done" : "Mark done"}">✓</button>
      <span class="ptext" tabindex="0">${esc(p.text)}</span>
      ${dueTag}
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
    ul.append(li);
  }
  $("#denverShowDone").textContent = done.length ? (showDenverDone ? "Hide finished" : `Show finished (${done.length})`) : "";
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
  if (credits.length) renderCredits();
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
        <div class="meta">${esc(i.time || "")}${i.seat ? " · seat " + esc(i.seat) : ""}${i.conf ? " · conf " + esc(i.conf) : ""}</div>${i.lounge ? `<div class="lounge">${esc(i.lounge)}</div>` : ""}</li>`).join("")}</ul></div>`;
  }).join("");
}
function renderNotifs(n) {
  const el = $("#notifList");
  const off = "";
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
const NEWS_TABS = [["tech", "Tech"], ["business", "Business"], ["france", "France"], ["brazil", "Brazil"], ["datadog", "Datadog"]];
const dateLabel = (i) => i.published ? (Date.now() - new Date(i.published) < 3 * 864e5 && i.published.length > 10 ? relTime(i.published) : new Date(i.published.length === 10 ? i.published + "T12:00:00" : i.published).toLocaleDateString("en-US", { month: "short", day: "numeric" })) : (i.date_label || "");
function newsItem(i) {
  const tag = i.tag ? `<span class="ntag ${/^Exclusive/.test(i.tag) ? "ex" : ""}">${esc(i.tag)}</span>` : "";
  return `<li>${tag}<a href="${esc(safeUrl(i.url))}" target="_blank" rel="noopener">${esc(i.title)}</a>
    ${i.dek ? `<div class="ndek">${esc(i.dek)}</div>` : ""}
    <div class="nmeta"><span>${esc(i.source || "")}</span>${dateLabel(i) ? `<span>${esc(dateLabel(i))}</span>` : ""}${(i.tickers || []).map((t) => `<span class="tk">${esc(t)}</span>`).join("")}</div></li>`;
}
function renderNews(news) {
  if (!NEWS_TABS.some(([k]) => k === newsTab)) newsTab = "tech";
  $("#newsTabs").innerHTML = NEWS_TABS.map(([k, l]) => `<button role="tab" data-k="${k}" class="${k === newsTab ? "on" : ""}">${l}</button>`).join("");
  $("#newsTabs").querySelectorAll("button").forEach((b) => b.onclick = () => { newsTab = b.dataset.k; renderNews(news); });
  const m = news?.wsj_meta, pill = $("#newsPill");
  pill.textContent = m ? "WSJ · " + new Date(m.as_of).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET" + (m.stale ? " · stale" : "") : "";
  pill.classList.toggle("warn", !!m?.stale); pill.classList.toggle("hidden", !m);
  const el = $("#newsList");
  if (!news) { el.innerHTML = `<li class="empty">Waiting for the morning digest.</li>`; return; }
  const items = newsTab === "datadog" ? news.datadog : news.wsj?.[newsTab];
  if (!items?.length) { el.innerHTML = `<li class="empty">No fresh headlines here this morning.</li>`; return; }
  el.innerHTML = items.map(newsItem).join("");
  renderHoldNews();
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
  // [base, quote, label, prefix, link]
  const pairs = [["USD", "BRL", "USD → BRL", "R$", "https://www.barrons.com/market-data/currencies/usdbrl"], ["EUR", "USD", "EUR → USD", "$", "https://www.barrons.com/market-data/currencies/eurusd"]];
  try {
    const tiles = await Promise.all(pairs.map(async ([base, quote, label, pre, link]) => {
      const j = await fetch(`https://api.frankfurter.dev/v1/${start}..?base=${base}&symbols=${quote}`).then((r) => r.json());
      const days = Object.keys(j.rates).sort(); const vals = days.map((d) => j.rates[d][quote]);
      const last = vals.at(-1), prev = vals.at(-2), pct = prev ? (last - prev) / prev * 100 : 0, up = pct >= 0;
      return `<a class="tile" href="${link}" target="_blank" rel="noopener" title="Open on Barron's"><div class="nm">${label}</div>
        <div class="px">${pre}${nf(last, 4)}</div><div class="ch ${up ? "up" : "down"}">${up ? "▲" : "▼"} ${nf(Math.abs(pct))}% <span class="muted">· ${esc(fmtDay(days.at(-1), { month: "short", day: "numeric" }))}</span></div>${spark(vals.slice(-22), up)}</a>`;
    }));
    $("#fxTiles").innerHTML = tiles.join("");
  } catch { $("#fxTiles").innerHTML = `<p class="empty">Exchange rates unavailable.</p>`; }
}

/* ---------------- holdings (live quotes in the Markets card) ---------------- */
let mktView = localStorage.getItem("maree_mktview") || "markets";
function setMktView(v) {
  mktView = v; localStorage.setItem("maree_mktview", v);
  document.querySelectorAll("#mktSeg button").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
  $("#mktView").classList.toggle("hidden", v !== "markets"); $("#holdView").classList.toggle("hidden", v !== "holdings");
  $("#mktTitle").textContent = v === "markets" ? "Markets" : "My holdings";
  if (v === "holdings") loadHoldingQuotes();
}
document.querySelectorAll("#mktSeg button").forEach((b) => b.onclick = () => setMktView(b.dataset.v));
const barronsQuote = (t) => `https://www.barrons.com/market-data/stocks/${t.toLowerCase()}`;
let holdQuotes = {}, holdFilter = null;
async function loadHoldingQuotes() {
  if (!holdings.length) { renderHoldNews(); return; }
  try {
    const syms = holdings.filter((h) => h.track_news).map((h) => h.ticker).join(",");
    const { data, error } = await sb.functions.invoke("markets?symbols=" + encodeURIComponent(syms), { method: "GET" });
    if (error) throw error;
    holdQuotes = Object.fromEntries(data.quotes.map((q) => [q.ticker, q]));
  } catch { holdQuotes = {}; }
  renderHoldNews();
}
function renderHoldNews() {
  const all = digest?.news?.holdings || digest?.news?.barrons || [];
  const tracked = holdings.filter((h) => h.track_news).map((h) => h.ticker);
  const withNews = tracked.filter((t) => all.some((i) => (i.tickers || []).includes(t)));
  if (holdFilter && !withNews.includes(holdFilter)) holdFilter = null;
  $("#holdChips").innerHTML = `<button class="hchip ${!holdFilter ? "on" : ""}" data-t="">All</button>` + withNews.map((t) => {
    const q = holdQuotes[t]; const ch = q && !q.error && q.changePct != null ? `<span class="${q.changePct >= 0 ? "up" : "down"}">${q.changePct >= 0 ? "+" : "−"}${nf(Math.abs(q.changePct), 1)}%</span>` : "";
    return `<button class="hchip ${holdFilter === t ? "on" : ""}" data-t="${esc(t)}">${esc(t)} ${ch}</button>`;
  }).join("");
  $("#holdChips").querySelectorAll(".hchip").forEach((b) => b.onclick = () => { holdFilter = b.dataset.t || null; renderHoldNews(); });
  const items = all.filter((i) => !holdFilter || (i.tickers || []).includes(holdFilter));
  $("#holdNews").innerHTML = !digest ? `<li class="empty">Waiting for the morning digest.</li>` : items.length ? items.map(newsItem).join("") : `<li class="empty">No recent stories on your holdings.</li>`;
}
$("#holdEditBtn").onclick = () => { const d = $("#holdEditor"); d.open = !d.open; if (d.open) d.scrollIntoView({ behavior: "smooth", block: "nearest" }); };

let holdings = [];
async function loadHoldings() {
  const { data } = await sb.from("holdings").select("*").order("weight", { ascending: false, nullsFirst: false });
  holdings = data || []; renderHoldings(); renderHoldNews(); if (mktView === "holdings") loadHoldingQuotes();
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

/* ---------------- Amex: tracked credits (from the Amex read) + manual fallback ---------------- */
let credits = [], marks = {};
function periodKey(period) {
  const [y, m] = todayISO().split("-").map(Number);
  if (period === "monthly") return `${y}-${String(m).padStart(2, "0")}`;
  if (period === "quarterly") return `${y}-Q${Math.ceil(m / 3)}`;
  if (period === "semiannual") return `${y}-H${m <= 6 ? 1 : 2}`;
  return `${y}`;
}
function periodLabel(period) {
  const [y, m] = todayISO().split("-").map(Number);
  if (period === "monthly") return "Monthly";
  if (period === "quarterly") { const q = Math.ceil(m / 3); const end = new Date(y, q * 3, 0); return `Q${q} · ends ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`; }
  if (period === "semiannual") return m <= 6 ? "Jan–Jun · ends Jun 30" : "Jul–Dec · ends Dec 31";
  return `${y} · ends Dec 31`;
}
function creditAmount(c) { const m = +todayISO().split("-")[1]; return c.id === "plat_uber" && m === 12 ? 35 : Number(c.amount); }
const EXCLUDED_CREDITS = new Set(["plat_oura", "plat_uberone"]); // Marlon: leave these out
async function loadCredits() {
  const [{ data: cs }, { data: ms }] = await Promise.all([
    sb.from("credits").select("*").order("sort"),
    sb.from("credit_marks").select("*"),
  ]);
  credits = (cs || []).filter((c) => !EXCLUDED_CREDITS.has(c.id)); marks = {};
  (ms || []).forEach((m) => marks[m.credit_id + "|" + m.period_key] = m.used);
  renderCredits();
}
const money = (v, d = 0) => v == null ? "—" : "$" + nf(v, d);
function periodEndFromLabel(label) {
  const y = +todayISO().slice(0, 4);
  const mon = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const parseMon = (s) => mon[(s || "").slice(0, 3).toLowerCase()];
  const lab = (label || "").trim();
  const parts = lab.split(/[–-]/).map((s) => s.trim());
  if (parts.length === 2 && parseMon(parts[0]) && parseMon(parts[1])) return { date: new Date(y, parseMon(parts[1]), 0), kind: "ends" };
  if (parseMon(lab) && !/\d/.test(lab)) return { date: new Date(y, parseMon(lab), 0), kind: "resets" };
  if (/^\d{4}$/.test(lab)) return { date: new Date(+lab, 11, 31), kind: "ends" };
  return null;
}
function creditDeadline(c, catalog) {
  const fromLabel = periodEndFromLabel(c.period_label);
  if (fromLabel) return fromLabel;
  if (!catalog) return null;
  const [y, m] = todayISO().split("-").map(Number);
  if (catalog.period === "monthly") return { date: new Date(y, m, 0), kind: "resets" };
  if (catalog.period === "quarterly") return { date: new Date(y, Math.ceil(m / 3) * 3, 0), kind: "ends" };
  if (catalog.period === "semiannual") return { date: new Date(y, m <= 6 ? 6 : 12, 0), kind: "ends" };
  return { date: new Date(y, 11, 31), kind: "ends" };
}
function fmtDeadline(dl) {
  if (!dl) return "";
  const opts = { month: "short", day: "numeric" };
  if (dl.date.getFullYear() !== +todayISO().slice(0, 4)) opts.year = "numeric";
  return `${dl.kind} ${dl.date.toLocaleDateString("en-US", opts)}`;
}
function moneyLeft(v) { return money(v, v % 1 ? 2 : 0) + " left"; }
function renderCredits() {
  const el = $("#moneyBody");
  const amex = digest?.amex || null;
  const pill = $("#moneyCard .pill");
  if (pill) { pill.textContent = amex ? "Amex · " + new Date(amex.as_of).toLocaleString("en-US", { timeZone: TZ, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET" : "manual until Amex is connected"; pill.classList.toggle("warn", !amex); }
  const catById = Object.fromEntries(credits.map((c) => [c.id, c]));
  const rows = (amex?.credits?.length ? amex.credits.filter((c) => !EXCLUDED_CREDITS.has(c.id)) : credits).map((c) => {
    const cat = catById[c.id] || c;
    const amt = creditAmount(cat.amount != null ? cat : c);
    const st = c.status && c.status !== "active" ? { left: null, off: true, label: c.status === "locked" ? "Not unlocked" : "Not enrolled" }
      : c.left != null ? { left: c.left, off: false, label: c.note }
      : c.note ? { left: null, off: false, label: c.note }
      : (() => { const on = !!marks[c.id + "|" + periodKey(cat.period || "annual")]; return { left: on ? 0 : amt, off: false, label: null, manual: !amex }; })();
    const dl = creditDeadline(c, cat);
    return { id: c.id, name: c.name || cat.name, card: c.card || cat.card, amt, dl, ...st };
  });
  const usable = rows.filter((r) => r.left > 0 && !r.off).sort((a, b) => (a.dl?.date || 0) - (b.dl?.date || 0) || b.left - a.left);
  const main = usable.slice(0, 5);
  const rest = rows.filter((r) => !main.some((m) => m.id === r.id));
  const rowHtml = (r, { extra = false } = {}) => {
    const name = extra && r.card ? `${esc(r.card)} · ${esc(r.name)}` : esc(r.name);
    const right = r.off ? `<span class="tag">${esc(r.label)}</span>`
      : r.left == null ? `<span class="tag">${esc(r.label || "pending")}</span>`
      : r.manual ? `<span class="amt">${money(r.amt, r.amt % 1 ? 2 : 0)}</span><button class="toggle" role="switch" aria-checked="${r.left === 0}" aria-label="Mark ${esc(r.name)} used" data-id="${esc(r.id)}"></button>`
      : `<span class="amt">${r.left > 0 ? moneyLeft(r.left) : "used"}</span>`;
    return `<div class="credit${r.off || r.left === 0 ? " off" : ""}"><div class="cn">${name}</div>${right}${r.dl ? `<span class="when">${esc(fmtDeadline(r.dl))}</span>` : ""}</div>`;
  };
  let html = renderAccounts(amex) + renderSpending(amex);
  html += renderWelcome(amex);
  if (main.length || rest.length) {
    html += `<div class="money-sec"><h3>Credits</h3><div class="credits-list">${main.map((r) => rowHtml(r)).join("")}</div>`;
    if (rest.length) html += `<details class="credits-all"><summary>All credits</summary>${rest.map((r) => rowHtml(r, { extra: true })).join("")}</details>`;
    html += `</div>`;
  }
  html += renderSuggestions(amex);
  el.innerHTML = html || `<p class="empty">No credits loaded.</p>`;
  el.querySelectorAll(".toggle").forEach((b) => b.onclick = async () => {
    const c = credits.find((x) => x.id === b.dataset.id); const k = periodKey(c.period); const used = !marks[c.id + "|" + k];
    marks[c.id + "|" + k] = used; renderCredits();
    const { error } = await sb.from("credit_marks").upsert({ credit_id: c.id, period_key: k, used, updated_at: new Date().toISOString() });
    if (error) { toast("Couldn't save"); loadCredits(); }
  });
}
function renderAccounts(a) {
  if (!a) return `<div class="placeholder">Balances, spending by category, points and suggestions appear here once Amex is connected.</div>`;
  let h = `<div class="amex-grid">`;
  for (const c of a.cards || []) {
    const sub = c.due_date ? `due ${esc(fmtDay(c.due_date, { month: "short", day: "numeric" }))}${c.min_due != null ? " · min " + money(c.min_due, 2) : ""}${c.autopay ? " · AutoPay" : ""}` : esc(c.note || "");
    h += `<div class="amex-stat"><span>${esc(c.card)}${c.last4 ? " ··" + esc(c.last4) : ""}</span><b>${money(c.statement_balance, 2)}</b><span>statement · ${sub}</span>
      <span>${esc(c.total_label || "total balance")} ${money(c.total_balance, 2)}</span></div>`;
  }
  if (a.points != null) h += `<div class="amex-stat"><span>Membership Rewards</span><b>${nf(a.points, 0)}</b><span>points</span></div>`;
  h += `</div>`;
  return h;
}
function renderWelcome(a) {
  const wo = (a?.cards || []).find((c) => c.welcome_offer)?.welcome_offer;
  if (!wo) return "";
  return `<div class="money-sec"><div class="cardsum"><h3>Platinum welcome offer</h3><b>${money(wo.spent)} of ${money(wo.target)}</b></div>
    <div class="bar thin"><i style="width:${Math.min(100, wo.spent / wo.target * 100)}%"></i></div>
    <div class="small muted">${money(wo.target - wo.spent)} to go · by ${esc(fmtDay(wo.expires, { month: "short", day: "numeric", year: "numeric" }))}</div></div>`;
}
function renderSpending(a) {
  const cards = a?.spending?.cards; if (!cards?.length) return "";
  return `<div class="money-sec"><h3>Spending · statement period</h3>${cards.map((c) => {
    const mx = Math.max(...c.categories.map((x) => x.amount), 1);
    const delta = c.prev_total != null ? ` <span class="muted small">prev ${money(c.prev_total)}</span>` : "";
    return `<div style="margin-top:.5rem"><div class="cardsum"><span class="small">${esc(c.card)} · ${esc(c.period)}</span><b>${money(c.total, 2)}${delta}</b></div>
      ${c.categories.map((x) => `<div class="cat" title="${esc(x.note || "")}"><span>${esc(x.category)}${x.note ? ` <small class="muted">${esc(x.note)}</small>` : ""}</span><span>${money(x.amount, 2)}</span></div>
      <div class="bar thin"><i style="width:${x.amount / mx * 100}%"></i></div>`).join("")}</div>`;
  }).join("")}</div>`;
}
function renderSuggestions(a) {
  const items = (a?.suggestions || []).filter((s) => !/\bOura\b|Uber One/i.test(s)).slice(0, 3);
  if (!items.length) return "";
  return `<div class="money-sec"><h3>Suggestions</h3><ul class="suggest">${items.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>`;
}
/* ---------------- stay on the latest deploy ----------------
   index.html loads app.js?v=<APP_VERSION>; version.json is fetched uncached on open/foreground and if the
   deployed version differs we reload once (also when a new service worker takes control). */
const APP_VERSION = "2026-11-24.1";
async function checkVersion() {
  try {
    const { v } = await fetch("version.json?_=" + Date.now(), { cache: "no-store" }).then((r) => r.json());
    if (v && v !== APP_VERSION && sessionStorage.getItem("maree_reloaded") !== v) { sessionStorage.setItem("maree_reloaded", v); location.reload(); }
  } catch {}
}
checkVersion();
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkVersion(); });
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((r) => r.update()).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloaded && navigator.serviceWorker.controller) { reloaded = true; location.reload(); } });
}
