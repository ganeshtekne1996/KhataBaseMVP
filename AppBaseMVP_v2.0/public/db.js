// Auth + data layer for KhataBase (private, multiple ledgers per user).
// All data lives under users/{uid}/...  — nothing is shared between users.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, EmailAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification,
  sendPasswordResetEmail, signOut, reauthenticateWithCredential, reauthenticateWithPopup, deleteUser
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, query, orderBy, limit, onSnapshot, getDocs, getDocsFromServer,
  setDoc, updateDoc, deleteDoc, deleteField, writeBatch, runTransaction, getDocFromServer,
  terminate, clearIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

/* ================= Auth ================= */
export const onUser = (cb) => onAuthStateChanged(auth, cb);
export const currentUser = () => auth.currentUser;
export const checkRedirect = () => getRedirectResult(auth);
export const usesPassword = () => !!auth.currentUser && auth.currentUser.providerData.some((p) => p.providerId === "password");

export async function signInGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    return await signInWithPopup(auth, provider);
  } catch (err) {
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(err.code)) {
      return signInWithRedirect(auth, provider);   // popups blocked: use full-page redirect
    }
    throw err;
  }
}
export async function signUpEmail(email, password) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await sendEmailVerification(cred.user);
  return cred.user;
}
export const signInEmail = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const resendVerification = () => sendEmailVerification(auth.currentUser);
export const resetPassword = (email) => sendPasswordResetEmail(auth, email);

// After the user clicks the emailed link: reload profile + refresh token so rules see email_verified.
export async function refreshUser() {
  await auth.currentUser.reload();
  await auth.currentUser.getIdToken(true);
  return auth.currentUser;
}

async function wipeLocalCache() {
  try { await terminate(db); await clearIndexedDbPersistence(db); } catch (e) { console.warn(e); }
}
// Sign out AND erase the offline copy, so the next person on this device sees nothing.
export async function signOutUser() {
  await signOut(auth);
  await wipeLocalCache();
}

