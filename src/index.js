require('dotenv').config();
const express = require('express');
const { verifyGoogleBearerToken } = require('./middleware/auth');
const { getHomepageCard } = require('./cards/homepage');
const { getGmailMessageCard } = require('./cards/gmailMessage');
const {
  handleConnectResponse,
  handleDisconnectResponse,
  handleAddContactResponse,
  handleClearContactsResponse
} = require('./cards/actionResponse');
const oauthRoutes = require('./routes/oauth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// OAuth routes for third-party connect flow (OVERLAY)
app.use('/oauth', oauthRoutes);

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'Sender Contact Manager Backend',
    timestamp: new Date().toISOString()
  });
});

// Self-closing same-origin reload overlay to reload add-on card stacks simultaneously (openAs: OVERLAY, onClose: RELOAD)
app.get('/reload-overlay', (req, res) => {
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://*.google.com https://*.googleusercontent.com;");
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Refreshing Add-on...</title>
</head>
<body style="background:#ffffff;margin:0;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;">
  <p style="color:#5f6368;font-size:13px;">Refreshing data...</p>
  <script>
    try {
      window.close();
    } catch (e) {
      console.error(e);
    }
    setTimeout(function() {
      try { window.close(); } catch (_) {}
    }, 50);
  </script>
</body>
</html>`);
});

// Helper to determine base URL from request
function populateBaseUrl(req, event) {
  if (!event.baseUrl) {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    event.baseUrl = `${protocol}://${req.get('host')}`;
  }
}

// Helper to decode JWT payload without external network calls
function decodeJwtPayload(token) {
  try {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const jsonStr = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

// Helper to attach verified user from Google Bearer token into event object
function populateCurrentUser(req, event) {
  let verifiedEmail = req.googleUser?.email || event?.commonEventObject?.userEmail || event?.userEmail;

  if (!verifiedEmail) {
    const authHeader = req.headers?.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const payload = decodeJwtPayload(authHeader.split(' ')[1]);
      if (payload?.email) {
        verifiedEmail = payload.email;
        req.googleUser = payload;
      }
    }
  }

  if (!verifiedEmail && event?.authorizationEventObject?.userIdToken) {
    const payload = decodeJwtPayload(event.authorizationEventObject.userIdToken);
    if (payload?.email) {
      verifiedEmail = payload.email;
      req.googleUser = payload;
    }
  }

  if (!verifiedEmail && process.env.DEFAULT_USER && process.env.DEFAULT_USER.includes('@')) {
    verifiedEmail = process.env.DEFAULT_USER.trim().toLowerCase();
  }

  if (verifiedEmail) {
    if (!event.commonEventObject) {
      event.commonEventObject = {};
    }
    if (!event.commonEventObject.userEmail) {
      event.commonEventObject.userEmail = verifiedEmail;
    }
    if (!event.userEmail) {
      event.userEmail = verifiedEmail;
    }
    event.googleUser = req.googleUser || { email: verifiedEmail };
  }
}

// Primary Endpoint for Google Workspace Add-on HTTP Triggers & Actions
app.post('/', verifyGoogleBearerToken, async (req, res) => {
  try {
    const event = req.body || {};
    populateBaseUrl(req, event);
    populateCurrentUser(req, event);
    const invokedFunction = event?.commonEventObject?.parameters?.invokedFunction ||
      event?.commonEventObject?.parameters?.action ||
      event?.commonEventObject?.invokedFunction;

    const isEmailContext = Boolean(
      invokedFunction === 'onGmailMessageOpen' ||
      event?.gmail?.messageId ||
      event?.messageMetadata
    );

    const user = event?.commonEventObject?.userEmail || 'unknown';
    console.log(`[Add-on Request] Invoked function: ${invokedFunction || (isEmailContext ? 'onGmailMessageOpen (Contextual)' : 'Default (Homepage)')} (user: ${user})`);
    if (isEmailContext) {
      console.log(`[Email Context] messageId: ${event?.gmail?.messageId || event?.messageMetadata?.messageId}, hasGmailToken: ${Boolean(event?.gmail?.accessToken)}, hasUserToken: ${Boolean(event?.authorizationEventObject?.userOAuthToken)}`);
      try {
        const sanitized = JSON.parse(JSON.stringify(event, (k, v) => {
          if (typeof v === 'string' && (k.toLowerCase().includes('token') || k === 'userOAuthToken' || k === 'accessToken')) {
            return `${v.slice(0, 8)}...[len=${v.length}]`;
          }
          return v;
        }));
        console.log('[Email Context Event Payload]:', JSON.stringify(sanitized));
      } catch (_) {}
    }

    let response;

    if (invokedFunction === 'handleConnect') {
      response = await handleConnectResponse(event);
    } else if (invokedFunction === 'handleDisconnect' || invokedFunction === 'handleDisconnectConnection') {
      response = await handleDisconnectResponse(event);
    } else if (invokedFunction === 'handleClearContacts') {
      response = await handleClearContactsResponse(event);
    } else if (invokedFunction === 'handleAddContact') {
      response = await handleAddContactResponse(event);
    } else if (invokedFunction === 'handleBack' || invokedFunction === 'onHomepage') {
      response = await getHomepageCard(event);
    } else if (invokedFunction === 'onGmailMessageOpen' || (!invokedFunction && isEmailContext)) {
      response = await getGmailMessageCard(event);
    } else {
      response = await getHomepageCard(event);
    }

    return res.status(200).json(response);
  } catch (error) {
    console.error('Error handling Google Workspace Add-on event:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: error.message
    });
  }
});

// Explicit modular routes if preferred in Google Workspace Manifest configuration
app.post('/homepage', verifyGoogleBearerToken, async (req, res) => {
  try {
    const event = req.body || {};
    populateBaseUrl(req, event);
    populateCurrentUser(req, event);
    res.status(200).json(await getHomepageCard(event));
  } catch (error) {
    console.error('Error in /homepage:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/gmail-message', verifyGoogleBearerToken, async (req, res) => {
  try {
    const event = req.body || {};
    populateBaseUrl(req, event);
    populateCurrentUser(req, event);
    res.status(200).json(await getGmailMessageCard(event));
  } catch (error) {
    console.error('Error in /gmail-message:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/action', verifyGoogleBearerToken, async (req, res) => {
  try {
    const event = req.body || {};
    populateBaseUrl(req, event);
    populateCurrentUser(req, event);
    const invokedFunction = event?.commonEventObject?.parameters?.invokedFunction ||
      event?.commonEventObject?.parameters?.action ||
      event?.commonEventObject?.invokedFunction;
    if (invokedFunction === 'handleConnect') {
      return res.status(200).json(await handleConnectResponse(event));
    }
    if (invokedFunction === 'handleDisconnect' || invokedFunction === 'handleDisconnectConnection') {
      return res.status(200).json(await handleDisconnectResponse(event));
    }
    if (invokedFunction === 'handleClearContacts') {
      return res.status(200).json(await handleClearContactsResponse(event));
    }
    if (invokedFunction === 'handleBack' || invokedFunction === 'onHomepage') {
      return res.status(200).json(await getHomepageCard(event));
    }
    return res.status(200).json(await handleAddContactResponse(event));
  } catch (error) {
    console.error('Error in /action:', error);
    res.status(500).json({ error: error.message });
  }
});

// Only start listening if run directly (allows importing app in tests)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Sender Contact Manager server running on port ${PORT}`);
    console.log(`📍 Endpoint URL: http://localhost:${PORT}/`);
    console.log(`🏥 Health Check: http://localhost:${PORT}/health`);
  });
}

module.exports = app;
