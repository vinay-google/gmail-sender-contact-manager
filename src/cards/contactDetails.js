const {
  createCardV2,
  buildCard,
  createSection,
  createTextParagraph,
  createDecoratedText,
  createButton,
  createResponsePayload
} = require('../utils/cardBuilder');

/**
 * Formats an ISO date string into a human-readable format.
 * @param {string} dateStr
 * @returns {string}
 */
function formatDateTime(dateStr) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return new Date().toLocaleString();
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  } catch {
    return dateStr;
  }
}

/**
 * Builds the Contact Details Card object.
 *
 * @param {Object} contact - The newly added/saved contact object
 * @param {Object} [event] - The Google Workspace event payload
 * @returns {Object} Google Workspace Card object
 */
function buildContactDetailsCardObject(contact, event) {
  const name = contact?.name || 'Contact';
  const email = contact?.email || '';
  const baseUrl = event?.baseUrl ||
    process.env.APP_URL ||
    process.env.BASE_URL ||
    `http://localhost:${process.env.PORT || 3000}`;

  const detailsSection = createSection({
    header: 'Contact Information',
    widgets: [
      createDecoratedText({
        topLabel: 'Full Name',
        text: `<b>${name}</b>`,
        startIcon: { knownIcon: 'PERSON' }
      }),
      createDecoratedText({
        topLabel: 'Email Address',
        text: `<code>${email}</code>`,
        startIcon: { knownIcon: 'EMAIL' }
      }),
      createDecoratedText({
        topLabel: 'Contact Status',
        text: '<b>✓ Saved in Contacts List</b>',
        startIcon: { knownIcon: 'STAR' }
      }),
      createTextParagraph(
        `<b>${name}</b> has been saved to your contacts. When you return to the inbox, your contacts list is up to date.`
      )
    ]
  });

  const actionsSection = createSection({
    widgets: [
      {
        buttonList: {
          buttons: [
            createButton({
              text: 'Back to Contacts',
              openUrl: `${baseUrl}/reload-overlay`,
              openAs: 'OVERLAY',
              onClose: 'RELOAD',
              isPrimary: true
            }),
            createButton({
              text: 'View Inbox & All Contacts',
              actionMethod: 'onHomepage'
            })
          ]
        }
      }
    ]
  });

  return buildCard({
    title: 'Contact Details',
    subtitle: `Saved • ${name}`,
    imageUrl: 'https://www.gstatic.com/images/branding/product/2x/googleg_48dp.png',
    sections: [detailsSection, actionsSection]
  });
}

/**
 * Builds the "Contact Details" card displayed immediately after clicking "Add Contact".
 *
 * @param {Object} contact - The newly added/saved contact object
 * @param {Object} [event] - The Google Workspace event payload
 * @returns {Object} RenderActions Response Payload
 */
function getContactDetailsCard(contact, event) {
  const card = buildContactDetailsCardObject(contact, event);
  const name = contact?.name || 'Contact';
  const email = contact?.email || '';

  return createResponsePayload({
    navigations: [{
      updateCard: card
    }],
    notificationText: `✓ Added ${name} (${email}) to your contacts list!`
  });
}

module.exports = {
  buildContactDetailsCardObject,
  getContactDetailsCard
};
