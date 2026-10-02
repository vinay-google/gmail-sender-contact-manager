/**
 * Decodes MIME encoded-words (=?charset?encoding?data?=) according to RFC 2047.
 *
 * @param {string} str
 * @returns {string}
 */
function decodeMimeEncodedWord(str) {
  if (!str || typeof str !== 'string') return str || '';
  return str.replace(/=\?([^?]+)\?([BQbq])\?([^?]+)\?=/g, (match, charset, encoding, data) => {
    try {
      const enc = encoding.toUpperCase();
      if (enc === 'B') {
        return Buffer.from(data, 'base64').toString('utf8');
      } else if (enc === 'Q') {
        const decoded = data
          .replace(/_/g, ' ')
          .replace(/=([A-Fa-f0-9]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
        return Buffer.from(decoded, 'binary').toString('utf8');
      }
    } catch {
      return match;
    }
    return match;
  });
}

/**
 * Parses a standard RFC 5322 From or Sender header string.
 * Supports:
 * - "First Last" <email@example.com>
 * - First Last <email@example.com>
 * - <email@example.com>
 * - email@example.com
 * - MIME encoded words: =?UTF-8?B?...?= <email@example.com>
 *
 * @param {string} fromValue
 * @returns {{ name: string, email: string }}
 */
function parseFromHeader(fromValue) {
  if (!fromValue || typeof fromValue !== 'string') {
    return { name: '', email: '' };
  }

  const decoded = decodeMimeEncodedWord(fromValue.trim());

  // Matches: Name <email@example.com> or "Name" <email@example.com> or <email@example.com>
  const angleBracketMatch = decoded.match(/^(.*?)\s*<([^\s<>@]+@[^\s<>@]+)>\s*$/);
  if (angleBracketMatch) {
    let name = angleBracketMatch[1].trim().replace(/^["']+|["']+$/g, '').trim();
    const email = angleBracketMatch[2].trim().toLowerCase();
    return { name, email };
  }

  // Matches any email within brackets
  const bracketMatch = decoded.match(/<([^\s<>@]+@[^\s<>@]+)>/);
  if (bracketMatch) {
    const email = bracketMatch[1].trim().toLowerCase();
    let name = decoded.replace(bracketMatch[0], '').replace(/^["']+|["']+$/g, '').trim();
    return { name, email };
  }

  // Matches bare email address
  const bareEmailMatch = decoded.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (bareEmailMatch) {
    const email = bareEmailMatch[1].trim().toLowerCase();
    let name = decoded.replace(bareEmailMatch[0], '').replace(/^["']+|["']+$/g, '').trim();
    return { name, email };
  }

  return { name: decoded, email: '' };
}

/**
 * Derives a clean display name from an email address when no display name is present.
 * e.g. "john.doe@example.com" -> "John Doe"
 *
 * @param {string} email
 * @returns {string}
 */
function deriveNameFromEmail(email) {
  if (!email || typeof email !== 'string') return '';
  return email
    .split('@')[0]
    .replace(/[._-]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Fetches message metadata from Gmail REST API using the user OAuth token and contextual message access token.
 *
 * Per Google Workspace Add-ons alternate runtime specification:
 * - The `Authorization: Bearer <userOAuthToken>` header authenticates the user with granted scopes.
 * - The `X-Goog-Gmail-Access-Token: <gmailAccessToken>` header provides the contextual unlock token
 *   to access this specific message.
 *
 * @param {string} messageId - The Gmail message ID (e.g. '1a09185bd8a15018' or 'msg-f:1876057502532063256')
 * @param {string|Object} authOptions - Access token string, or { userOAuthToken, gmailAccessToken }
 * @returns {Promise<{ name: string, email: string }|null>}
 */
async function fetchSenderFromGmailApi(messageId, authOptions) {
  if (!messageId || !authOptions) return null;

  let userOAuthToken = null;
  let gmailAccessToken = null;

  if (typeof authOptions === 'string') {
    gmailAccessToken = authOptions;
    userOAuthToken = authOptions;
  } else if (typeof authOptions === 'object') {
    userOAuthToken = authOptions.userOAuthToken || authOptions.accessToken || null;
    gmailAccessToken = authOptions.gmailAccessToken || authOptions.accessToken || null;
  }

  const primaryBearer = userOAuthToken || gmailAccessToken;
  if (!primaryBearer) return null;

  // Log token scopes in development/debugging to verify granted scopes
  if (userOAuthToken && !fetchSenderFromGmailApi._tokenChecked) {
    fetchSenderFromGmailApi._tokenChecked = true;
    fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(userOAuthToken)}`)
      .then(r => r.json())
      .then(ti => console.log(`[TokenInfo] Granted userOAuthToken scopes: ${ti.scope || ti.error_description}`))
      .catch(e => console.warn('[TokenInfo] Scope check failed:', e.message));
  }

  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${primaryBearer}`
  };

  if (gmailAccessToken) {
    headers['X-Goog-Gmail-Access-Token'] = gmailAccessToken;
  }

  async function queryGmailMessage(idToFetch, format = 'metadata', encodeId = false) {
    const formattedId = encodeId ? encodeURIComponent(idToFetch) : idToFetch;
    const url = format === 'metadata'
      ? `https://gmail.googleapis.com/gmail/v1/users/me/messages/${formattedId}?format=metadata&metadataHeaders=From&metadataHeaders=Sender`
      : `https://gmail.googleapis.com/gmail/v1/users/me/messages/${formattedId}?format=full`;

    const res = await fetch(url, {
      method: 'GET',
      headers
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.warn(`[Gmail API Attempt] Failed: GET ${url} -> ${res.status} ${res.statusText} - ${errBody}`);
      return { ok: false, status: res.status, statusText: res.statusText, errBody };
    }

    const data = await res.json();
    console.log(`[Gmail API Attempt] Succeeded: GET ${url}`);
    return { ok: true, data };
  }

  try {
    // Attempt 1: Raw message ID with unencoded colon (e.g. msg-f:1875353573337573778) format=metadata
    let result = await queryGmailMessage(messageId, 'metadata', false);

    // Attempt 2: If failed, try with format=full
    if (!result.ok) {
      result = await queryGmailMessage(messageId, 'full', false);
    }

    // Attempt 3: If still failed and starts with 'msg-f:', try converting decimal ID to 16-hex format
    if (!result.ok && messageId.startsWith('msg-f:')) {
      try {
        const decId = messageId.slice(6);
        const hexId = BigInt(decId).toString(16);
        console.log(`[Gmail API] Retrying with hex message ID: ${hexId} (converted from ${messageId})`);
        result = await queryGmailMessage(hexId, 'metadata', false);
        if (!result.ok) {
          result = await queryGmailMessage(hexId, 'full', false);
        }
      } catch (hexErr) {
        console.warn(`[Gmail API] Failed to convert msg-f to hex:`, hexErr.message);
      }
    }

    // Attempt 4: If still failed, try with encodeURIComponent
    if (!result.ok) {
      result = await queryGmailMessage(messageId, 'metadata', true);
    }

    // Parse headers if any attempt succeeded
    if (result.ok) {
      let headersList = result.data?.payload?.headers || [];
      let fromHeader =
        headersList.find(h => h?.name && h.name.toLowerCase() === 'from') ||
        headersList.find(h => h?.name && h.name.toLowerCase() === 'sender');

      if (!fromHeader && result.data?.id) {
        const fullResult = await queryGmailMessage(result.data.id, 'full', false);
        if (fullResult.ok) {
          headersList = fullResult.data?.payload?.headers || [];
          fromHeader =
            headersList.find(h => h?.name && h.name.toLowerCase() === 'from') ||
            headersList.find(h => h?.name && h.name.toLowerCase() === 'sender');
        }
      }

      if (fromHeader && fromHeader.value) {
        const parsed = parseFromHeader(fromHeader.value);
        console.log(`[Gmail API] Successfully extracted sender: "${parsed.name}" <${parsed.email}>`);
        return parsed;
      }
    } else {
      console.warn(`[Gmail API] All fetch attempts failed for message ${messageId}: status ${result.status}`);
      if (result.status === 403) {
        return { name: '', email: '', isPermissionDenied: true, errorReason: result.errBody };
      }
    }
  } catch (err) {
    console.warn(`[Gmail API] Error fetching message metadata for ${messageId}:`, err.message);
  }

  return null;
}

/**
 * Extracts and normalizes sender information from Google Workspace event payloads.
 * 1. Checks explicit event parameters or direct fields (e.g. senderEmail, from).
 * 2. If running in a live Gmail contextual trigger, queries the Gmail API using
 *    event.authorizationEventObject.userOAuthToken, event.gmail.accessToken and
 *    event.gmail.messageId to retrieve the actual From header.
 * 3. Normalizes email and derives clean display name if missing.
 *
 * @param {Object} event - Google Workspace event payload
 * @returns {Promise<{ email: string, name: string, hasSender: boolean }>}
 */
async function extractSenderInfo(event) {
  if (!event) return { email: '', name: '', hasSender: false };

  // 1. Check explicit parameters or direct fields
  let email =
    event?.gmail?.senderEmail ||
    event?.messageMetadata?.senderEmail ||
    event?.commonEventObject?.parameters?.senderEmail ||
    event?.parameters?.senderEmail ||
    event?.commonEventObject?.parameters?.contactEmail ||
    event?.parameters?.contactEmail ||
    '';

  let rawName =
    event?.gmail?.senderName ||
    event?.messageMetadata?.senderName ||
    event?.commonEventObject?.parameters?.senderName ||
    event?.parameters?.senderName ||
    event?.commonEventObject?.parameters?.contactName ||
    event?.parameters?.contactName ||
    '';

  // 2. Check if a raw 'From' header string is directly provided
  const directFrom = event?.messageMetadata?.from || event?.gmail?.from;
  if (directFrom && !email) {
    const parsed = parseFromHeader(directFrom);
    if (parsed.email) {
      email = parsed.email;
      rawName = rawName || parsed.name;
    }
  }

  // 3. If no email yet, query Gmail REST API with contextual tokens
  const messageId =
    event?.gmail?.messageId ||
    event?.messageMetadata?.messageId ||
    event?.commonEventObject?.parameters?.messageId ||
    event?.parameters?.messageId;

  const userOAuthToken =
    event?.authorizationEventObject?.userOAuthToken ||
    event?.userOAuthToken ||
    event?.commonEventObject?.parameters?.userOAuthToken;

  const gmailAccessToken =
    event?.gmail?.accessToken ||
    event?.messageMetadata?.accessToken ||
    event?.commonEventObject?.parameters?.accessToken;

  let isPermissionDenied = false;
  if (!email && messageId && (userOAuthToken || gmailAccessToken)) {
    console.log(`[SenderHelper] Querying Gmail API for messageId: ${messageId} (hasUserToken: ${Boolean(userOAuthToken)}, hasGmailToken: ${Boolean(gmailAccessToken)})`);
    const apiSender = await fetchSenderFromGmailApi(messageId, {
      userOAuthToken,
      gmailAccessToken
    });
    if (apiSender?.email) {
      email = apiSender.email;
      rawName = rawName || apiSender.name;
    } else if (apiSender?.isPermissionDenied) {
      isPermissionDenied = true;
    }
  }

  // 4. In development/testing ONLY, if USE_DEMO_SENDER is explicitly enabled
  if (!email && process.env.USE_DEMO_SENDER === 'true' && (messageId || event?.messageMetadata)) {
    email = 'alex.smith@example.com';
    rawName = rawName || 'Alex Smith';
  }

  // 5. Normalize email
  email = String(email || '').trim().toLowerCase();

  // 6. Derive clean display name if not provided
  let name = String(rawName || '').trim();
  if (!name && email) {
    name = deriveNameFromEmail(email);
  }

  return {
    email,
    name,
    hasSender: Boolean(email),
    isPermissionDenied
  };
}

/**
 * Synchronous version of extractSenderInfo that only checks in-memory fields in the event payload.
 *
 * @param {Object} event - Google Workspace event payload
 * @returns {{ email: string, name: string, hasSender: boolean }}
 */
function extractSenderInfoSync(event) {
  if (!event) return { email: '', name: '', hasSender: false };

  let email =
    event?.gmail?.senderEmail ||
    event?.messageMetadata?.senderEmail ||
    event?.commonEventObject?.parameters?.senderEmail ||
    event?.parameters?.senderEmail ||
    '';

  let rawName =
    event?.gmail?.senderName ||
    event?.messageMetadata?.senderName ||
    event?.commonEventObject?.parameters?.senderName ||
    event?.parameters?.senderName ||
    '';

  const directFrom = event?.messageMetadata?.from || event?.gmail?.from;
  if (directFrom && !email) {
    const parsed = parseFromHeader(directFrom);
    if (parsed.email) {
      email = parsed.email;
      rawName = rawName || parsed.name;
    }
  }

  email = String(email || '').trim().toLowerCase();
  let name = String(rawName || '').trim();
  if (!name && email) {
    name = deriveNameFromEmail(email);
  }

  return {
    email,
    name,
    hasSender: Boolean(email)
  };
}

module.exports = {
  extractSenderInfo,
  extractSenderInfoSync,
  parseFromHeader,
  fetchSenderFromGmailApi,
  deriveNameFromEmail,
  decodeMimeEncodedWord
};
