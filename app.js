import { db, storage } from "./firebase.js";
import {
  collection, addDoc, doc, onSnapshot, serverTimestamp, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// ─── Offline Detection ────────────────────────────────────────────
const offlineBanner = document.getElementById("offline-banner");
window.addEventListener("offline", () => offlineBanner.classList.remove("hidden"));
window.addEventListener("online", () => {
  offlineBanner.classList.add("hidden");
  flushOfflineQueue();
});
if (!navigator.onLine) offlineBanner.classList.remove("hidden");

// ─── Navigation ───────────────────────────────────────────────────
function showFullForm() {
  document.getElementById("sos-section").classList.add("hidden");
  document.getElementById("form-section").classList.remove("hidden");
}
function showSOS() {
  document.getElementById("form-section").classList.add("hidden");
  document.getElementById("sos-section").classList.remove("hidden");
}
function showTracker() {
  document.getElementById("form-section").classList.add("hidden");
  document.getElementById("sos-section").classList.add("hidden");
  document.getElementById("tracker-section").classList.remove("hidden");
}
function resetForm() {
  localStorage.removeItem("lastIncidentId");
  document.getElementById("tracker-section").classList.add("hidden");
  document.getElementById("sos-section").classList.remove("hidden");
  document.getElementById("submit-btn").disabled = false;
  document.getElementById("btn-text").classList.remove("hidden");
  document.getElementById("btn-spinner").classList.add("hidden");
}

// ─── Severity Selector ────────────────────────────────────────────
function setSeverity(btn) {
  document.querySelectorAll(".sev-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById("severity").value = btn.dataset.sev;
}

// ─── GPS ──────────────────────────────────────────────────────────
function getLocation() {
  const status = document.getElementById("gps-status");
  status.textContent = "⏳ Getting location…";
  if (!navigator.geolocation) { status.textContent = "❌ Not supported"; return; }
  navigator.geolocation.getCurrentPosition(
    pos => {
      document.getElementById("gpsLat").value = pos.coords.latitude;
      document.getElementById("gpsLng").value = pos.coords.longitude;
      status.textContent = `✅ ${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;
    },
    () => { status.textContent = "❌ Location unavailable"; }
  );
}

// ─── SOS One-Tap ─────────────────────────────────────────────────
async function triggerSOS() {
  console.log("SOS triggered!");
  const btn = document.getElementById("sos-btn");
  btn.disabled = true;
  btn.querySelector(".sos-label").textContent = "…";
  btn.querySelector(".sos-sub").textContent = "Sending SOS";

  let lat = "", lng = "";
  try {
    const pos = await new Promise((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { timeout: 3000 }));
    lat = pos.coords.latitude;
    lng = pos.coords.longitude;
  } catch (_) {}

  const data = buildAlertData({
    type: "SOS", severity: "Critical", room: "Unknown", floor: "Unknown",
    zone: "Unknown", guestName: "Anonymous", phone: "", peopleCount: 1,
    description: "One-tap SOS triggered — immediate assistance required.",
    gpsLat: lat, gpsLng: lng, photoURL: "", isSOS: true
  });

  try {
    console.log("Writing to Firestore...");
    const docRef = await addDoc(collection(db, "alerts"), data);
    console.log("SOS saved! ID:", docRef.id);
    btn.querySelector(".sos-label").textContent = "✓";
    btn.querySelector(".sos-sub").textContent = "Help is coming";
    showTracker();
    startTracker(docRef.id);
    document.getElementById("incident-id-display").textContent = docRef.id.slice(0, 8).toUpperCase();
    localStorage.setItem("lastIncidentId", docRef.id);
    document.getElementById("time-pending").textContent = new Date().toLocaleTimeString();
    setStep("pending");
  } catch (e) {
    console.error("SOS failed:", e);
    saveOffline(data);
    btn.querySelector(".sos-label").textContent = "SOS";
    btn.querySelector(".sos-sub").textContent = "Queued offline";
    btn.disabled = false;
    showToast("📶 Alert queued — will send when online.");
  }
}

// ─── Duplicate Prevention ─────────────────────────────────────────
function isDuplicate(room) {
  const key = `rcr_alert_${room.toLowerCase()}`;
  const last = localStorage.getItem(key);
  if (last && Date.now() - parseInt(last) < 5 * 60 * 1000) return true;
  localStorage.setItem(key, Date.now());
  return false;
}

// ─── Offline Queue ────────────────────────────────────────────────
function saveOffline(data) {
  const queue = JSON.parse(localStorage.getItem("rcrOfflineQueue") || "[]");
  queue.push(data);
  localStorage.setItem("rcrOfflineQueue", JSON.stringify(queue));
}
async function flushOfflineQueue() {
  const queue = JSON.parse(localStorage.getItem("rcrOfflineQueue") || "[]");
  if (!queue.length) return;
  let sent = 0;
  for (const data of queue) {
    try { await addDoc(collection(db, "alerts"), data); sent++; } catch (_) {}
  }
  if (sent) {
    localStorage.removeItem("rcrOfflineQueue");
    showToast(`✅ ${sent} offline alert(s) sent!`);
  }
}
if (navigator.onLine) flushOfflineQueue();

// ─── Photo Upload ─────────────────────────────────────────────────
async function uploadPhoto(file) {
  if (!file) return "";
  const fileRef = ref(storage, `incident-photos/${Date.now()}_${file.name}`);
  await uploadBytes(fileRef, file);
  return await getDownloadURL(fileRef);
}

// ─── Build Alert Data ─────────────────────────────────────────────
function buildAlertData({ type, severity, room, floor, zone, guestName, phone,
  peopleCount, description, gpsLat, gpsLng, photoURL, isSOS = false }) {
  const assignedMap = {
    Fire: "Security + Fire Safety Team", Medical: "First Aid Staff",
    Security: "Security Guards", Structural: "Maintenance Team",
    SOS: "All Security Staff", Other: "Duty Manager"
  };
  return {
    type, severity, room, floor, zone, guestName, phone, peopleCount,
    description, gpsLat, gpsLng, photoURL, isSOS,
    status: "Pending",
    assignedTo: assignedMap[type] || "Duty Manager",
    assignedStaff: "",
    notes: "",
    reportedAt: serverTimestamp(),
    respondedAt: null,
    resolvedAt: null
  };
}

// ─── Main Send Alert ──────────────────────────────────────────────
async function sendAlert() {
  const room = document.getElementById("room").value.trim() || "Unknown";

  if (isDuplicate(room)) {
    showToast("⚠️ An alert for this room was already sent in the last 5 minutes.", "warn");
    return;
  }

  setLoading(true);

  let photoURL = "";

  const data = buildAlertData({
    type: document.getElementById("type").value,
    severity: document.getElementById("severity").value,
    room,
    floor: document.getElementById("floor").value,
    zone: document.getElementById("zone").value,
    guestName: document.getElementById("guestName").value.trim() || "Anonymous",
    phone: document.getElementById("phone").value.trim(),
    peopleCount: parseInt(document.getElementById("peopleCount").value) || 1,
    description: document.getElementById("description").value.trim(),
    gpsLat: document.getElementById("gpsLat").value,
    gpsLng: document.getElementById("gpsLng").value,
    photoURL
  });

  try {
    const docRef = await addDoc(collection(db, "alerts"), data);
    setLoading(false);
    showTracker();
    document.getElementById("incident-id-display").textContent = docRef.id.slice(0, 8).toUpperCase();
    localStorage.setItem("lastIncidentId", docRef.id);
    document.getElementById("time-pending").textContent = new Date().toLocaleTimeString();
    setStep("pending");
    startTracker(docRef.id);
  } catch (e) {
    setLoading(false);
    saveOffline(data);
    showToast("📶 Offline — alert saved and will send automatically.", "warn");
  }
}

// ─── Live Status Tracker ──────────────────────────────────────────
function startTracker(id) {
  const unsubscribe = onSnapshot(doc(db, "alerts", id), snap => {
    if (!snap.exists()) return;
    const data = snap.data();

    if (data.status === "Pending") setStep("pending");
    else if (data.status === "In Progress") {
      setStep("inprogress");
      if (data.respondedAt) document.getElementById("time-inprogress").textContent = fmtTime(data.respondedAt.toDate());
    } else if (data.status === "Resolved") {
      setStep("resolved");
      if (data.resolvedAt) document.getElementById("time-resolved").textContent = fmtTime(data.resolvedAt.toDate());
      unsubscribe();
    }

    const assignedBox = document.getElementById("assigned-box");
    if (data.assignedStaff) {
      assignedBox.innerHTML = `<div class="tracker-info-row">👤 Responding: <strong>${data.assignedStaff}</strong></div>`;
    } else if (data.assignedTo) {
      assignedBox.innerHTML = `<div class="tracker-info-row">👥 Assigned to: <strong>${data.assignedTo}</strong></div>`;
    }

    if (data.notes) {
      document.getElementById("notes-box").innerHTML =
        `<div class="tracker-info-row">📝 Staff note: <em>${data.notes}</em></div>`;
    }
  });
}

function setStep(active) {
  const steps = ["pending", "inprogress", "resolved"];
  const idx = steps.indexOf(active);
  steps.forEach((s, i) => {
    const el = document.getElementById(`step-${s}`);
    el.classList.remove("active", "done");
    if (i < idx) el.classList.add("done");
    else if (i === idx) el.classList.add("active");
  });
}

// ─── Helpers ──────────────────────────────────────────────────────
function setLoading(on) {
  document.getElementById("submit-btn").disabled = on;
  document.getElementById("btn-text").classList.toggle("hidden", on);
  document.getElementById("btn-spinner").classList.toggle("hidden", !on);
}

function fmtTime(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function showToast(msg, type = "info") {
  const container = document.getElementById("toast-container");
  const t = document.createElement("div");
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 400); }, 4000);
}

// ─── Attach All Event Listeners (replaces all inline onclicks) ────
document.addEventListener("DOMContentLoaded", () => {
  startBroadcastListener();
  // SOS button
  document.getElementById("sos-btn")?.addEventListener("click", triggerSOS);

  // Navigation buttons
  document.getElementById("show-form-btn")?.addEventListener("click", showFullForm);
  document.getElementById("back-btn")?.addEventListener("click", showSOS);
  document.getElementById("reset-btn")?.addEventListener("click", resetForm);

  // GPS
  document.getElementById("gps-btn")?.addEventListener("click", getLocation);

  // Submit
  document.getElementById("submit-btn")?.addEventListener("click", sendAlert);

  // Severity buttons
  document.querySelectorAll(".sev-btn").forEach(btn => {
    btn.addEventListener("click", () => setSeverity(btn));
  });

  // Photo preview
  document.getElementById("photo")?.addEventListener("change", function () {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      document.getElementById("photo-preview").src = e.target.result;
      document.getElementById("photo-preview-wrap").classList.remove("hidden");
    };
    reader.readAsDataURL(file);
  });

  console.log("✅ app.js loaded and all listeners attached.");
  // Auto-resume tracking if guest returns to page
const savedId = localStorage.getItem("lastIncidentId");
if (savedId) {
  document.getElementById("sos-section").classList.add("hidden");
  document.getElementById("tracker-section").classList.remove("hidden");
  document.getElementById("incident-id-display").textContent = savedId.slice(0, 8).toUpperCase();
  
  // Add a "New SOS" button so they can start fresh
  const resetBtn = document.getElementById("reset-btn");
  if (resetBtn) resetBtn.textContent = "← Submit a new alert";
  
  startTracker(savedId);
  setStep("pending");
}

// Clear saved ID when they start fresh
document.getElementById("reset-btn")?.addEventListener("click", () => {
  localStorage.removeItem("lastIncidentId");
});
function startBroadcastListener() {
  const q = query(
    collection(db, "broadcasts"),
    orderBy("sentAt", "desc"),
    limit(1)
  );
  onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === "added") {
        const data = change.doc.data();
        showBroadcastBanner(data.message);
      }
    });
  });
}

function showBroadcastBanner(message) {
  document.getElementById("broadcast-banner")?.remove();
  const banner = document.createElement("div");
  banner.id = "broadcast-banner";
  banner.style.cssText = `
    position:fixed; top:0; left:0; right:0; z-index:9999;
    background:#b45309; color:white; padding:14px 18px;
    display:flex; align-items:center; gap:12px;
    font-family:sans-serif; animation:slideDown 0.3s ease;
  `;
  banner.innerHTML = `
    <span style="font-size:22px">📢</span>
    <div>
      <div style="font-weight:bold;font-size:13px">Hotel Announcement</div>
      <div style="font-size:14px;margin-top:2px">${message}</div>
    </div>
    <button onclick="document.getElementById('broadcast-banner').remove()"
      style="margin-left:auto;background:none;border:none;color:white;font-size:20px;cursor:pointer">✕</button>
  `;
  document.body.prepend(banner);
  setTimeout(() => document.getElementById("broadcast-banner")?.remove(), 15000);
}
});