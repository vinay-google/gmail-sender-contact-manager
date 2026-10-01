const {
  createCardV2,
  buildCard,
  createSection,
  createTextParagraph,
  createDecoratedText,
  createButton,
  createResponsePayload
} = require('../utils/cardBuilder');
const { getConnectCard } = require('./connect');
const store = require('../store');

/**
 * Builds the Homepage card.
 * If user is not connected, shows the Connect Card.
 * If user is connected, shows Contact List and actions: "Clear Contacts" and "Disconnect Connection".
 * "Account Status" and "Quick Add Contact" have been removed.
 *
 * @param {Object} event - The Google Workspace event payload
 * @returns {Object} RenderActions Response Payload
 */
async function getHomepageCard(event) {
  // Sync tokens from Firestore if available
  await store.refreshTokens(event);

  // If not connected, return the Connect screen
  if (!store.isConnected(event)) {
    return getConnectCard(event);
  }

  // Ensure latest contacts are synced from Firestore for this user
  await store.refreshContacts(event);

  const contacts = store.getContacts(event);
  const contactCount = contacts.length;

  // Contacts List Section
  const contactWidgets = [];
  if (contacts.length === 0) {
    contactWidgets.push(
      createTextParagraph('<i>No contacts found in your list. Open an email to add contacts.</i>')
    );
  } else {
    contacts.forEach(contact => {
      contactWidgets.push(
        createDecoratedText({
          topLabel: contact.name,
          text: `<code>${contact.email}</code>`,
          startIcon: { knownIcon: 'PERSON' }
        })
      );
    });
  }

  const contactsListSection = createSection({
    header: `My Contacts (${contactCount})`,
    widgets: contactWidgets
  });

  console.log(`[Homepage] Rendering homepage with ${contactCount} contact(s) for user: ${store.getUserId(event)}`);

  const baseUrl = event?.baseUrl ||
    process.env.APP_URL ||
    process.env.BASE_URL ||
    `http://localhost:${process.env.PORT || 3000}`;

  // Action buttons: "Refresh Contacts", "Clear Contacts" and "Disconnect Connection" only show on the homepage
  const actionsSection = createSection({
    widgets: [
      {
        buttonList: {
          buttons: [
            createButton({
              text: 'Refresh Contacts',
              openUrl: `${baseUrl}/reload-overlay`,
              openAs: 'OVERLAY',
              onClose: 'RELOAD',
              isPrimary: true
            }),
            createButton({
              text: 'Clear Contacts',
              actionMethod: 'handleClearContacts'
            }),
            createButton({
              text: 'Disconnect Connection',
              actionMethod: 'handleDisconnect'
            })
          ]
        }
      }
    ]
  });

  const card = buildCard({
    title: 'Contacts Manager',
    subtitle: `${contactCount} Contact(s)`,
    imageUrl: 'https://www.gstatic.com/images/branding/product/2x/googleg_48dp.png',
    sections: [contactsListSection, actionsSection]
  });

  const cardV2 = createCardV2('homepage_card', card);
  return createResponsePayload({ cards: [cardV2] });
}

module.exports = { getHomepageCard };
