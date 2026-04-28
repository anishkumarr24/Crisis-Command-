import { db, auth } from "./firebase.js";
import {
  collection, onSnapshot, doc, updateDoc, addDoc,
  serverTimestamp, query, orderBy, getDocs, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ─── State ────────────────────────────────────────────────────────
let allAlerts = [];
let knownIds = new Set();
let unsubAlerts = null;
let analyticsOpen = false;
let escalateTimers = {};

// ─── Auth ─────────────────────────────────────────────────────────
onAuthStateChanged(auth, user => {
  if (user) {
    document.getElementById("login-gate").classList.add("hidden");
    document.getElementById("dashboard").classList.remove("hidden");
    document.getElementById("admin-email-display").textContent = user.email;
    startListening();
    startBroadcastListener();
  } else {
    document.getElementById("login-gate").classList.remove("hidden");
    document.getElementById("dashboard").classList.add("hidden");
    allAlerts = [];
    if (unsubAlerts) unsubAlerts();
  }
});

async function adminLogin() {
  const email = document.getElementById("login-email").value.trim();
  const pass = document.getElementById("login-password").value;
  const errEl = document.getElementById("login-error");
  errEl.classList.add("hidden");
  if (!email || !pass) {
    errEl.textContent = "Please enter email and password.";
    errEl.classList.remove("hidden");
    return;
  }
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    errEl.textContent = "Invalid credentials. Please try again.";
    errEl.classList.remove("hidden");
  }
}

async function adminLogout() {
  if (!confirm("Sign out of Crisis Command?")) return;
  await signOut(auth);
  allAlerts = [];
  knownIds.clear();
}

// ─── Real-time Alerts Listener ────────────────────────────────────
function startListening() {
  const q = query(collection(db, "alerts"), orderBy("reportedAt", "desc"));
  unsubAlerts = onSnapshot(q, snapshot => {
    snapshot.docChanges().forEach(change => {
      const data = { id: change.doc.id, ...change.doc.data() };
      if (change.type === "added" && !knownIds.has(data.id)) {
        if (data.severity === "Critical" || data.isSOS) {
          playAlertBeep();
          showToast(`🚨 New ${data.isSOS ? "SOS" : data.type} alert — ${data.room || "Unknown"}`, "danger");
        }
        knownIds.add(data.id);
        scheduleEscalation(data);
      }
      if (change.type === "removed") {
        knownIds.delete(change.doc.id);
      }
    });

    // Only rebuild from Firestore if we haven't just deleted locally
    allAlerts = snapshot.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(a => knownIds.has(a.id));

    updateStats();
    renderAlerts();
    if (analyticsOpen) renderAnalytics();
  });
}

// ─── Auto-Escalation ─────────────────────────────────────────────
function scheduleEscalation(data) {
  if (data.status !== "Pending" || escalateTimers[data.id]) return;
  const reportedMs = data.reportedAt?.toDate?.()?.getTime() || Date.now();
  const delay = Math.max(0, 10 * 60 * 1000 - (Date.now() - reportedMs));
  escalateTimers[data.id] = setTimeout(() => {
    const current = allAlerts.find(a => a.id === data.id);
    if (current && current.status === "Pending") {
      playAlertBeep();
      showToast(`⚠️ ESCALATE: ${current.type} in ${current.room} has been pending 10+ min`, "danger");
    }
  }, delay);
}

// ─── Stats ────────────────────────────────────────────────────────
function updateStats() {
  const pending  = allAlerts.filter(a => a.status === "Pending").length;
  const inprog   = allAlerts.filter(a => a.status === "In Progress").length;
  const resolved = allAlerts.filter(a => a.status === "Resolved").length;
  const sos      = allAlerts.filter(a => a.isSOS).length;

  const times = allAlerts
    .filter(a => a.respondedAt && a.reportedAt)
    .map(a => (a.respondedAt.toDate() - a.reportedAt.toDate()) / 60000);
  const avg = times.length
    ? (times.reduce((s, v) => s + v, 0) / times.length).toFixed(1) + " min"
    : "—";

  setStat("stat-total",      allAlerts.length);
  setStat("stat-pending",    pending);
  setStat("stat-inprogress", inprog);
  setStat("stat-resolved",   resolved);
  setStat("stat-avgtime",    avg);
  setStat("stat-sos",        sos);
}

function setStat(id, val) {
  const el = document.getElementById(id);
  if (el) el.querySelector(".stat-num").textContent = val;
}

