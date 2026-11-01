# My Khata — Setup Checklist (new Firebase account)

Tick each box as you go. Do the steps in order.

## A. One-time tools on your computer
- [ ] Install Node.js 24.x (not 26.x) from https://nodejs.org and check: `node -v`
- [ ] In PowerShell, install Firebase CLI to your user account (no Administrator rights needed):
  ```powershell
  npm.cmd config set prefix "$env:APPDATA\npm"
  npm.cmd install -g firebase-tools
  ```
- [ ] Add `%APPDATA%\npm` to your user `Path` in Windows Environment Variables, then reopen PowerShell; check with `firebase --version`
- [ ] Log in with the NEW Google account: `firebase login` (use `firebase logout` first if an old account is logged in)

## B. Create the Firebase project (console.firebase.google.com)
- [ ] Add project -> name it (e.g. my-khata) -> note the **Project ID**
- [ ] Google Analytics: turn OFF (the app promises no analytics)
- [ ] Project settings (gear) -> General -> set **Public-facing name** and **Support email**

## C. Register the web app and get config
- [ ] Project overview -> click **</> Web** icon -> nickname "My Khata"
- [ ] Tick **"Also set up Firebase Hosting"** (optional) -> Register app
- [ ] Copy the `firebaseConfig` values into `public/firebase-config.js`
- [ ] Put the same Project ID into `.firebaserc`

## D. Enable Authentication (this fixes the "sign-in method is not enabled" error)
- [ ] Build -> Authentication -> **Get started**
- [ ] Sign-in method -> **Email/Password** -> Enable -> Save (leave "Email link" off)
- [ ] Sign-in method -> **Google** -> Enable -> choose **Project support email** -> Save
- [ ] Settings -> **Authorized domains**: confirm `YOUR-PROJECT-ID.web.app` and `YOUR-PROJECT-ID.firebaseapp.com` are listed (add your custom domain if you use one)
- [ ] (Optional) Templates -> Email verification: edit sender name / subject to say "My Khata"

## E. Create Firestore
- [ ] Build -> Firestore Database -> **Create database**
- [ ] Edition: Standard. Location: choose **asia-south1 (Mumbai)** for India. This CANNOT be changed later.
- [ ] Mode: **Production mode** (our rules file replaces the default rules)

## F. Add your legal details
- [ ] Open `public/privacy.html` and `public/terms.html`: replace every [bracket] (date, your name, email, minimum age), then delete the yellow "Template" note

## G. Deploy
In a terminal, inside the `my-khata` folder:
- [ ] `firebase use YOUR-PROJECT-ID` (check with `firebase projects:list`)
- [ ] `firebase deploy --only firestore` (rules + indexes)
- [ ] `firebase deploy --only hosting`
- [ ] Open the Hosting URL printed at the end (https://YOUR-PROJECT-ID.web.app)

## H. Test everything (use the live URL)
- [ ] Create account with email + password -> verification email arrives (check spam) -> click link -> "I've verified — continue"
- [ ] Sign in with Google works
- [ ] Default payment modes appear (Cash, UPI, Debit Card, Credit Card, Net Banking)
- [ ] Add a YOU GAVE and a YOU GOT entry; balance and totals update
- [ ] Edit and delete an entry
- [ ] Menu -> Payment modes: add one, remove one
- [ ] Export CSV opens correctly
- [ ] Turn off Wi-Fi, add an entry, turn Wi-Fi on: entry syncs
- [ ] Open the app on a second device or browser: same data appears live
- [ ] Sign out, then sign in as a different account: you see none of the first account's data
- [ ] Firebase console -> Firestore -> Data: data sits only under `users/{uid}/...`
- [ ] Menu -> Delete account & data with a TEST account: account disappears in Authentication -> Users
- [ ] Phone: open the URL in Chrome -> "Install app" / "Add to Home screen"

## I. Protect your project (strongly recommended)
- [ ] Google Cloud console -> Billing -> **Budgets & alerts**: set a small budget alert (the Spark free plan needs no card, but alerts are good practice)
- [ ] Google Cloud console -> APIs & Services -> Credentials -> your Browser API key -> **Application restrictions: Websites** -> add `https://YOUR-PROJECT-ID.web.app/*` and `https://YOUR-PROJECT-ID.firebaseapp.com/*` (add `http://localhost:*` only if you test locally)
- [ ] Authentication -> Settings -> **User actions**: keep "Email enumeration protection" ON
- [ ] (Optional) App Check with reCAPTCHA Enterprise to block non-app traffic

## J. Every future release
- [ ] Edit files -> bump `CACHE_NAME` in `public/sw.js` (v1 -> v2 ...) -> `firebase deploy --only hosting`

## Troubleshooting quick table
| Message | Fix |
|---|---|
| `npm.ps1` cannot be loaded because it is not digitally signed | In PowerShell, run `npm.cmd install -g firebase-tools`; this avoids changing your execution policy |
| `EPERM` trying to create `C:\Program Files\nodejs\node_modules\firebase-tools` | Set npm's user prefix with `npm.cmd config set prefix "$env:APPDATA\npm"`, then install again; add `%APPDATA%\npm` to your user `Path` and reopen PowerShell |
| `EBADENGINE` says Node 26 is unsupported | Install and use Node.js 24.x, which is supported by the Firebase CLI dependency |
| This sign-in method is not enabled | Step D: enable that provider |
| Authentication is not set up yet (configuration-not-found) | Step D: click **Get started** |
| auth/unauthorized-domain | Step D: add the domain to Authorized domains |
| API key not valid | Re-copy config into `firebase-config.js` (Step C) |
| permission-denied / "No permission" | Email not verified, or rules not deployed (Step G) |
| Old page keeps showing | Bump `CACHE_NAME`, redeploy, hard refresh |
| Firestore "database does not exist" | Step E |
