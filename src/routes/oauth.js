const express = require('express');
const store = require('../store');

const router = express.Router();

// Allow embedding in Google Workspace Add-on OVERLAY modal dialog & cross-origin AJAX from Firebase Hosting
router.use((req, res, next) => {
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://*.google.com https://*.googleusercontent.com;");
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

/**
 * Renders the OAuth consent screen HTML for the Google Workspace OVERLAY dialog.
 */
function renderConsentHtml(userId, baseUrl) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sender Contact Manager - OAuth Authorization</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #f8f9fa;
      margin: 0;
      padding: 24px 16px;
      color: #202124;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
    }
    .card {
      background: #ffffff;
      border: 1px solid #dadce0;
      border-radius: 12px;
      padding: 32px 24px;
      max-width: 440px;
      width: 100%;
      box-shadow: 0 4px 16px rgba(0,0,0,0.08);
      text-align: center;
    }
    .logo {
      width: 52px;
      height: 52px;
      margin-bottom: 16px;
    }
    h2 {
      margin: 0 0 8px 0;
      font-size: 22px;
      font-weight: 600;
      color: #202124;
    }
    p.subtitle {
      margin: 0 0 20px 0;
      color: #5f6368;
      font-size: 14px;
      line-height: 1.5;
    }
    .user-badge {
      background: #e8f0fe;
      color: #1967d2;
      border-radius: 16px;
      padding: 6px 14px;
      font-size: 13px;
      font-weight: 500;
      display: inline-block;
      margin-bottom: 20px;
      border: 1px solid #d2e3fc;
    }
    .permissions-box {
      background: #f8f9fa;
      border: 1px solid #eceff1;
      border-radius: 8px;
      padding: 16px;
      text-align: left;
      margin-bottom: 24px;
      font-size: 13px;
    }
    .permissions-box h4 {
      margin: 0 0 10px 0;
      color: #3c4043;
      font-size: 13px;
      font-weight: 600;
    }
    .permissions-box ul {
      margin: 0;
      padding-left: 20px;
      color: #5f6368;
    }
    .permissions-box li {
      margin-bottom: 6px;
    }
    .btn-primary {
      background-color: #1a73e8;
      color: white;
      border: none;
      padding: 12px 24px;
      font-size: 14px;
      font-weight: 500;
      border-radius: 6px;
      cursor: pointer;
      width: 100%;
      transition: background-color 0.2s, box-shadow 0.2s;
    }
    .btn-primary:hover {
      background-color: #1557b0;
      box-shadow: 0 1px 3px rgba(0,0,0,0.15);
    }
    .btn-secondary {
      background: transparent;
      color: #5f6368;
      border: 1px solid #dadce0;
      padding: 10px 24px;
      font-size: 14px;
      font-weight: 500;
      border-radius: 6px;
      cursor: pointer;
      width: 100%;
      margin-top: 10px;
      transition: background-color 0.2s;
    }
    .btn-secondary:hover {
      background-color: #f1f3f4;
    }
    .demo-notice {
      margin-top: 18px;
      font-size: 12px;
      color: #70757a;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <div class="card">
    <div style="font-size: 44px; margin-bottom: 12px;">📇</div>
    <h2>Sender Contact Manager</h2>
    <p class="subtitle">Authorize Sender Contact Manager integration for developer testing.</p>
    
    <div class="user-badge">Account: ${userId}</div>
    
    <div class="permissions-box">
      <h4>Permissions requested:</h4>
      <ul>
        <li>Read and access contacts list</li>
        <li>Add and manage contacts from Gmail messages</li>
        <li>Store OAuth tokens in in-memory backend for demo</li>
      </ul>
    </div>
    
    <form method="POST" action="${baseUrl}/oauth/authorize">
      <input type="hidden" name="userId" value="${userId}">
      <button type="submit" class="btn-primary" id="btn-authorize">Authorize & Connect</button>
    </form>
    
    <button type="button" class="btn-secondary" onclick="window.close()">Cancel</button>
    
    <div class="demo-notice">
      🔒 <strong>Demo Backend:</strong> Tokens will be stored in-memory. Upon completion, this overlay closes and the add-on homepage reloads as <strong>Connected</strong>.
    </div>
  </div>
</body>
</html>`;
}

/**
 * Renders the OAuth success screen HTML that triggers automatic overlay close.
 */
function renderSuccessHtml(userId, tokens) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connection Successful</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #f8f9fa;
      margin: 0;
      padding: 24px 16px;
      color: #202124;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
    }
    .card {
      background: #ffffff;
      border: 1px solid #dadce0;
      border-radius: 12px;
      padding: 32px 24px;
      max-width: 440px;
      width: 100%;
      box-shadow: 0 4px 16px rgba(0,0,0,0.08);
      text-align: center;
    }
    .success-badge {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background-color: #e6f4ea;
      color: #137333;
      font-size: 32px;
      display: inline-flex;
      justify-content: center;
      align-items: center;
      margin-bottom: 16px;
    }
    h2 {
      margin: 0 0 8px 0;
      font-size: 22px;
      font-weight: 600;
      color: #137333;
    }
    p.subtitle {
      margin: 0 0 20px 0;
      color: #5f6368;
      font-size: 14px;
      line-height: 1.5;
    }
    .token-box {
      background: #f8f9fa;
      border: 1px solid #eceff1;
      border-radius: 8px;
      padding: 14px;
      text-align: left;
      margin-bottom: 24px;
      font-size: 12px;
      color: #3c4043;
    }
    .token-row {
      margin-bottom: 6px;
      word-break: break-all;
    }
    .token-row strong {
      color: #202124;
    }
    .token-row code {
      background: #e8eaed;
      padding: 2px 4px;
      border-radius: 4px;
    }
    .btn-primary {
      background-color: #1a73e8;
      color: white;
      border: none;
      padding: 12px 24px;
      font-size: 14px;
      font-weight: 500;
      border-radius: 6px;
      cursor: pointer;
      width: 100%;
      transition: background-color 0.2s;
    }
    .btn-primary:hover {
      background-color: #1557b0;
    }
    .closing-msg {
      margin-top: 14px;
      font-size: 12px;
      color: #5f6368;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="success-badge">✓</div>
    <h2>Connected Successfully!</h2>
    <p class="subtitle">OAuth flow complete. Fetched tokens are securely saved in the in-memory backend.</p>
    
    <div class="token-box">
      <div class="token-row"><strong>Account:</strong> <code>${userId}</code></div>
      <div class="token-row"><strong>Status:</strong> <span style="color: #137333; font-weight: 600;">Connected</span></div>
      <div class="token-row"><strong>Access Token:</strong> <code>${tokens.accessToken}</code></div>
      <div class="token-row"><strong>Refresh Token:</strong> <code>${tokens.refreshToken}</code></div>
      <div class="token-row"><strong>Token Type:</strong> ${tokens.tokenType || 'Bearer'}</div>
      <div class="token-row"><strong>Expires In:</strong> ${tokens.expiresIn || 3600}s</div>
    </div>
    
    <button type="button" class="btn-primary" onclick="window.close()">Close Window</button>
    
    <div class="closing-msg">
      Closing window and reloading add-on homepage...
    </div>
  </div>

  <script>
    // Automatically close the overlay window so onClose: 'RELOAD' triggers
    setTimeout(function() {
      try {
        window.close();
      } catch (e) {
        console.log('window.close() called:', e);
      }
    }, 1000);
  </script>
</body>
</html>`;
}

function getBaseUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL;
  if (process.env.BASE_URL) return process.env.BASE_URL;
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  return `${protocol}://${req.get('host')}`;
}