// ─── Render Alerts ────────────────────────────────────────────────
function renderAlerts() {
  const search  = document.getElementById("search-input").value.toLowerCase();
  const fStatus = document.getElementById("filter-status").value;
  const fType   = document.getElementById("filter-type").value;
  const fSev    = document.getElementById("filter-severity").value;
  const sortBy  = document.getElementById("sort-by").value;

  let filtered = allAlerts.filter(a => {
    const haystack = [a.room, a.guestName, a.type, a.floor, a.zone, a.description, a.assignedTo]
      .join(" ").toLowerCase();
    return (!search || haystack.includes(search)) &&
      (fStatus === "all" || a.status === fStatus) &&
      (fType   === "all" || a.type   === fType)   &&
      (fSev    === "all" || a.severity === fSev);
  });

  if (sortBy === "oldest") filtered.reverse();
  else if (sortBy === "severity") {
    const order = { Critical: 0, Medium: 1, Low: 2 };
    filtered.sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));
  }

  const container = document.getElementById("alerts");
  container.innerHTML = "";

  if (!filtered.length) {
    container.innerHTML = `<div class="empty-state">No incidents match your filters.</div>`;
    return;
  }

  filtered.forEach(data => buildAlertCard(container, data));
}

function buildAlertCard(container, data) {
  const ageMin     = data.reportedAt ? ageMinutes(data.reportedAt.toDate()) : 0;
  const isEscalated = data.status === "Pending" && ageMin >= 10;
  const isResolved  = data.status === "Resolved";

  const div = document.createElement("div");
  div.className = [
    "alert-card",
    data.type.toLowerCase(),
    isResolved  ? "resolved-card" : "",
    isEscalated ? "escalated"     : ""
  ].join(" ");
  div.id = `card-${data.id}`;

  div.innerHTML = `
    <div class="card-header">
      <div class="card-title-row">
        <span class="type-icon">${typeIcon(data.type)}</span>
        <span class="card-type">${data.type}</span>
        <span class="severity-badge sev-${(data.severity || "low").toLowerCase()}">${data.severity || "—"}</span>
        ${data.isSOS      ? `<span class="sos-badge">🆘 SOS</span>`         : ""}
        ${isEscalated     ? `<span class="escalate-badge">⚠️ ESCALATE</span>` : ""}
        <span class="status-badge st-${statusKey(data.status)}">${data.status}</span>
      </div>
      <div class="card-age">${ageMin < 1 ? "Just now" : `${ageMin} min ago`}</div>
    </div>

    <div class="card-body">
      <div class="detail-grid">
        <div class="detail-item"><span class="dlabel">Floor</span><span>${data.floor || "—"}</span></div>
        <div class="detail-item"><span class="dlabel">Room</span><span>${data.room || "—"}</span></div>
        <div class="detail-item"><span class="dlabel">Zone</span><span>${data.zone || "—"}</span></div>
        <div class="detail-item"><span class="dlabel">People</span><span>${data.peopleCount || 1}</span></div>
        <div class="detail-item"><span class="dlabel">Guest</span><span>${data.guestName || "Anonymous"}</span></div>
        <div class="detail-item"><span class="dlabel">Phone</span><span>${data.phone || "—"}</span></div>
        <div class="detail-item"><span class="dlabel">Assigned</span><span>${data.assignedTo || "—"}</span></div>
        <div class="detail-item"><span class="dlabel">Reported</span><span>${data.reportedAt ? fmtTime(data.reportedAt.toDate()) : "—"}</span></div>
        ${data.respondedAt ? `<div class="detail-item"><span class="dlabel">Responded</span><span>${fmtTime(data.respondedAt.toDate())} <em>(${calcMin(data.reportedAt, data.respondedAt)} min)</em></span></div>` : ""}
        ${data.resolvedAt  ? `<div class="detail-item"><span class="dlabel">Resolved</span><span>${fmtTime(data.resolvedAt.toDate())}</span></div>` : ""}
      </div>

      ${data.description ? `<div class="detail-desc"><span class="dlabel">Details</span><p>${data.description}</p></div>` : ""}
      ${data.notes       ? `<div class="detail-desc notes-highlight"><span class="dlabel">📝 Staff note</span><p>${data.notes}</p></div>` : ""}
      ${data.gpsLat      ? `<div class="detail-desc"><a href="https://maps.google.com/?q=${data.gpsLat},${data.gpsLng}" target="_blank" class="map-link">📍 View on Google Maps</a></div>` : ""}
      ${data.photoURL    ? `<div class="photo-wrap"><img src="${data.photoURL}" class="incident-photo" title="Click to enlarge" data-url="${data.photoURL}"></div>` : ""}
    </div>

    <div class="card-controls">
      <div class="control-row">
        <input type="text" class="ctrl-input" placeholder="Assign to staff name…" id="assign-${data.id}" value="${data.assignedStaff || ""}">
        <button class="ghost-btn" data-action="assign" data-id="${data.id}">Assign</button>
      </div>
      <div class="control-row">
        <input type="text" class="ctrl-input" placeholder="Add a note for responders…" id="note-${data.id}" value="${data.notes || ""}">
        <button class="ghost-btn" data-action="note" data-id="${data.id}">Save note</button>
      </div>
      <div class="action-row">
        ${data.status === "Pending"    ? `<button class="primary-btn" data-action="start"   data-id="${data.id}">▶ Start Response</button>` : ""}
        ${data.status !== "Resolved"   ? `<button class="success-btn" data-action="resolve" data-id="${data.id}">✔ Resolve</button>`        : ""}
        <button class="ghost-btn"         data-action="log"    data-id="${data.id}">📋 Audit log</button>
        <button class="ghost-btn danger-ghost" data-action="delete" data-id="${data.id}">🗑 Delete</button>
      </div>
      <div class="log-panel hidden" id="log-${data.id}">
        <div class="log-loading">Loading…</div>
      </div>
    </div>
  `;

  // Photo click to open
  const photo = div.querySelector(".incident-photo");
  if (photo) photo.addEventListener("click", () => window.open(photo.dataset.url, "_blank"));

  // Card-level button delegation
  div.addEventListener("click", async e => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const id     = btn.dataset.id;

    if (action === "assign")  await assignStaff(id);
    if (action === "note")    await saveNote(id);
    if (action === "start")   await updateStatus(id, "In Progress");
    if (action === "resolve") await updateStatus(id, "Resolved");
    if (action === "log")     await toggleLog(id);
    if (action === "delete")  await deleteAlert(id);
  });

  container.appendChild(div);
}

