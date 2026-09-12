/**
 * Store for User Connection Status & Contacts List
 */

let firestoreDb = null;
if (process.env.NODE_ENV !== 'test') {
  try {
    const { Firestore } = require('@google-cloud/firestore');
    const firestoreOptions = {};
    if (process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT) {
      firestoreOptions.projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT;
    }
    firestoreDb = new Firestore(firestoreOptions);
  } catch (e) {
    console.warn('[Store] Firestore initialization failed, using in-memory only:', e.message);
  }
}

/**
 * Resolves the active signed-in user.
 * Priority:
 * 1. process.env.DEFAULT_USER if explicitly set
 * 2. Active signed-in gcloud account (in development / local CLI runtime)
 * 3. Fallback to 'default_user'
 */
let cachedSignedInUser = null;

function resolveSignedInUser() {
  if (process.env.DEFAULT_USER && process.env.DEFAULT_USER.trim().length > 0) {
    return process.env.DEFAULT_USER.trim().toLowerCase();
  }
  if (cachedSignedInUser) {
    return cachedSignedInUser;
  }
  if (process.env.NODE_ENV !== 'test') {
    try {
      const { execSync } = require('child_process');
      const account = execSync('gcloud config get-value account 2>/dev/null', {
        encoding: 'utf8',
        timeout: 2000,
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
      if (account && account.includes('@') && !account.includes(' ')) {
        cachedSignedInUser = account.toLowerCase();
        return cachedSignedInUser;
      }
    } catch (_) {}
  }
  cachedSignedInUser = 'default_user';
  return cachedSignedInUser;
}

function getDefaultUser() {
  return resolveSignedInUser();
}

const defaultUser = getDefaultUser();

// In-memory data store keyed by user ID / email
const userStore = {
  // Connected user state (pre-seeded only in test environment)
  connectedUsers: new Set(process.env.NODE_ENV === 'test' ? [defaultUser, 'default_user'] : []),

  // Default contacts list
  contacts: [
    {
      id: 'contact_1',
      userId: defaultUser,
      name: 'Sarah Connor',
      email: 'sarah.connor@example.com',
      addedAt: new Date().toISOString()
    },
    {
      id: 'contact_2',
      userId: defaultUser,
      name: 'John Doe',
      email: 'john.doe@example.com',
      addedAt: new Date().toISOString()
    }
  ]
};

// In-memory contacts per user: Map<userId, Array<contact>>
const userContacts = new Map();

// Initialize user contacts in test mode
if (process.env.NODE_ENV === 'test') {
  userContacts.set(defaultUser, [...userStore.contacts]);
  userContacts.set('default_user', [...userStore.contacts]);
}

function getUserId(event) {
  if (!event) return getDefaultUser();
  if (typeof event === 'string' && event.trim().length > 0) {
    return event.trim().toLowerCase();
  }
  const email =
    event?.commonEventObject?.userEmail ||
    event?.userEmail ||
    event?.googleUser?.email ||
    event?.user?.email ||
    event?.user?.userEmail ||
    event?.body?.commonEventObject?.userEmail ||
    event?.body?.userEmail;
  if (email && typeof email === 'string' && email.trim().length > 0) {
    return email.trim().toLowerCase();
  }
  return getDefaultUser();
}

function setFirestoreDb(db) {
  firestoreDb = db;
}

function getFirestoreDb() {
  return firestoreDb;
}

async function refreshContacts(eventOrUserId) {
  const userId = getUserId(eventOrUserId);
  if (!userContacts.has(userId)) {
    if (process.env.NODE_ENV === 'test' && (userId === defaultUser || userId === 'default_user')) {
      userContacts.set(userId, [...userStore.contacts]);
    } else {
      userContacts.set(userId, []);
    }
  }

  if (!firestoreDb) return [...(userContacts.get(userId) || [])];

  try {
    const snapshot = await firestoreDb.collection('contacts').get();
    const fetched = [];
    if (!snapshot.empty) {
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data && data.email) {
          if (data.userId === userId || (!data.userId && (userId === defaultUser || userId === 'default_user'))) {
            fetched.push(data);
          }
        }
      });
    }
    userContacts.set(userId, fetched.sort((a, b) =>
      new Date(b.addedAt || 0) - new Date(a.addedAt || 0)
    ));
    if (userId === defaultUser || userId === 'default_user') {
      userStore.contacts = userContacts.get(userId);
    }
  } catch (err) {
    console.warn(`[Store] Error refreshing contacts for ${userId} from Firestore:`, err.message);
  }
  return [...(userContacts.get(userId) || [])];
}