/**
 * GET /oauth/start
 * Initiates the OAuth overlay authorization process.
 */
router.get('/start', async (req, res) => {
  const userId = req.query.userId || req.query.userEmail || 'default_user';
  const baseUrl = getBaseUrl(req);

  // Quick auto-authorize flag (useful for testing or headless automation)
  if (req.query.auto === 'true') {
    const tokens = await store.connectUser(userId);
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.status(200).json({ success: true, userId, tokens });
    }
    return res.status(200).send(renderSuccessHtml(userId, tokens));
  }

  return res.status(200).send(renderConsentHtml(userId, baseUrl));
});

/**
 * GET /oauth/authorize (alias for /start)
 */
router.get('/authorize', (req, res) => {
  const userId = req.query.userId || req.query.userEmail || 'default_user';
  const baseUrl = getBaseUrl(req);
  return res.status(200).send(renderConsentHtml(userId, baseUrl));
});

/**
 * POST /oauth/authorize
 * Completes OAuth authorization: saves tokens to store and Firestore, returns success page.
 */
router.post('/authorize', async (req, res) => {
  const userId = req.body?.userId || req.query?.userId || 'default_user';
  const tokens = await store.connectUser(userId);

  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.status(200).json({
      success: true,
      message: 'OAuth authorization successful. Tokens stored in backend and Firestore.',
      userId,
      tokens
    });
  }

  return res.status(200).send(renderSuccessHtml(userId, tokens));
});

/**
 * GET /oauth/callback
 * Simulates standard OAuth 2.0 redirect callback endpoint.
 */
router.get('/callback', async (req, res) => {
  const userId = req.query.userId || req.query.state || 'default_user';
  const tokens = await store.connectUser(userId);

  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.status(200).json({
      success: true,
      message: 'OAuth callback successful. Tokens stored in backend and Firestore.',
      userId,
      tokens
    });
  }

  return res.status(200).send(renderSuccessHtml(userId, tokens));
});

/**
 * GET /oauth/status
 * Queries current connection status and in-memory tokens.
 */
router.get('/status', (req, res) => {
  const userId = req.query.userId || req.query.userEmail || 'default_user';
  const connected = store.isConnected(userId);
  const tokens = store.getTokens(userId);

  return res.status(200).json({
    userId,
    connected,
    tokens: tokens || null
  });
});

/**
 * POST /oauth/token
 * Standard OAuth 2.0 token endpoint.
 */
router.post('/token', async (req, res) => {
  const userId = req.body?.userId || 'default_user';
  const tokens = await store.connectUser(userId);

  return res.status(200).json({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    token_type: tokens.tokenType || 'Bearer',
    expires_in: tokens.expiresIn || 3600,
    scope: tokens.scope
  });
});

/**
 * POST /oauth/disconnect
 * Disconnects the user and removes stored tokens.
 */
router.post('/disconnect', async (req, res) => {
  const userId = req.body?.userId || req.query?.userId || 'default_user';
  await store.disconnectUser(userId);

  return res.status(200).json({
    success: true,
    message: 'User disconnected and tokens removed from store and Firestore.',
    userId
  });
});

module.exports = router;