// ─── Status Update ────────────────────────────────────────────────
async function updateStatus(id, status) {
  const updates = { status };
  if (status === "In Progress") updates.respondedAt = serverTimestamp();
  if (status === "Resolved")    updates.resolvedAt  = serverTimestamp();
  await updateDoc(doc(db, "alerts", id), updates);
  await logAudit(id, `Status → ${status}`);
  showToast(`Updated: ${status}`);
  clearTimeout(escalateTimers[id]);
}

// ─── Assign Staff ─────────────────────────────────────────────────
async function assignStaff(id) {
  const name = document.getElementById(`assign-${id}`)?.value?.trim();
  if (!name) return;
  await updateDoc(doc(db, "alerts", id), { assignedStaff: name, assignedTo: name });
  await logAudit(id, `Assigned to: ${name}`);
  showToast(`Assigned to ${name}`);
}

// ─── Notes ────────────────────────────────────────────────────────
async function saveNote(id) {
  const note = document.getElementById(`note-${id}`)?.value?.trim();
  if (!note) return;
  await updateDoc(doc(db, "alerts", id), { notes: note });
  await logAudit(id, `Note: ${note}`);
  showToast("Note saved");
}

// ─── Delete Alert ─────────────────────────────────────────────────
async function deleteAlert(id) {
  // Remove confirm() entirely — use inline confirmation instead
  const card = document.getElementById(`card-${id}`);
  if (!card) return;

  // Check if already showing confirmation
  if (card.querySelector('.delete-confirm-row')) return;

  const confirmRow = document.createElement('div');
  confirmRow.className = 'delete-confirm-row';
  confirmRow.style.cssText = 'display:flex;gap:8px;align-items:center;padding:8px 0;';
  confirmRow.innerHTML = `
    <span style="font-size:13px;color:#ff4d5e;">⚠️ Permanently delete this incident?</span>
    <button class="success-btn" id="confirm-del-${id}">Yes, Delete</button>
    <button class="ghost-btn" id="cancel-del-${id}">Cancel</button>
  `;
  card.querySelector('.card-controls').appendChild(confirmRow);

  document.getElementById(`cancel-del-${id}`).onclick = () => confirmRow.remove();

  document.getElementById(`confirm-del-${id}`).onclick = async () => {
    allAlerts = allAlerts.filter(a => a.id !== id);
    knownIds.delete(id);
    card.remove();
    updateStats();
    try {
      await deleteDoc(doc(db, "alerts", id));
      showToast("Incident deleted");
    } catch(e) {
      showToast("Delete failed", "danger");
    }
  };
}

