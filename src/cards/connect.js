const {
  createCardV2,
  buildCard,
  createSection,
  createTextParagraph,
  createDecoratedText,
  createButton,
  createResponsePayload
} = require('../utils/cardBuilder');
const store = require('../store');

/**
 * Builds the Connect Account card shown when user is not connected.
 * Adheres to Google Workspace Add-on Third-Party Service Connection guide:
 * https://developers.google.com/workspace/add-ons/guides/connect-third-party-service#prompt-sign-in
 *
 * When the user clicks Connect, opens OAuth via link/url with:
 * - openAs: 'OVERLAY'
 * - onClose: 'RELOAD'
 *
 * @param {Object} event - The Google Workspace event payload
 * @returns {Object} RenderActions Response Payload with custom_authorization_prompt
 */
function getConnectCard(event) {
  const userEmail = event?.commonEventObject?.userEmail || 'Your Account';
  const userId = store.getUserId(event);

  const publicWebUrl = process.env.PUBLIC_OAUTH_URL;
  const baseUrl = event?.baseUrl ||
    process.env.APP_URL ||
    process.env.BASE_URL ||
    `http://localhost:${process.env.PORT || 3000}`;

  // If a public overlay URL (e.g. Firebase Hosting) is configured, use it with parameters.
  // Otherwise fall back to local backend route.
  const gcpProject = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || '';
  const oauthUrl = publicWebUrl
    ? `${publicWebUrl}?userId=${encodeURIComponent(userId)}&userEmail=${encodeURIComponent(userEmail)}&backendUrl=${encodeURIComponent(baseUrl)}${gcpProject ? `&projectId=${encodeURIComponent(gcpProject)}` : ''}`
    : `${baseUrl}/oauth/start?userId=${encodeURIComponent(userId)}`;

  const welcomeSection = createSection({
    header: 'Welcome to Sender Contact Manager',
    widgets: [
      createTextParagraph('Connect your account to access and manage your contacts list across Google Workspace.'),
      createDecoratedText({
        topLabel: 'Connection Status',
        text: '<b>Not Connected</b>',
        startIcon: { knownIcon: 'PERSON' }
      }),
      createDecoratedText({
        topLabel: 'User Account',
        text: `<code>${userEmail}</code>`,
        startIcon: { knownIcon: 'EMAIL' }
      })
    ]
  });

  const connectActionSection = createSection({
    widgets: [
      {
        buttonList: {
          buttons: [
            createButton({
              text: 'Connect Account',
              openUrl: oauthUrl,
              openAs: 'OVERLAY',
              onClose: 'RELOAD',
              isPrimary: true
            })
          ]
        }
      },
      createTextParagraph('<i>Clicking Connect Account opens the authorization window. Once you complete authorization, your contacts will be available here.</i>')
    ]
  });

  const card = buildCard({
    title: 'Connect Contacts',
    subtitle: 'Account Authentication Required',
    imageUrl: 'https://www.gstatic.com/images/branding/product/2x/googleg_48dp.png',
    sections: [welcomeSection, connectActionSection]
  });

  const cardV2 = createCardV2('connect_card', card);
  return createResponsePayload({ cards: [cardV2] });
}

module.exports = { getConnectCard };

