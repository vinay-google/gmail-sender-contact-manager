const { OAuth2Client } = require('google-auth-library');

const client = new OAuth2Client();

/**
 * Middleware to verify Google Workspace Add-on HTTP request bearer tokens.
 * Secures HTTP endpoints against unauthorized requests.
 */
async function verifyGoogleBearerToken(req, res, next) {
  // Allow bypassing auth in local development/testing environment if configured
  if (process.env.SKIP_AUTH_VALIDATION === 'true' || process.env.NODE_ENV === 'test') {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized: Missing or invalid Authorization header.'
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const options = { idToken: token };
    if (process.env.GOOGLE_CLIENT_ID) {
      options.audience = process.env.GOOGLE_CLIENT_ID;
    }

    const ticket = await client.verifyIdToken(options);

    const payload = ticket.getPayload();
    
    // Verify issuer is Google
    if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
      return res.status(403).json({ error: 'Forbidden: Token is not issued by Google.' });
    }

    req.googleUser = payload;
    return next();
  } catch (error) {
    console.error('Error verifying Google Bearer Token:', error.message);
    return res.status(401).json({
      error: 'Unauthorized: Invalid Google Bearer Token',
      details: error.message
    });
  }
}

module.exports = { verifyGoogleBearerToken };
