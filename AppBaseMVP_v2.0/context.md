# context.md — KhataBase (private, multiple ledgers per user)

## 1. What it is
**KhataBase** is a personal expense ledger (digital "khata") as an installable web app (PWA).
Each user signs in and gets their **own private khatabooks**. Nothing is shared between users and there is
no sharing feature. Data is stored in Firebase Firestore, syncs live across the user's own devices, and works offline.
Currency is ₹ (Indian digit grouping).

## 2. Privacy-first design
- Data lives only under `users/{uid}/...`; rules allow just that signed-in, email-verified user.
- Nothing about other users is ever loaded; account email is stored only in Firebase Auth, not in the app database. User-entered khatabook names are stored with their ledgers.
- No analytics, ads, trackers, or Google Fonts (system fonts) — no third-party requests besides Firebase.
- Sign-out erases the browser's offline copy; `Referrer-Policy: no-referrer`, `nosniff`, framing disabled, camera/mic/location denied via headers.
- **Delete account & data** removes all khatabooks, entries, payment modes and the account (re-authentication + typing DELETE required).
- CSV export neutralises spreadsheet-formula text (`= + - @`) in notes/payment modes.
- User-entered text is HTML-escaped when rendered.

## 3. Features
**Accounts:** Google sign-in (popup, redirect fallback); email + password with required email verification; forgot-password email; sign out; delete account & data.

**Entries:** YOU GAVE / YOU GOT with amount (₹), date (default today), payment mode (required), optional note (≤ 200). Grouped by date (newest first) with running balance per entry. Edit (type, amount, date, payment mode, note) and delete with confirmation.

**Khatabooks:** Separate ledgers can be created for vendors, categories or any other purpose. Switch books from the selector at the top. Create and rename names (case-insensitive duplicates are blocked); stable book IDs keep entries intact when renamed. Deleting moves a book to History, where it can be restored or permanently deleted with all its entries. The last active book cannot be deleted. The selected book is remembered in device-local storage for each account. Existing entries stay in the original default book.

**Book categories:** Organize khatabooks into named categories from the top-left category switcher. Categories can be created, renamed and deleted; deleting a category prompts to either move its khatabooks to another category or archive them in History and move them. New khatabooks use the selected category, and existing khatabooks can be moved without changing their entries. The last selected category and last khatabook in each category are remembered on the device. Existing accounts are migrated to a “General” category without moving or rewriting their entries.
**Setup:** No new API server or dependency is required. Deploy the updated Firestore rules (`firebase deploy --only firestore:rules`) before using category writes; existing users are migrated automatically at sign-in.

**Balance:** Net Expenses = Gave − Got (coloured), plus Gave and Got totals.

**Payment modes (per user, add/remove):**
- Defaults on first sign-in: Cash, UPI, Debit Card, Credit Card, Net Banking.
- Add from the entry form ("＋ Add new payment mode…", which then selects it) or from **Menu → Payment modes**.
- Remove from Menu → Payment modes. At least one must remain; max 30; names up to 40 chars; duplicates (case-insensitive) blocked.
- Entries store the mode name as text, so removing a mode never alters past entries; editing an old entry still shows its original mode.

**Export:** CSV of entries in the selected khatabook (Date, Type, Amount, Note, Payment Mode, Balance After).

**Sync / offline / PWA:** real-time listeners; offline writes queue and sync on reconnect; installable; network-first service worker that ignores Firebase and `/__/` auth traffic.

## 4. Tech stack
| Layer | Technology |
|---|---|
| UI | Single `index.html`, vanilla JS ES module + CSS, no build step |
| Auth | Firebase Authentication (Google, Email/Password, verification) |
| Database | Cloud Firestore with persistent local cache |
| Hosting | Firebase Hosting |
| SDK | Firebase JS 10.12.2 ES modules from `gstatic.com` |

## 5. Files
| File | Purpose |
|---|---|
| `public/index.html` | Views (sign-in, verify, app), styles, state, rendering, modals |
| `public/db.js` | Auth, categories, khatabooks, entries, payment modes, delete-everything |
| `public/firebase-config.js` | Firebase web config |
| `public/sw.js` | Service worker (`CACHE_NAME` bumped per release) |
| `public/manifest.json` | PWA manifest ("KhataBase") |
| `public/privacy.html`, `terms.html` | Legal templates to complete |
| `public/icon-192.png`, `icon-512.png` | PWA icons |
| `firestore.rules` | Owner-only access + data validation |
| `firestore.indexes.json` | Firestore indexes (none needed) |
| `.firebaserc` | Links this folder to your Firebase project id |
| `firebase.json` | Hosting config + security headers |

## 6. Data model
```
users/{uid}/entries/{entryId}
    id, date("DD-MM-YYYY"), type("gave"|"got"), amount, note, paymentMode(text), createdAt(ms)
users/{uid}/paymentModes/{modeId}
    name, createdAt(ms)          (defaults use fixed ids: cash, upi, debit-card, credit-card, net-banking)
users/{uid}/books/{bookId}
    name, createdAt(ms), categoryId, deletedAt(ms, optional)
users/{uid}/books/{bookId}/entries/{entryId}
    id, date, type, amount, note, paymentMode, createdAt
users/{uid}/bookNames/{encodedLowercaseName}
    bookId                    (unique name reservation; deleted books keep their reservation)
users/{uid}/categories/{categoryId}
    name, createdAt(ms)
users/{uid}/categoryNames/{encodedLowercaseName}
    categoryId                (unique category-name reservation)
```
The stable `default` book continues to use the original `users/{uid}/entries` collection so existing users' entries remain available without an online migration.

## 7. `db.js` API
Auth: `onUser, currentUser, usesPassword, signInGoogle, signUpEmail, signInEmail, resendVerification, refreshUser, resetPassword, signOutUser, checkRedirect, reauthenticate, eraseEverything`.
Khatabooks: `ensureDefaultBook, watchBooks, createBook(name, categoryId), renameBook, moveBookToCategory, softDeleteBook, restoreBook, permanentlyDeleteBook`.
Categories: `ensureDefaultCategory, watchCategories, createCategory, renameCategory, deleteCategory`.
Entries: `watchEntries(bookId, ...), addEntry(bookId, ...), updateEntry(bookId, ...), deleteEntry(bookId, ...)`.
Modes: `watchModes, seedDefaultModes, addMode, removeMode`.

## 8. Known limitations
No extra app PIN lock; offline copy persists until sign-out; public sign-up (rely on quotas + App Check); list items can't be validated in rules (hence one document per payment mode); account recovery depends on email; not load-tested. Creating or renaming khatabooks and categories requires a network connection for transactional name reservations; deleting a category also requires a connection. Entry operations and moving an individual khatabook remain offline-capable.

## 9. Ideas for later
App PIN/biometric lock and auto-sign-out after inactivity; search and monthly summaries; CSV import; encrypted notes (client-side) for maximum privacy.