async function clearContacts(eventOrUserId) {
  const userId = getUserId(eventOrUserId);
  userContacts.set(userId, []);
  if (userId === defaultUser || userId === 'default_user') {
    userContacts.set(defaultUser, []);
    userContacts.set('default_user', []);
    userStore.contacts = [];
  }

  if (firestoreDb) {
    try {
      const snapshot = await firestoreDb.collection('contacts').get();
      if (!snapshot.empty) {
        const batch = firestoreDb.batch();
        let deletedCount = 0;
        snapshot.docs.forEach(doc => {
          const data = doc.data();
          if (data && (data.userId === userId || (!data.userId && (userId === defaultUser || userId === 'default_user')))) {
            batch.delete(doc.ref);
            deletedCount++;
          }
        });
        if (deletedCount > 0) {
          await batch.commit();
          console.log(`[Firestore] Deleted ${deletedCount} contacts for user ${userId} from Firestore.`);
        }
      }
    } catch (err) {
      console.warn(`[Firestore] Error clearing contacts for ${userId}:`, err.message);
    }
  }
  return true;
}

async function loadTokensFromFirestore() {
  if (!firestoreDb) return;
  try {
    const snapshot = await firestoreDb.collection('tokens').get();
    tokenStore.clear();
    userStore.connectedUsers.clear();
    if (!snapshot.empty) {
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data && (data.accessToken || data.connected)) {
          tokenStore.set(doc.id, data);
          userStore.connectedUsers.add(doc.id);
        }
      });
      console.log(`[Firestore] Loaded ${snapshot.size} tokens from Firestore.`);
    }
  } catch (err) {
    console.warn('[Firestore] Error loading tokens from Firestore:', err.message);
  }
}

if (firestoreDb) {
  refreshContacts().catch(() => {});
  loadTokensFromFirestore().catch(() => {});
}

// In-memory token store for OAuth tokens (demo backend)
const tokenStore = new Map();

function generateDemoTokens(userId = 'default_user') {
  const randomHex = (len = 8) => Math.random().toString(36).substring(2, 2 + len);
  return {
    accessToken: `ya29.demo_${randomHex(10)}_${randomHex(10)}`,
    refreshToken: `1//demo_refresh_${randomHex(10)}_${randomHex(10)}`,
    tokenType: 'Bearer',
    expiresIn: 3600,
    expiresAt: Date.now() + 3600 * 1000,
    scope: 'https://www.googleapis.com/auth/contacts.readonly https://www.googleapis.com/auth/userinfo.email',
    createdAt: new Date().toISOString()
  };
}

// Pre-seed demo tokens for the sample user in test mode only
if (process.env.NODE_ENV === 'test') {
  tokenStore.set(defaultUser, generateDemoTokens(defaultUser));
  tokenStore.set('default_user', generateDemoTokens('default_user'));
}

// Set of user IDs pending connection confirmation (e.g. while OAuth overlay is open)
const pendingConnectUsers = new Set();

function prepareConnect(eventOrUserId) {
  const userId = getUserId(eventOrUserId);
  pendingConnectUsers.add(userId);
  if (userId !== 'default_user') {
    pendingConnectUsers.add('default_user');
  }
}

function isPendingConnect(eventOrUserId) {
  const userId = getUserId(eventOrUserId);
  return pendingConnectUsers.has(userId) || pendingConnectUsers.has('default_user');
}

