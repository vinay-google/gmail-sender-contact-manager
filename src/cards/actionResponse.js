const { createResponsePayload } = require('../utils/cardBuilder');
const { getHomepageCard } = require('./homepage');
const { getConnectCard } = require('./connect');
const { getContactDetailsCard } = require('./contactDetails');
const store = require('../store');

/**
 * Handles account connection action (`handleConnect`).
 * @param {Object} event - The Google Workspace event payload
 * @returns {Object} RenderActions Response Payload
 */
async function handleConnectResponse(event) {
  const publicWebUrl = process.env.PUBLIC_OAUTH_URL;
  const baseUrl = event?.baseUrl ||
    process.env.APP_URL ||
    process.env.BASE_URL ||
    `http://localhost:${process.env.PORT || 3000}`;
  const userId = store.getUserId(event);
  const userEmail = event?.commonEventObject?.userEmail || userId;
  const gcpProject = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || '';
  const oauthUrl = publicWebUrl
    ? `${publicWebUrl}?userId=${encodeURIComponent(userId)}&userEmail=${encodeURIComponent(userEmail)}&backendUrl=${encodeURIComponent(baseUrl)}${gcpProject ? `&projectId=${encodeURIComponent(gcpProject)}` : ''}`
    : `${baseUrl}/oauth/start?userId=${encodeURIComponent(userId)}`;

  const connectCardObj = getConnectCard(event);
  const connectCard = connectCardObj.action.navigations[0].pushCard;

  return createResponsePayload({
    cards: [connectCard],
    link: {
      url: oauthUrl,
      openAs: 'OVERLAY',
      onClose: 'RELOAD'
    },
    notificationText: 'Please complete authorization in the overlay window.'
  });
}

/**
 * Handles account disconnection action (`handleDisconnect`).
 * Clears all token and auth info for the current user from Firestore.
 * @param {Object} event - The Google Workspace event payload
 * @returns {Object} RenderActions Response Payload
 */
async function handleDisconnectResponse(event) {
  await store.disconnectUser(event);

  const connectCardObj = getConnectCard(event);
  const connectCard = connectCardObj.action.navigations[0].pushCard;

  return createResponsePayload({
    cards: [connectCard],
    notificationText: 'Account disconnected.'
  });
}

/**
 * Handles adding a new contact (`handleAddContact`).
 * Triggered from Gmail Email Contextual button.
 * @param {Object} event - The Google Workspace event payload
 * @returns {Object} RenderActions Response Payload
 */
async function handleAddContactResponse(event) {
  const formInputs = event?.commonEventObject?.formInputs || event?.formInputs || {};
  const parameters = event?.commonEventObject?.parameters || event?.parameters || {};

  const email =
    parameters.contactEmail ||
    formInputs.contactEmail?.stringInputs?.value?.[0] ||
    formInputs.contactEmail?.[0];

  const name =
    parameters.contactName ||
    formInputs.contactName?.stringInputs?.value?.[0] ||
    formInputs.contactName?.[0] ||
    (email ? email.split('@')[0] : '');

  if (!email) {
    return createResponsePayload({
      notificationText: 'No email address found to add as contact.'
    });
  }

  const contact = await store.addContact({ name, email }, event);

  return getContactDetailsCard(contact, event);
}

/**
 * Handles clearing all contacts from Firestore for the current user (`handleClearContacts`).
 * @param {Object} event - The Google Workspace event payload
 * @returns {Object} RenderActions Response Payload
 */
async function handleClearContactsResponse(event) {
  await store.clearContacts(event);

  const updatedHomepage = await getHomepageCard(event);
  const updatedCard = updatedHomepage.action.navigations[0].pushCard;

  return createResponsePayload({
    cards: [updatedCard],
    notificationText: 'Firestore contacts cleared successfully! You can now test adding contacts.'
  });
}

module.exports = {
  handleConnectResponse,
  handleDisconnectResponse,
  handleAddContactResponse,
  handleClearContactsResponse
};