// ─── Audit Log ────────────────────────────────────────────────────
async function logAudit(alertId, action) {
  try {
    await addDoc(collection(db, "auditLog"), {
      alertId, action,
      adminEmail: auth.currentUser?.email || "unknown",
      at: serverTimestamp()
    });
  } catch (_) {}
}

async function toggleLog(id) {
  const panel = document.getElementById(`log-${id}`);
  panel.classList.toggle("hidden");
  if (panel.classList.contains("hidden")) return;
  panel.innerHTML = `<div class="log-loading">Loading log…</div>`;

  try {
    const snap    = await getDocs(query(collection(db, "auditLog"), orderBy("at", "asc")));
    const entries = snap.docs.filter(d => d.data().alertId === id);
    panel.innerHTML = entries.length
      ? entries.map(d => {
          const data = d.data();
          const time = data.at ? fmtTime(data.at.toDate()) : "—";
          return `<div class="log-entry">🕐 <strong>${time}</strong> — ${data.action} <span class="log-admin">(${data.adminEmail || "admin"})</span></div>`;
        }).join("")
      : `<div class="log-entry muted">No log entries yet.</div>`;
  } catch (e) {
    panel.innerHTML = `<div class="log-entry muted">Could not load log.</div>`;
  }
}

// ─── Broadcast ────────────────────────────────────────────────────
function toggleBroadcast() {
  document.getElementById("broadcast-panel").classList.toggle("hidden");
}

async function sendBroadcast() {
  const msg   = document.getElementById("broadcast-msg").value.trim();
  const floor = document.getElementById("broadcast-floor").value;
  if (!msg) { showToast("Please type a message first.", "warn"); return; }
  await addDoc(collection(db, "broadcasts"), {
    message: msg, floor,
    sentBy:  auth.currentUser?.email || "admin",
    sentAt:  serverTimestamp()
  });
  document.getElementById("broadcast-msg").value = "";
  toggleBroadcast();
  showToast("📡 Broadcast sent!");
}

function startBroadcastListener() {
  const q = query(collection(db, "broadcasts"), orderBy("sentAt", "desc"));
  onSnapshot(q, snap => {
    const feed = document.getElementById("broadcasts-feed");
    if (!feed) return;
    const items = snap.docs.slice(0, 8).map(d => {
      const data  = d.data();
      const floor = data.floor === "all" ? "All floors" : data.floor;
      const time  = data.sentAt ? fmtTime(data.sentAt.toDate()) : "";
      return `<div class="bc-entry">📡 <strong>${floor}</strong>: ${data.message} <span class="bc-time">${time}</span></div>`;
    });
    feed.innerHTML = items.join("") || `<div class="empty-state small">No broadcasts yet.</div>`;
  });
}