/* ================= Account + data deletion ================= */
// Step 1: prove it's really the owner (required by Firebase for account deletion).
export async function reauthenticate(password) {
  const u = auth.currentUser;
  if (usesPassword()) {
    await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, password));
  } else {
    await reauthenticateWithPopup(u, new GoogleAuthProvider());
  }
}
async function wipeCollection(name, uid = auth.currentUser.uid) {
  for (;;) {
    const snap = await getDocs(query(collection(db, "users", uid, name), limit(400)));
    if (snap.empty) break;
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}
async function wipeEntries(bookId, uid = auth.currentUser.uid) {
  const entries = bookId === "default"
    ? collection(db, "users", uid, "entries")
    : collection(db, "users", uid, "books", bookId, "entries");
  for (;;) {
    const snap = await getDocsFromServer(query(entries, limit(400)));
    if (snap.empty) break;
    const batch = writeBatch(db);
    snap.docs.forEach((entry) => batch.delete(entry.ref));
    await batch.commit();
  }
}
// Step 2: permanently delete every book, entry + payment mode, then the account itself.
export async function eraseEverything() {
  if (!navigator.onLine) throw new Error("You must be online to delete your account.");
  const user = auth.currentUser;
  const uid = user.uid;
  await wipeCollection("entries", uid);
  await wipeCollection("paymentModes", uid);
  await wipeCollection("bookNames", uid);
  await wipeCollection("categoryNames", uid);
  await wipeCollection("categories", uid);
  const books = await getDocsFromServer(collection(db, "users", uid, "books"));
  for (const book of books.docs) await wipeEntries(book.id, uid);
  for (let i = 0; i < books.docs.length; i += 400) {
    const batch = writeBatch(db);
    books.docs.slice(i, i + 400).forEach((book) => batch.delete(book.ref));
    await batch.commit();
  }
  await deleteUser(user);
  await wipeLocalCache();
}

/* ================= Khatabooks ================= */
const booksCol = (uid = auth.currentUser.uid) => collection(db, "users", uid, "books");
const bookDoc = (id, uid = auth.currentUser.uid) => doc(db, "users", uid, "books", id);
const bookNameDoc = (name, uid = auth.currentUser.uid) => doc(db, "users", uid, "bookNames",
  encodeURIComponent(name.trim().toLowerCase()));
const newBookId = () => "b_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
const categoriesCol = (uid = auth.currentUser.uid) => collection(db, "users", uid, "categories");
const categoryDoc = (id, uid = auth.currentUser.uid) => doc(db, "users", uid, "categories", id);
const categoryNameDoc = (name, uid = auth.currentUser.uid) => doc(db, "users", uid, "categoryNames",
  encodeURIComponent(name.trim().toLowerCase()));
const DEFAULT_CATEGORY_ID = "cat_default";
const DEFAULT_CATEGORY_NAME = "General";
const LEGACY_DEFAULT_CATEGORY_NAME = "Uncategorized";
const newCategoryId = () => "c_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);

export async function ensureDefaultCategory() {
  const uid = auth.currentUser.uid;
  const defaultRef = categoryDoc(DEFAULT_CATEGORY_ID, uid);
  const defaultNameRef = categoryNameDoc(DEFAULT_CATEGORY_NAME, uid);
  const createLocally = async () => {
    await setDoc(defaultRef, { name: DEFAULT_CATEGORY_NAME, createdAt: Date.now() }, { merge: true });
    await setDoc(defaultNameRef, { categoryId: DEFAULT_CATEGORY_ID });
  };
  let categories;
  let categoriesFromServer = false;
  if (navigator.onLine) {
    try {
      categories = await getDocsFromServer(categoriesCol(uid));
      categoriesFromServer = true;
    } catch (error) {
      if (!["unavailable", "deadline-exceeded"].includes(error.code)) throw error;
      categories = await getDocs(categoriesCol(uid));
    }
  } else {
    categories = await getDocs(categoriesCol(uid));
  }
  if (categories.empty) {
    if (!navigator.onLine || !categoriesFromServer) {
      await createLocally();
    } else {
      try {
        await runTransaction(db, async (transaction) => {
          const [existingCategory, existingName] = await Promise.all([
            transaction.get(defaultRef), transaction.get(defaultNameRef)
          ]);
          if (existingCategory.exists()) return;
          if (existingName.exists() && existingName.data().categoryId !== DEFAULT_CATEGORY_ID) {
            throw new Error("The default category name is already in use.");
          }
          transaction.set(defaultRef, { name: DEFAULT_CATEGORY_NAME, createdAt: Date.now() });
          transaction.set(defaultNameRef, { categoryId: DEFAULT_CATEGORY_ID });
        });
      } catch (error) {
        if (!["unavailable", "deadline-exceeded"].includes(error.code)) throw error;
        await createLocally();
      }
    }
  }

  if (categoriesFromServer) {
    const legacyNameRef = categoryNameDoc(LEGACY_DEFAULT_CATEGORY_NAME, uid);
    await runTransaction(db, async (transaction) => {
      const currentCategory = await transaction.get(defaultRef);
      if (!currentCategory.exists() || currentCategory.data().name !== LEGACY_DEFAULT_CATEGORY_NAME) return;
      const [legacyName, defaultName] = await Promise.all([
        transaction.get(legacyNameRef), transaction.get(defaultNameRef)
      ]);
      if (defaultName.exists() && defaultName.data().categoryId !== DEFAULT_CATEGORY_ID) return;
      if (legacyName.exists() && legacyName.data().categoryId === DEFAULT_CATEGORY_ID) {
        transaction.delete(legacyNameRef);
      }
      transaction.set(defaultNameRef, { categoryId: DEFAULT_CATEGORY_ID });
      transaction.update(defaultRef, { name: DEFAULT_CATEGORY_NAME });
    });
  }

  const categoryIds = categories.empty
    ? [DEFAULT_CATEGORY_ID]
    : categories.docs.map((category) => category.id);
  const migrationCategoryId = categoryIds.includes(DEFAULT_CATEGORY_ID) ? DEFAULT_CATEGORY_ID : categoryIds[0];
  const books = await getDocs(booksCol(uid));
  const legacyBooks = books.docs.filter((book) => !book.data().categoryId);
  for (let i = 0; i < legacyBooks.length; i += 400) {
    const batch = writeBatch(db);
    legacyBooks.slice(i, i + 400).forEach((book) => batch.update(book.ref, { categoryId: migrationCategoryId }));
    await batch.commit();
  }
}

export function watchCategories(cb, onError) {
  return onSnapshot(query(categoriesCol(), orderBy("createdAt", "asc")),
    (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}

export async function createCategory(name) {
  const uid = auth.currentUser.uid;
  const id = newCategoryId();
  const createdAt = Date.now();
  const nameRef = categoryNameDoc(name, uid);
  await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(nameRef);
    if (existing.exists()) {
      const error = new Error("A category with that name already exists.");
      error.code = "category-name-taken";
      throw error;
    }
    transaction.set(categoryDoc(id, uid), { name: name.trim(), createdAt });
    transaction.set(nameRef, { categoryId: id });
  });
  return { id, name: name.trim(), createdAt };
}

export async function renameCategory(id, name) {
  const uid = auth.currentUser.uid;
  const ref = categoryDoc(id, uid);
  const newNameRef = categoryNameDoc(name, uid);
  await runTransaction(db, async (transaction) => {
    const category = await transaction.get(ref);
    if (!category.exists()) throw new Error("This category no longer exists.");
    const oldNameRef = categoryNameDoc(category.data().name, uid);
    const newName = await transaction.get(newNameRef);
    if (newName.exists() && newName.data().categoryId !== id) {
      const error = new Error("A category with that name already exists.");
      error.code = "category-name-taken";
      throw error;
    }
    if (oldNameRef.path !== newNameRef.path) transaction.delete(oldNameRef);
    transaction.set(newNameRef, { categoryId: id });
    transaction.update(ref, { name: name.trim() });
  });
}

export async function moveBookToCategory(bookId, categoryId) {
  await updateDoc(bookDoc(bookId), { categoryId });
}

export async function deleteCategory(id, destinationId, archiveBooks) {
  if (!navigator.onLine) throw new Error("You must be online to delete a category.");
  if (id === destinationId) throw new Error("Choose a different destination category.");
  const uid = auth.currentUser.uid;
  const categoryRef = categoryDoc(id, uid);
  const [category, destination, books] = await Promise.all([
    getDocFromServer(categoryRef),
    getDocFromServer(categoryDoc(destinationId, uid)),
    getDocsFromServer(booksCol(uid))
  ]);
  if (!category.exists()) throw new Error("This category no longer exists.");
  if (!destination.exists()) throw new Error("The destination category no longer exists.");
  const affected = books.docs.filter((book) => (book.data().categoryId || DEFAULT_CATEGORY_ID) === id);
  for (let i = 0; i < affected.length; i += 400) {
    const batch = writeBatch(db);
    affected.slice(i, i + 400).forEach((book) => {
      const changes = { categoryId: destinationId };
      if (archiveBooks && !book.data().deletedAt) changes.deletedAt = Date.now();
      batch.update(book.ref, changes);
    });
    await batch.commit();
  }
  const batch = writeBatch(db);
  batch.delete(categoryNameDoc(category.data().name, uid));
  batch.delete(categoryRef);
  await batch.commit();
}

export async function ensureDefaultBook() {
  const uid = auth.currentUser.uid;
  const snap = await getDocs(query(booksCol(uid), limit(1)));
  if (!snap.empty) return;
  const name = "My Khatabook";
  const createLocally = async () => {
    await setDoc(bookDoc("default", uid), { name, createdAt: Date.now() });
    await setDoc(bookNameDoc(name, uid), { bookId: "default" });
  };
  if (!navigator.onLine) return createLocally();
  const defaultRef = bookDoc("default", uid);
  const nameRef = bookNameDoc(name, uid);
  try {
    await runTransaction(db, async (transaction) => {
      const [existingBook, existingName] = await Promise.all([
        transaction.get(defaultRef), transaction.get(nameRef)
      ]);
      if (existingBook.exists()) return;
      if (existingName.exists() && existingName.data().bookId !== "default") {
        throw new Error("The default khatabook name is already in use.");
      }
      transaction.set(defaultRef, { name, createdAt: Date.now() });
      transaction.set(nameRef, { bookId: "default" });
    });
  } catch (error) {
    if (!["unavailable", "deadline-exceeded"].includes(error.code)) throw error;
    return createLocally();
  }
}

export function watchBooks(cb, onError) {
  return onSnapshot(query(booksCol(), orderBy("createdAt", "asc")),
    (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}

export async function createBook(name, categoryId = DEFAULT_CATEGORY_ID) {
  const uid = auth.currentUser.uid;
  const id = newBookId();
  const createdAt = Date.now();
  const nameRef = bookNameDoc(name, uid);
  await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(nameRef);
    if (existing.exists()) {
      const error = new Error("A khatabook with that name already exists.");
      error.code = "book-name-taken";
      throw error;
    }
    transaction.set(bookDoc(id, uid), { name: name.trim(), createdAt, categoryId });
    transaction.set(nameRef, { bookId: id });
  });
  return { id, name: name.trim(), createdAt, categoryId };
}

export async function renameBook(id, name) {
  const uid = auth.currentUser.uid;
  const bookRef = bookDoc(id, uid);
  const newNameRef = bookNameDoc(name, uid);
  await runTransaction(db, async (transaction) => {
    const book = await transaction.get(bookRef);
    if (!book.exists()) throw new Error("This khatabook no longer exists.");
    const oldNameRef = bookNameDoc(book.data().name, uid);
    const newName = await transaction.get(newNameRef);
    if (newName.exists() && newName.data().bookId !== id) {
      const error = new Error("A khatabook with that name already exists.");
      error.code = "book-name-taken";
      throw error;
    }
    if (oldNameRef.path !== newNameRef.path) transaction.delete(oldNameRef);
    transaction.set(newNameRef, { bookId: id });
    transaction.update(bookRef, { name: name.trim() });
  });
}

export const softDeleteBook = (id) => updateDoc(bookDoc(id), { deletedAt: Date.now() });
export const restoreBook = (id) => updateDoc(bookDoc(id), { deletedAt: deleteField() });

export async function permanentlyDeleteBook(id) {
  if (!navigator.onLine) throw new Error("You must be online to permanently delete a khatabook.");
  const uid = auth.currentUser.uid;
  const ref = bookDoc(id, uid);
  const snap = await getDocFromServer(ref);
  if (!snap.exists() || !snap.data().deletedAt) throw new Error("Only deleted khatabooks can be permanently deleted.");
  await wipeEntries(id, uid);
  const batch = writeBatch(db);
  batch.delete(bookNameDoc(snap.data().name, uid));
  batch.delete(ref);
  await batch.commit();
}

/* ================= Entries ================= */
const entriesCol = (bookId) => bookId === "default"
  ? collection(db, "users", auth.currentUser.uid, "entries")
  : collection(db, "users", auth.currentUser.uid, "books", bookId, "entries");
const entryDoc = (bookId, id) => bookId === "default"
  ? doc(db, "users", auth.currentUser.uid, "entries", id)
  : doc(db, "users", auth.currentUser.uid, "books", bookId, "entries", id);

export function watchEntries(bookId, cb, onError) {
  return onSnapshot(query(entriesCol(bookId), orderBy("createdAt", "desc")),
    (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}
// entry = { id, date:'DD-MM-YYYY', type:'gave'|'got', amount, note, paymentMode, createdAt }
export const addEntry    = (bookId, e) => setDoc(entryDoc(bookId, e.id), e);
export const updateEntry = (bookId, e) => setDoc(entryDoc(bookId, e.id), e, { merge: true });
export const deleteEntry = (bookId, id) => deleteDoc(entryDoc(bookId, id));

/* ================= Payment modes (each user manages their own list) ================= */
const modesCol = () => collection(db, "users", auth.currentUser.uid, "paymentModes");
const modeDoc = (id) => doc(db, "users", auth.currentUser.uid, "paymentModes", id);
// Fixed ids make seeding idempotent (two tabs seeding at once cannot create duplicates).
const DEFAULT_MODES = [
  ["cash", "Cash"], ["upi", "UPI"], ["debit-card", "Debit Card"],
  ["credit-card", "Credit Card"], ["net-banking", "Net Banking"]
];

export function watchModes(cb, onError) {
  return onSnapshot(query(modesCol(), orderBy("createdAt", "asc")),
    (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() })), { fromCache: s.metadata.fromCache }), onError);
}
export async function seedDefaultModes() {
  const batch = writeBatch(db);
  const now = Date.now();
  DEFAULT_MODES.forEach(([id, name], i) => batch.set(modeDoc(id), { name, createdAt: now + i }));
  await batch.commit();
}
// Returns immediately with { id, promise }. The local list updates at once (even offline);
// `promise` settles when the server confirms (or rejects if the rules refuse it).
export function addMode(name) {
  const id = "m_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
  return { id, promise: setDoc(modeDoc(id), { name: name.trim(), createdAt: Date.now() }) };
}
export const removeMode = (id) => deleteDoc(modeDoc(id));