function consumePendingConnect(eventOrUserId) {
  const userId = getUserId(eventOrUserId);
  const pending = pendingConnectUsers.has(userId) || pendingConnectUsers.has('default_user');
  if (pending) {
    pendingConnectUsers.delete(userId);
    pendingConnectUsers.delete('default_user');
    return true;
  }
  return false;
}

function isConnected(event) {
  const userId = getUserId(event);
  const hasTokens = tokenStore.has(userId) || ((userId === defaultUser || userId === 'default_user') && tokenStore.has('default_user'));
  const isMarkedConnected = userStore.connectedUsers.has(userId) || ((userId === defaultUser || userId === 'default_user') && userStore.connectedUsers.has('default_user'));
  return Boolean(hasTokens || isMarkedConnected);
}

function saveTokens(eventOrUserId, tokenData = null) {
  const userId = getUserId(eventOrUserId);
  const tokens = tokenData || generateDemoTokens(userId);
  tokenStore.set(userId, tokens);
  userStore.connectedUsers.add(userId);
  return tokens;
}

function getTokens(eventOrUserId) {
  const userId = getUserId(eventOrUserId);
  return tokenStore.get(userId) || ((userId === defaultUser || userId === 'default_user') ? tokenStore.get('default_user') : null);
}

async function refreshTokens(eventOrUserId) {
  const userId = getUserId(eventOrUserId);
  if (!firestoreDb) {
    return tokenStore.get(userId) || null;
  }
  try {
    let doc = await firestoreDb.collection('tokens').doc(userId).get();
    if (doc.exists) {
      const data = doc.data();
      if (data && (data.accessToken || data.connected)) {
        tokenStore.set(userId, data);
        userStore.connectedUsers.add(userId);
        return data;
      }
    } else if (userId === defaultUser || userId === 'default_user') {
      const fallbackId = userId === 'default_user' ? defaultUser : 'default_user';
      const fallbackDoc = await firestoreDb.collection('tokens').doc(fallbackId).get();
      if (fallbackDoc.exists) {
        const data = fallbackDoc.data();
        if (data && (data.accessToken || data.connected)) {
          tokenStore.set(userId, data);
          userStore.connectedUsers.add(userId);
          return data;
        }
      }
    }
    // Doc does not exist in Firestore: clear in-memory connection
    tokenStore.delete(userId);
    userStore.connectedUsers.delete(userId);
    if (userId === defaultUser || userId === 'default_user') {
      tokenStore.delete(defaultUser);
      tokenStore.delete('default_user');
      userStore.connectedUsers.delete(defaultUser);
      userStore.connectedUsers.delete('default_user');
    }
  } catch (err) {
    console.warn(`[Firestore] Error fetching token for ${userId}:`, err.message);
  }
  return tokenStore.get(userId) || null;
}

async function disconnectUser(eventOrUserId) {
  const userId = getUserId(eventOrUserId);
  const targets = new Set([userId]);
  if (userId === defaultUser || userId === 'default_user') {
    targets.add('default_user');
    targets.add(defaultUser);
  }

  for (const id of targets) {
    tokenStore.delete(id);
    userStore.connectedUsers.delete(id);
    pendingConnectUsers.delete(id);
  }

  if (firestoreDb) {
    try {
      for (const id of targets) {
        await firestoreDb.collection('tokens').doc(id).delete();
      }
      const snap = await firestoreDb.collection('tokens').get();
      if (!snap.empty) {
        const batch = firestoreDb.batch();
        let deletedTokens = 0;
        snap.docs.forEach(doc => {
          const data = doc.data();
          if (targets.has(doc.id) || (data && targets.has(data.userId))) {
            batch.delete(doc.ref);
            deletedTokens++;
          }
        });
        if (deletedTokens > 0) {
          await batch.commit();
        }
      }
      try {
        await firestoreDb.collection('auth').doc(userId).delete();
      } catch (_) {}
      console.log(`[Firestore] Cleared all token and auth info for user: ${userId}`);
    } catch (err) {
      console.warn(`[Firestore] Error clearing connection token and auth info for ${userId}:`, err.message);
    }
  }

  return true;
}