// ─── Export CSV ───────────────────────────────────────────────────
function exportCSV() {
  const headers = ["ID","Type","Severity","Room","Floor","Zone","Guest","Phone","People","Description","Status","Assigned","Notes","Reported","Responded","Resolved","SOS"];
  const rows = allAlerts.map(a => [
    a.id.slice(0,8), a.type, a.severity || "", esc(a.room), esc(a.floor), esc(a.zone),
    esc(a.guestName), esc(a.phone), a.peopleCount || 1, `"${(a.description||"").replace(/"/g,"'")}"`,
    a.status, esc(a.assignedTo), `"${(a.notes||"").replace(/"/g,"'")}"`,
    a.reportedAt  ? fmtTime(a.reportedAt.toDate())  : "",
    a.respondedAt ? fmtTime(a.respondedAt.toDate()) : "",
    a.resolvedAt  ? fmtTime(a.resolvedAt.toDate())  : "",
    a.isSOS ? "YES" : "NO"
  ].join(","));

  const csv  = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `crisis-report-${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("📄 CSV exported");
}

// ─── Analytics ────────────────────────────────────────────────────
function toggleAnalytics() {
  analyticsOpen = !analyticsOpen;
  document.getElementById("analytics-panel").classList.toggle("hidden", !analyticsOpen);
  if (analyticsOpen) renderAnalytics();
}

function renderAnalytics() {
  const types  = ["Medical","Fire","Security","Structural","SOS","Other"];
  const colors = { Medical:"#22c55e", Fire:"#ef4444", Security:"#3b82f6", Structural:"#f59e0b", SOS:"#ec4899", Other:"#6b7280" };
  const counts = types.map(t => allAlerts.filter(a => a.type === t).length);
  const max    = Math.max(...counts, 1);

  document.getElementById("type-chart").innerHTML = types.map((t, i) => {
    const h = Math.max(4, (counts[i] / max * 100)).toFixed(0);
    return `<div class="bar-col">
      <div class="bar-fill" style="height:${h}%;background:${colors[t]}">${counts[i] > 0 ? counts[i] : ""}</div>
      <div class="bar-label">${t}</div>
    </div>`;
  }).join("");

  const critCount = allAlerts.filter(a => a.severity === "Critical").length;
  const resolved  = allAlerts.filter(a => a.status === "Resolved").length;
  const resRate   = allAlerts.length ? Math.round((resolved / allAlerts.length) * 100) : 0;
  const withPhoto = allAlerts.filter(a => a.photoURL).length;
  const withGPS   = allAlerts.filter(a => a.gpsLat).length;
  const today     = allAlerts.filter(a => {
    if (!a.reportedAt) return false;
    const d = a.reportedAt.toDate();
    return d.toDateString() === new Date().toDateString();
  }).length;

  document.getElementById("analytics-detail").innerHTML = [
    ["Critical incidents",  critCount],
    ["Resolution rate",     `${resRate}%`],
    ["With photos",         withPhoto],
    ["With GPS",            withGPS],
    ["Today's incidents",   today],
    ["SOS alerts",          allAlerts.filter(a => a.isSOS).length],
  ].map(([label, val]) =>
    `<div class="ana-card"><div class="ana-num">${val}</div><div class="ana-label">${label}</div></div>`
  ).join("");
}

// ─── Audio Alert ─────────────────────────────────────────────────
function playAlertBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.2, 0.4].forEach(offset => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = "sine"; osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.4, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.18);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.2);
    });
  } catch (_) {}
}

// ─── Toast ────────────────────────────────────────────────────────
function showToast(msg, type = "info") {
  const container = document.getElementById("toast-container");
  const t = document.createElement("div");
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 400); }, 4000);
}

// ─── Helpers ──────────────────────────────────────────────────────
function typeIcon(type) {
  return { Fire:"🔥", Medical:"🏥", Security:"🔒", Structural:"⚠️", SOS:"🆘", Other:"❓" }[type] || "❓";
}
function statusKey(s) {
  return { Pending:"pending", "In Progress":"inprogress", Resolved:"resolved" }[s] || "pending";
}
function fmtTime(date) {
  if (!date) return "—";
  return date.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" }) + " · " + date.toLocaleDateString();
}
function ageMinutes(date) { return Math.floor((Date.now() - date.getTime()) / 60000); }
function calcMin(start, end) {
  if (!start || !end) return "?";
  return ((end.toDate() - start.toDate()) / 60000).toFixed(1);
}
function esc(v) { return `"${(v || "").replace(/"/g, "'")}"`;  }

// ─── Attach All Event Listeners ───────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Login
  document.getElementById("login-btn")?.addEventListener("click", adminLogin);
  document.getElementById("login-password")?.addEventListener("keydown", e => {
    if (e.key === "Enter") adminLogin();
  });

  // Header actions
  document.getElementById("logout-btn")?.addEventListener("click", adminLogout);
  document.getElementById("broadcast-btn")?.addEventListener("click", toggleBroadcast);
  document.getElementById("analytics-btn")?.addEventListener("click", toggleAnalytics);
  document.getElementById("export-btn")?.addEventListener("click", exportCSV);

  // Broadcast panel
  document.getElementById("send-broadcast-btn")?.addEventListener("click", sendBroadcast);
  document.getElementById("cancel-broadcast-btn")?.addEventListener("click", toggleBroadcast);

  // Analytics panel
  document.getElementById("close-analytics-btn")?.addEventListener("click", toggleAnalytics);

  // Filters — re-render on change
  ["search-input","filter-status","filter-type","filter-severity","sort-by"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", renderAlerts);
    if (el) el.addEventListener("change", renderAlerts);
  });

  console.log("✅ admin.js loaded and all listeners attached.");
});