const { createResponsePayload, createSubmitFormResponse } = require('../utils/cardBuilder');
const { getHomepageCard } = require('./homepage');
const { getConnectCard } = require('./connect');
const { buildContactDetailsCardObject, getContactDetailsCard } = require('./contactDetails');
const { getGmailMessageCard } = require('./gmailMessage');
const store = require('../store');

/**
 * Handles account connection action (`handleConnect`).
 * @param {Object} event - The Google Workspace event payload
 * @returns {Object} SubmitFormResponse Payload
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

  return createSubmitFormResponse({
    cards: [connectCard],
    link: {
      url: oauthUrl,
      openAs: 'OVERLAY',
      onClose: 'RELOAD'
    },
    notificationText: 'Please complete authorization in the overlay window.',
    stateChanged: true
  });
}

/**
 * Handles account disconnection action (`handleDisconnect`).
 * Clears all token and auth info for the current user from Firestore.
 * @param {Object} event - The Google Workspace event payload
 * @returns {Object} SubmitFormResponse Payload
 */
async function handleDisconnectResponse(event) {
  await store.disconnectUser(event);

  const connectCardObj = getConnectCard(event);
  const connectCard = connectCardObj.action.navigations[0].pushCard;

  return createSubmitFormResponse({
    navigations: [{
      updateCard: connectCard
    }],
    notificationText: 'Account disconnected.',
    stateChanged: true
  });
}

/**
 * Handles adding a new contact (`handleAddContact`).
 * Fulfills Trick 1: chain [{ "popToRoot": true }, { "updateCard": updatedContextualRootCard }, { "pushCard": detailCard }]
 * Fulfills Trick 3 & 4: return "stateChanged": true at top level of SubmitFormResponse
 *
 * @param {Object} event - The Google Workspace event payload
 * @returns {Object} SubmitFormResponse Payload
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
    return createSubmitFormResponse({
      notificationText: 'No email address found to add as contact.',
      stateChanged: false
    });
  }

  const contact = await store.addContact({ name, email }, event);

  // Trick 1: Generate updated contextual root card showing saved contact
  const rootMsgResponse = await getGmailMessageCard(event);
  const updatedContextualRootCard = rootMsgResponse.action?.navigations?.[0]?.pushCard ||
    rootMsgResponse.card ||
    rootMsgResponse;

  // Build the Contact Details card
  const detailCard = buildContactDetailsCardObject(contact, event);

  // Chain navigations: pop to root -> update root card -> push detail card
  const navigations = [
    { popToRoot: true },
    { updateCard: updatedContextualRootCard },
    { pushCard: detailCard }
  ];

  // Trick 3 & 4: Return SubmitFormResponse with stateChanged: true
  return createSubmitFormResponse({
    navigations,
    notificationText: `✓ Added ${name} (${email}) to your contacts list!`,
    stateChanged: true
  });
}

/**
 * Handles clearing all contacts from Firestore for the current user (`handleClearContacts`).
 * Fulfills Trick 3 & 4: return "stateChanged": true at top level of SubmitFormResponse
 *
 * @param {Object} event - The Google Workspace event payload
 * @returns {Object} SubmitFormResponse Payload
 */
async function handleClearContactsResponse(event) {
  await store.clearContacts(event);

  const updatedHomepage = await getHomepageCard(event);
  const updatedCard = updatedHomepage.action.navigations[0].pushCard;

  return createSubmitFormResponse({
    navigations: [{
      updateCard: updatedCard
    }],
    notificationText: 'Firestore contacts cleared successfully! You can now test adding contacts.',
    stateChanged: true
  });
}

module.exports = {
  handleConnectResponse,
  handleDisconnectResponse,
  handleAddContactResponse,
  handleClearContactsResponse
};
