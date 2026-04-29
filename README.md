Crisis Command
Crisis Command is a zero-friction, web-based emergency response platform designed to bridge the gap between a guest in distress and the security team.

🌟 Features
1. Guest Emergency Portal (index.html): Guests can trigger a one-tap SOS or fill out a detailed incident form specifying the emergency type (Medical, Fire, Security, etc.), floor, room, and people affected.

2. Real-Time Admin Dashboard (admin.html): A secure, login-protected dashboard for security staff to view and manage incoming alerts in real-time.

3. Offline Support: Includes an offline banner and local storage queue to save alerts when disconnected. The app automatically sends queued alerts once the network connection is restored.

4. Live Status Tracking: Guests can track the status of their alert (Pending, Responder en route, Incident resolved) and see assigned responders.

5. Analytics & Export: Admins can view incident analytics, track average response times, and export crisis reports to CSV.

6. Broadcast System: Admins can send hotel-wide announcements or floor-specific broadcast messages directly to the guest portal.

🛠 Tech Stack
1. Frontend: HTML5, CSS3 (style.css), and Vanilla JavaScript (app.js, admin.js).

2. Backend: Firebase.
   • Firestore: Real-time database for alerts, broadcasts, and audit logs.
   • Firebase Auth: Secures the admin dashboard.
   • Firebase Storage: Handles incident photo uploads.
   • Firebase Hosting: Managed via firebase.json      and firebaserc.

📂 Project Structure
1. index.html & app.js: The guest-facing SOS portal,    form submission, GPS tracking, and status timeline logic.

2. admin.html & admin.js: The admin command center, login gate, analytics, and broadcast logic.

3. style.css: The "Industrial Command Center" theme styling, providing a dark, high-contrast, military-grade UI with red alert accents.

4. firebase.js: Firebase configuration, initialization, and recommended Firestore security rules.

5. firebase.json, .firebaserc, .gitignore: Deployment, hosting, and Git ignore configurations for a Firebase project.

6. 404.html: A custom page-not-found route generated for Firebase Hosting.

🚀 Setup & Installation
1. Clone the repository and navigate to the project directory.

2. Since this project relies on Firebase, ensure you have your Firebase project configured. The current configuration points to crisis-response-e0aef.

3. Serve the project locally using any standard local web server (e.g., Live Server, Python HTTP server).

4. To deploy to production, install the Firebase CLI and run firebase deploy.  