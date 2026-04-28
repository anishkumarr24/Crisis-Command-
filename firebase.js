import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyD0Vh3eprrqQ5mK4Ra7hCYvb7jkIcZt6Po",
  authDomain: "crisis-response-e0aef.firebaseapp.com",
  projectId: "crisis-response-e0aef",
  storageBucket: "crisis-response-e0aef.firebasestorage.app",
  messagingSenderId: "354864162919",
  appId: "1:354864162919:web:b1d42c383d14f60b2c8cc2"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

export { db, auth, storage };

/*
 * ─── RECOMMENDED FIRESTORE SECURITY RULES ───────────────────────
 * Paste these in Firebase Console → Firestore → Rules
 *
 * rules_version = '2';
 * service cloud.firestore {
 *   match /databases/{database}/documents {
 *     match /alerts/{alertId} {
 *       allow create: if true;
 *       allow read, update: if request.auth != null;
 *     }
 *     match /auditLog/{logId} {
 *       allow read, write: if request.auth != null;
 *     }
 *     match /broadcasts/{id} {
 *       allow read: if true;
 *       allow write: if request.auth != null;
 *     }
 *   }
 * }
 */