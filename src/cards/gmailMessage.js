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
const { extractSenderInfo } = require('../utils/senderHelper');
const store = require('../store');

/**
 * Builds a card when a user opens an email in Gmail.
 * Requirements:
 * 1. Quick Add Contact form is removed.
 * 2. Add contact only shows when an email is clicked/opened.
 * 3. Shows the sender's email and possibly the name.
 * 4. Button option to "Add Contact".
 * 5. Once user navigates back to inbox, the new contact appears in the list.
 * 6. "Clear Contacts" and "Disconnect Connection" are NOT shown here.
 *
 * @param {Object} event - The Google Workspace event payload containing Gmail message context
 * @returns {Object} RenderActions Response Payload
 */
async function getGmailMessageCard(event) {
  // Sync tokens from Firestore if available
  await store.refreshTokens(event);

  // If user is not connected, require connecting first
  if (!store.isConnected(event)) {
    return getConnectCard(event);
  }

  // Ensure latest contacts are synced from Firestore for this user
  await store.refreshContacts(event);

  // Check if granular OAuth permissions require requesting gmail.readonly scope per Google specification
  const suppressScopePrompt = event?.commonEventObject?.parameters?.suppressScopePrompt === 'true';
  const authorizedScopes = event?.authorizationEventObject?.authorizedScopes;
  if (!suppressScopePrompt && Array.isArray(authorizedScopes) && !authorizedScopes.includes('https://www.googleapis.com/auth/gmail.readonly')) {
    console.log('[Gmail Context] Missing required scope https://www.googleapis.com/auth/gmail.readonly in authorizedScopes, requesting scope from Google Workspace');
    return {
      requesting_google_scopes: {
        scopes: ['https://www.googleapis.com/auth/gmail.readonly']
      }
    };
  }

  // Extract email sender details from Gmail context or parameters
  const { email: senderEmail, name: senderName, hasSender, isPermissionDenied } = await extractSenderInfo(event);

  // If permission was denied (403 from Gmail API), prompt user for scope authorization
  if (!suppressScopePrompt && isPermissionDenied) {
    console.log('[Gmail Context] Gmail API returned 403 insufficient scope, requesting scope from Google Workspace');
    return {
      requesting_google_scopes: {
        scopes: ['https://www.googleapis.com/auth/gmail.readonly']
      }
    };
  }
  const existingContact = senderEmail ? store.getContact(senderEmail, event) : null;
  const inContacts = Boolean(existingContact) || (senderEmail ? store.isContact(senderEmail, event) : false);

  // If already in contacts, show existing contact details and navigation back to inbox
  if (inContacts) {
    const contactName = existingContact?.name || senderName || senderEmail;
    const statusWidgets = [];

    if (contactName && contactName !== senderEmail) {
      statusWidgets.push(
        createDecoratedText({
          topLabel: 'Sender Name',
          text: `<b>${contactName}</b>`,
          startIcon: { knownIcon: 'PERSON' }
        })
      );
    }

    statusWidgets.push(
      createDecoratedText({
        topLabel: 'Sender Email',
        text: `<code>${senderEmail}</code>`,
        startIcon: { knownIcon: 'EMAIL' }
      }),
      createDecoratedText({
        topLabel: 'Contact Status',
        text: '<b>✓ Already in Contacts List</b>',
        startIcon: { knownIcon: 'STAR' }
      }),
      createTextParagraph(`<b>${contactName}</b> is saved in your contacts list. When you navigate back to the inbox, you can view your full list of contacts.`)
    );

    const statusSection = createSection({
      header: 'Sender Information',
      widgets: statusWidgets
    });

    const actionsSection = createSection({
      widgets: [
        {
          buttonList: {
            buttons: [
              createButton({
                text: 'Back to Contacts',
                actionMethod: 'onHomepage',
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

    const card = buildCard({
      title: 'Sender Details',
      subtitle: `Saved Contact • ${contactName}`,
      imageUrl: 'https://www.gstatic.com/images/branding/product/2x/gmail_48dp.png',
      sections: [statusSection, actionsSection]
    });

    const cardV2 = createCardV2('gmail_message_card', card);
    return createResponsePayload({ cards: [cardV2] });
  }

  // If NOT in contacts: show sender's email and possibly the name, with button option to "Add Contact"
  const widgets = [];

  if (hasSender && senderEmail) {
    if (senderName && senderName.trim().length > 0) {
      widgets.push(
        createDecoratedText({
          topLabel: 'Sender Name',
          text: `<b>${senderName}</b>`,
          startIcon: { knownIcon: 'PERSON' }
        })
      );
    }

    widgets.push(
      createDecoratedText({
        topLabel: 'Sender Email',
        text: `<code>${senderEmail}</code>`,
        startIcon: { knownIcon: 'EMAIL' }
      })
    );

    widgets.push({
      buttonList: {
        buttons: [
          createButton({
            text: 'Add Contact',
            actionMethod: 'handleAddContact',
            parameters: {
              contactEmail: senderEmail,
              contactName: senderName || ''
            },
            isPrimary: true
          }),
          createButton({
            text: 'Back to Contacts',
            actionMethod: 'onHomepage'
          })
        ]
      }
    });
  } else if (isPermissionDenied) {
    widgets.push(
      createTextParagraph('⚠️ <b>Gmail Authorization Required</b><br><br>Google Workspace requires you to grant email message reading permission.<br><br>👉 <b>Please refresh Gmail (reload your browser tab / page)</b> to allow Gmail to display the Authorization prompt.'),
      {
        buttonList: {
          buttons: [
            createButton({
              text: 'Retry Reading Email',
              actionMethod: 'onGmailMessageOpen',
              parameters: {
                messageId: event?.gmail?.messageId || ''
              },
              isPrimary: true
            }),
            createButton({
              text: 'View My Contacts',
              actionMethod: 'onHomepage'
            })
          ]
        }
      }
    );
  } else {
    widgets.push(
      createTextParagraph('<i>No sender details detected from this email message.</i>')
    );
  }

  const senderSection = createSection({
    header: 'Sender Information',
    widgets
  });

  const card = buildCard({
    title: 'Sender Information',
    subtitle: senderName ? `${senderName} • ${senderEmail}` : (senderEmail || 'Email Message'),
    imageUrl: 'https://www.gstatic.com/images/branding/product/2x/gmail_48dp.png',
    sections: [senderSection]
  });

  const cardV2 = createCardV2('gmail_message_card', card);
  return createResponsePayload({ cards: [cardV2] });
}

module.exports = { getGmailMessageCard };