async function clearTokens(eventOrUserId) {
  return disconnectUser(eventOrUserId);
}

async function connectUser(event, tokenData = null) {
  const userId = getUserId(event);
  const tokens = saveTokens(userId, tokenData);
  userStore.connectedUsers.add(userId);
  if (userId === defaultUser || userId === 'default_user') {
    saveTokens('default_user', tokens);
    userStore.connectedUsers.add('default_user');
    saveTokens(defaultUser, tokens);
    userStore.connectedUsers.add(defaultUser);
  }
  pendingConnectUsers.delete(userId);
  pendingConnectUsers.delete('default_user');

  if (firestoreDb) {
    try {
      const tokenDoc = {
        ...tokens,
        userId,
        connected: true,
        updatedAt: new Date().toISOString()
      };
      await firestoreDb.collection('tokens').doc(userId).set(tokenDoc);
      if (userId === defaultUser || userId === 'default_user') {
        await firestoreDb.collection('tokens').doc('default_user').set({
          ...tokenDoc,
          userId: 'default_user'
        });
      }
      console.log(`[Firestore] Persisted connection token for user: ${userId}`);
    } catch (err) {
      console.warn(`[Firestore] Error saving connection token for ${userId}:`, err.message);
    }
  }

  return tokens;
}

function getContacts(eventOrUserId) {
  const userId = getUserId(eventOrUserId);
  if (userContacts.has(userId)) {
    return [...userContacts.get(userId)];
  }
  return [...userStore.contacts];
}

function getContactCount(eventOrUserId) {
  return getContacts(eventOrUserId).length;
}

function isContact(email, eventOrUserId) {
  if (!email) return false;
  const cleanEmail = email.trim().toLowerCase();
  return getContacts(eventOrUserId).some(c => c.email.toLowerCase() === cleanEmail);
}

function getContact(email, eventOrUserId) {
  if (!email) return null;
  const cleanEmail = email.trim().toLowerCase();
  return getContacts(eventOrUserId).find(c => c.email.toLowerCase() === cleanEmail) || null;
}

async function addContact({ name, email }, eventOrUserId) {
  if (!email) return null;
  const cleanEmail = email.trim().toLowerCase();
  const userId = getUserId(eventOrUserId);

  if (!userContacts.has(userId)) {
    userContacts.set(userId, (process.env.NODE_ENV === 'test' && (userId === defaultUser || userId === 'default_user')) ? [...userStore.contacts] : []);
  }
  const currentList = userContacts.get(userId);

  // Don't add duplicate
  const existing = currentList.find(c => c.email.toLowerCase() === cleanEmail);
  if (existing) {
    return existing;
  }

  const newContact = {
    id: `contact_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    userId,
    name: (name && name.trim()) || cleanEmail.split('@')[0],
    email: cleanEmail,
    addedAt: new Date().toISOString()
  };

  currentList.unshift(newContact); // Newest first
  userContacts.set(userId, currentList);
  if (userId === defaultUser || userId === 'default_user') {
    userStore.contacts = currentList;
  }

  if (firestoreDb) {
    try {
      await firestoreDb
        .collection('contacts')
        .doc(newContact.id)
        .set(newContact);
      console.log(`[Firestore] Persisted contact for user ${userId}: ${newContact.name} (${newContact.email})`);
    } catch (err) {
      console.warn('[Firestore] Error saving contact:', err.message);
    }
  }

  return newContact;
}

module.exports = {
  getUserId,
  isConnected,
  connectUser,
  disconnectUser,
  saveTokens,
  getTokens,
  clearTokens,
  refreshTokens,
  loadTokensFromFirestore,
  setFirestoreDb,
  getFirestoreDb,
  generateDemoTokens,
  tokenStore,
  getContacts,
  getContactCount,
  isContact,
  getContact,
  addContact,
  refreshContacts,
  clearContacts,
  prepareConnect,
  isPendingConnect,
  consumePendingConnect,
  getDefaultUser
};
