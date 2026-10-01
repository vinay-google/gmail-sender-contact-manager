process.env.NODE_ENV = 'test';
process.env.SKIP_AUTH_VALIDATION = 'true';
process.env.DEFAULT_USER = 'testuser@example.com';
delete process.env.PUBLIC_OAUTH_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/index');

delete process.env.PUBLIC_OAUTH_URL;

let server;
let baseUrl;

test.before((_, done) => {
  server = app.listen(0, () => {
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;
    done();
  });
});

test.after((_, done) => {
  server.close(done);
});

test('GET /health - returns ok status', async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, 'ok');
  assert.equal(data.service, 'Sender Contact Manager Backend');
});

test('POST / - returns Homepage card without Account Status or Quick Add Contact', async () => {
  const event = {
    commonEventObject: {
      hostApp: 'GMAIL',
      userEmail: 'testuser@example.com',
      invokedFunction: 'onHomepage'
    }
  };

  const res = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event)
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  
  assert.ok(data.action);
  assert.ok(data.action.navigations);
  const card = data.action.navigations[0].pushCard;
  assert.equal(card.header.title, 'Contacts Manager');

  // Verify Account Status section is NOT present
  const accountStatusSection = card.sections.find(s => s.header === 'Account Status');
  assert.equal(accountStatusSection, undefined, 'Account Status section must be removed');

  // Verify Quick Add Contact section is NOT present
  const quickAddSection = card.sections.find(s => s.header === 'Quick Add Contact');
  assert.equal(quickAddSection, undefined, 'Quick Add Contact section must be removed from homepage');

  // Verify Clear Contacts and Disconnect Connection buttons ARE present on homepage
  const allButtons = card.sections.flatMap(s =>
    (s.widgets || []).flatMap(w => w.buttonList?.buttons || [])
  );
  const clearBtn = allButtons.find(b => b.text === 'Clear Contacts');
  assert.ok(clearBtn, 'Clear Contacts button must be present on homepage');

  const disconnectBtn = allButtons.find(b => b.text === 'Disconnect Connection');
  assert.ok(disconnectBtn, 'Disconnect Connection button must be present on homepage');
});

test('POST / - handles disconnect and returns Connect card', async () => {
  const event = {
    commonEventObject: {
      userEmail: 'testuser@example.com',
      invokedFunction: 'handleDisconnect'
    }
  };

  const res = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event)
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  const card = data.action.navigations[0].pushCard;
  assert.equal(card.header.title, 'Connect Contacts');
  assert.equal(data.action.notification.text, 'Account disconnected.');
});

test('POST / - connect flow: user is disconnected until completing OAuth authorization dance', async () => {
  const event = {
    commonEventObject: {
      userEmail: 'testuser@example.com',
      invokedFunction: 'onHomepage'
    }
  };

  // 1. User is disconnected after previous handleDisconnect
  const res1 = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event)
  });

  assert.equal(res1.status, 200);
  const data1 = await res1.json();
  const card1 = data1.action.navigations[0].pushCard;
  assert.equal(card1.header.title, 'Connect Contacts');

  // 2. User goes through the OAuth authorization dance
  const oauthRes = await fetch(`${baseUrl}/oauth/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ userId: 'testuser@example.com' })
  });
  assert.equal(oauthRes.status, 200);

  // 3. User reloads homepage after completing auth dance - now connected!
  const res2 = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event)
  });
  assert.equal(res2.status, 200);
  const data2 = await res2.json();
  const card2 = data2.action.navigations[0].pushCard;
  assert.equal(card2.header.title, 'Contacts Manager');
});

test('POST / - onGmailMessageOpen shows sender email, name and Add Contact button (no Quick Add, no Clear/Disconnect)', async () => {
  const store = require('../src/store');
  const unknownEmail = 'unknown.sender@example.com';
  assert.equal(store.isContact(unknownEmail), false, 'Sender must not be in contacts initially');

  const event = {
    commonEventObject: {
      hostApp: 'GMAIL',
      userEmail: 'testuser@example.com',
      invokedFunction: 'onGmailMessageOpen',
      parameters: {
        senderEmail: unknownEmail,
        senderName: 'Unknown Sender'
      }
    }
  };

  const res = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event)
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  const card = data.action.navigations[0].pushCard;

  // Verify opening email must NOT automatically add the contact
  assert.equal(store.isContact(unknownEmail), false, 'Opening email must NOT automatically add the contact');

  // Verify "Quick Add Contact" is NOT present
  const quickAddSection = card.sections.find(s => s.header === 'Quick Add Contact');
  assert.equal(quickAddSection, undefined, 'Quick Add Contact section must be removed');

  // Verify "Account Status" is NOT present
  const accountStatusSection = card.sections.find(s => s.header === 'Account Status');
  assert.equal(accountStatusSection, undefined, 'Account Status section must not be present');

  // Verify sender email and name are displayed as DecoratedText
  const senderSection = card.sections.find(s => s.header === 'Sender Information');
  assert.ok(senderSection, 'Sender Information section must exist');

  const emailWidget = senderSection.widgets.find(w =>
    w.decoratedText && w.decoratedText.topLabel === 'Sender Email'
  );
  assert.ok(emailWidget, 'Sender Email widget must be displayed');
  assert.ok(emailWidget.decoratedText.text.includes(unknownEmail));

  const nameWidget = senderSection.widgets.find(w =>
    w.decoratedText && w.decoratedText.topLabel === 'Sender Name'
  );
  assert.ok(nameWidget, 'Sender Name widget must be displayed');
  assert.ok(nameWidget.decoratedText.text.includes('Unknown Sender'));

  // Verify Add Contact button is present
  const buttonWidget = senderSection.widgets.find(w => w.buttonList);
  assert.ok(buttonWidget, 'Button list widget must exist');
  const addBtn = buttonWidget.buttonList.buttons.find(b => b.text === 'Add Contact');
  assert.ok(addBtn, 'Add Contact button must exist');
  assert.equal(addBtn.onClick.action.parameters.find(p => p.key === 'invokedFunction').value, 'handleAddContact');
  assert.equal(addBtn.onClick.action.parameters.find(p => p.key === 'contactEmail').value, unknownEmail);
  assert.equal(addBtn.onClick.action.parameters.find(p => p.key === 'contactName').value, 'Unknown Sender');

  // Verify "Clear Contacts" and "Disconnect Connection" are NOT on this email card
  const allButtons = card.sections.flatMap(s =>
    (s.widgets || []).flatMap(w => w.buttonList?.buttons || [])
  );
  assert.equal(allButtons.find(b => b.text === 'Clear Contacts'), undefined, 'Clear Contacts must not be on email card');
  assert.equal(allButtons.find(b => b.text === 'Disconnect Connection'), undefined, 'Disconnect Connection must not be on email card');
});

test('POST / - handles handleAddContact and returns Contact Details page, then navigating back to inbox shows new contact', async () => {
  const store = require('../src/store');
  const newEmail = 'new.person@example.com';
  const initialCount = store.getContactCount();

  const event = {
    commonEventObject: {
      hostApp: 'GMAIL',
      userEmail: 'testuser@example.com',
      invokedFunction: 'handleAddContact',
      parameters: {
        contactEmail: newEmail,
        contactName: 'New Person'
      }
    }
  };

  const res = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event)
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  const card = data.action.navigations[0].updateCard || data.action.navigations[0].pushCard;

  // Verify Contact Details page is shown with contact details
  assert.equal(card.header.title, 'Contact Details');
  assert.ok(card.header.subtitle.includes('New Person'));

  const detailsSection = card.sections.find(s => s.header === 'Contact Information');
  assert.ok(detailsSection, 'Contact Information section must be present');

  const emailWidget = detailsSection.widgets.find(w =>
    w.decoratedText && w.decoratedText.topLabel === 'Email Address'
  );
  assert.ok(emailWidget);
  assert.ok(emailWidget.decoratedText.text.includes(newEmail));

  // Contact is now saved in backend store
  assert.equal(store.isContact(newEmail), true);
  assert.equal(store.getContactCount(), initialCount + 1);

  // Verify response strictly adheres to google.apps.card.v1.RenderActions
  assert.ok(data.action, 'Response must contain action object');
  assert.ok(data.action.navigations, 'Response must contain navigations');
  assert.equal(data.stateChanged, undefined, 'stateChanged must not be present at root');
  assert.equal(data.action.stateChanged, undefined, 'stateChanged must not be present in action');

  // Verify Back to Contacts button is present in the add-on card
  const allCardButtons = card.sections.flatMap(s =>
    (s.widgets || []).flatMap(w => w.buttonList?.buttons || [])
  );
  const backBtn = allCardButtons.find(b => b.text === 'Back to Contacts');
  assert.ok(backBtn, 'Back to Contacts button must exist inside the add-on');

  // Once user navigates back to inbox it should show the new contact in the list
  const inboxEvent = {
    commonEventObject: {
      hostApp: 'GMAIL',
      userEmail: 'testuser@example.com',
      invokedFunction: 'onHomepage'
    }
  };

  const inboxRes = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(inboxEvent)
  });

  assert.equal(inboxRes.status, 200);
  const inboxData = await inboxRes.json();
  const homepageCard = inboxData.action.navigations[0].pushCard;

  // Verify homepage shows updated count and list
  assert.ok(homepageCard.header.subtitle.includes(`${initialCount + 1} Contact(s)`));
  const contactsSection = homepageCard.sections.find(s => s.header.startsWith('My Contacts'));
  assert.ok(contactsSection);
  const foundContactWidget = contactsSection.widgets.find(w =>
    w.decoratedText && w.decoratedText.text.includes(newEmail)
  );
  assert.ok(foundContactWidget, 'Newly added contact must appear in inbox homepage contacts list');
});

test('POST / - going back to inbox by pressing back inside Gmail triggers homepageTrigger and refreshes data', async () => {
  const store = require('../src/store');
  const user = 'gmail.back.tester@example.com';
  await store.connectUser(user);
  await store.clearContacts(user);

  // Add contact while viewing email
  const addEvent = {
    commonEventObject: {
      hostApp: 'GMAIL',
      userEmail: user,
      invokedFunction: 'handleAddContact',
      parameters: {
        contactEmail: 'grace.hopper@navy.mil',
        contactName: 'Grace Hopper'
      }
    }
  };

  const addRes = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(addEvent)
  });
  assert.equal(addRes.status, 200);
  const addData = await addRes.json();
  assert.ok(addData.action, 'handleAddContact response must contain action');
  assert.equal(addData.stateChanged, undefined, 'stateChanged must not be present');

  // In Gmail, pressing back button returns to inbox (triggering homepageTrigger without invokedFunction)
  const returnToInboxEvent = {
    commonEventObject: {
      hostApp: 'GMAIL',
      platform: 'WEB',
      userEmail: user
    }
  };

  const inboxRes = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(returnToInboxEvent)
  });

  assert.equal(inboxRes.status, 200);
  const inboxData = await inboxRes.json();
  const homepageCard = inboxData.action.navigations[0].pushCard;
  assert.equal(homepageCard.header.title, 'Contacts Manager');
  assert.ok(homepageCard.header.subtitle.includes('1 Contact(s)'), 'Homepage must show 1 contact after navigating back to inbox');

  const contactsSection = homepageCard.sections.find(s => s.header.startsWith('My Contacts'));
  assert.ok(contactsSection);
  const contactItem = contactsSection.widgets.find(w =>
    w.decoratedText && w.decoratedText.text.includes('grace.hopper@navy.mil')
  );
  assert.ok(contactItem, 'Newly added contact must appear on homepage when returning to inbox');
});

test('POST / - clicking back button inside add-on (handleBack or onHomepage) refreshes homepage data', async () => {
  const store = require('../src/store');
  const user = 'addon.back.tester@example.com';
  await store.connectUser(user);
  await store.clearContacts(user);

  // Add contact
  await store.addContact({ name: 'Katherine Johnson', email: 'kjohnson@nasa.gov' }, user);

  // User clicks back button inside add-on
  const backEvent = {
    commonEventObject: {
      hostApp: 'GMAIL',
      userEmail: user,
      parameters: {
        invokedFunction: 'handleBack'
      }
    }
  };

  const res = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(backEvent)
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  const card = data.action.navigations[0].pushCard;
  assert.equal(card.header.title, 'Contacts Manager');
  assert.ok(card.header.subtitle.includes('1 Contact(s)'));

  const contactsSection = card.sections.find(s => s.header.startsWith('My Contacts'));
  assert.ok(contactsSection);
  const contactItem = contactsSection.widgets.find(w =>
    w.decoratedText && w.decoratedText.text.includes('kjohnson@nasa.gov')
  );
  assert.ok(contactItem, 'Homepage refreshed via back button inside add-on must show latest contact');
});

test('POST /action - handleBack routes to homepage and fetches latest data', async () => {
  const store = require('../src/store');
  const user = 'action.back.tester@example.com';
  await store.connectUser(user);
  await store.clearContacts(user);

  await store.addContact({ name: 'Margaret Hamilton', email: 'mhamilton@mit.edu' }, user);

  const event = {
    commonEventObject: {
      hostApp: 'GMAIL',
      userEmail: user,
      parameters: {
        invokedFunction: 'handleBack'
      }
    }
  };

  const res = await fetch(`${baseUrl}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event)
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  const card = data.action.navigations[0].pushCard;
  assert.equal(card.header.title, 'Contacts Manager');
  assert.ok(card.header.subtitle.includes('1 Contact(s)'));
  assert.ok(card.sections[0].widgets.some(w => w.decoratedText?.text?.includes('mhamilton@mit.edu')));
});

test('Connect card contains button with openAs: OVERLAY and onClose: RELOAD per Google guide', async () => {
  const store = require('../src/store');
  const testEmail = 'oauth.tester@example.com';
  await store.disconnectUser(testEmail);

  const event = {
    commonEventObject: {
      hostApp: 'GMAIL',
      userEmail: testEmail,
      invokedFunction: 'onHomepage'
    }
  };

  const res = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event)
  });

  assert.equal(res.status, 200);
  const data = await res.json();

  assert.ok(data.action);
  const pushCard = data.action.navigations[0].pushCard;
  assert.equal(pushCard.header.title, 'Connect Contacts');

  const actionSection = pushCard.sections.find(s =>
    s.widgets && s.widgets.some(w => w.buttonList)
  );
  assert.ok(actionSection, 'Action section with buttons must exist');

  const buttonWidget = actionSection.widgets.find(w => w.buttonList);
  const connectButton = buttonWidget.buttonList.buttons.find(b => b.onClick && b.onClick.openLink);
  assert.ok(connectButton, 'Connect overlay button must exist');

  assert.ok(connectButton.onClick.openLink, 'Button must use openLink');
  assert.equal(connectButton.onClick.openLink.openAs, 'OVERLAY');
  assert.equal(connectButton.onClick.openLink.onClose, 'RELOAD');
  assert.ok(connectButton.onClick.openLink.url.includes('/oauth/start'));
  assert.ok(connectButton.onClick.openLink.url.includes(encodeURIComponent(testEmail)));
});

test('GET /oauth/start returns OAuth consent screen for the OVERLAY window', async () => {
  const testEmail = 'oauth.overlay@example.com';
  const res = await fetch(`${baseUrl}/oauth/start?userId=${encodeURIComponent(testEmail)}`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('Sender Contact Manager'));
  assert.ok(html.includes(testEmail));
  assert.ok(html.includes('/oauth/authorize'));
});

test('OAuth authorization stores tokens in in-memory backend and returns auto-close success page', async () => {
  const store = require('../src/store');
  const testEmail = 'inmemory.tokens@example.com';
  await store.disconnectUser(testEmail);
  assert.equal(store.isConnected(testEmail), false);
  assert.equal(store.getTokens(testEmail), null);

  const res = await fetch(`${baseUrl}/oauth/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `userId=${encodeURIComponent(testEmail)}`
  });

  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('Connected Successfully!'));
  assert.ok(html.includes('window.close()'));

  const storedTokens = store.getTokens(testEmail);
  assert.ok(storedTokens, 'Tokens must be stored in backend');
  assert.ok(storedTokens.accessToken, 'Access token must be present');
  assert.ok(storedTokens.refreshToken, 'Refresh token must be present');
  assert.equal(storedTokens.tokenType, 'Bearer');
  assert.equal(store.isConnected(testEmail), true);
});

test('After successful connect overlay, onHomepage reload displays Homepage without Account Status', async () => {
  const store = require('../src/store');
  const testEmail = 'reload.user@example.com';

  await store.disconnectUser(testEmail);
  assert.equal(store.isConnected(testEmail), false);

  const initialEvent = {
    commonEventObject: {
      hostApp: 'GMAIL',
      userEmail: testEmail,
      invokedFunction: 'onHomepage'
    }
  };

  const initialRes = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(initialEvent)
  });
  const initialData = await initialRes.json();
  assert.equal(initialData.action.navigations[0].pushCard.header.title, 'Connect Contacts');

  const oauthRes = await fetch(`${baseUrl}/oauth/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ userId: testEmail })
  });
  assert.equal(oauthRes.status, 200);

  const reloadRes = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(initialEvent)
  });
  assert.equal(reloadRes.status, 200);
  const reloadData = await reloadRes.json();
  const homepageCard = reloadData.action.navigations[0].pushCard;

  assert.equal(homepageCard.header.title, 'Contacts Manager');

  // Verify Account Status is NOT present
  const overviewSection = homepageCard.sections.find(s => s.header === 'Account Status');
  assert.equal(overviewSection, undefined, 'Account Status must NOT exist on homepage');

  // Verify Quick Add Contact is NOT present
  const quickAddSection = homepageCard.sections.find(s => s.header === 'Quick Add Contact');
  assert.equal(quickAddSection, undefined, 'Quick Add Contact must NOT exist on homepage');

  // Verify Clear Contacts and Disconnect Connection buttons are present
  const allButtons = homepageCard.sections.flatMap(s =>
    (s.widgets || []).flatMap(w => w.buttonList?.buttons || [])
  );
  assert.ok(allButtons.find(b => b.text === 'Clear Contacts'));
  assert.ok(allButtons.find(b => b.text === 'Disconnect Connection'));
});

test('Connect card in production uses public Firebase Hosting URL to prevent 403 Forbidden in overlay', async () => {
  const store = require('../src/store');
  const prodEmail = 'prod.overlay.user@example.com';
  await store.disconnectUser(prodEmail);

  process.env.PUBLIC_OAUTH_URL = 'https://mock-oauth.web.app/oauth.html';

  const event = {
    commonEventObject: {
      hostApp: 'GMAIL',
      userEmail: prodEmail,
      invokedFunction: 'onHomepage'
    }
  };

  const res = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event)
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  const pushCard = data.action.navigations[0].pushCard;
  assert.equal(pushCard.header.title, 'Connect Contacts');

  const actionSection = pushCard.sections.find(s =>
    s.widgets && s.widgets.some(w => w.buttonList)
  );
  const connectButton = actionSection.widgets.find(w => w.buttonList).buttonList.buttons.find(b => b.onClick && b.onClick.openLink);
  assert.ok(connectButton, 'Connect overlay button must exist');

  assert.equal(connectButton.onClick.openLink.openAs, 'OVERLAY');
  assert.equal(connectButton.onClick.openLink.onClose, 'RELOAD');
  assert.ok(connectButton.onClick.openLink.url.startsWith('https://mock-oauth.web.app/oauth.html'));

  delete process.env.PUBLIC_OAUTH_URL;
});

test('Clear Contacts and Disconnect Connection ONLY show on homepage', async () => {
  // 1. Check Homepage
  const homepageEvent = {
    commonEventObject: {
      hostApp: 'GMAIL',
      userEmail: 'testuser@example.com',
      invokedFunction: 'onHomepage'
    }
  };
  const homeRes = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(homepageEvent)
  });
  assert.equal(homeRes.status, 200);
  const homeData = await homeRes.json();
  const homeCard = homeData.action.navigations[0].pushCard;

  const homeButtons = homeCard.sections.flatMap(s =>
    (s.widgets || []).flatMap(w => w.buttonList?.buttons || [])
  );
  assert.ok(homeButtons.find(b => b.text === 'Clear Contacts'), 'Clear Contacts must show on homepage');
  assert.ok(homeButtons.find(b => b.text === 'Disconnect Connection'), 'Disconnect Connection must show on homepage');

  // 2. Check Contextual Email Open Card
  const emailEvent = {
    commonEventObject: {
      hostApp: 'GMAIL',
      userEmail: 'testuser@example.com',
      invokedFunction: 'onGmailMessageOpen',
      parameters: {
        senderEmail: 'test.unique.sender@example.com',
        senderName: 'Test Unique Sender'
      }
    }
  };
  const emailRes = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(emailEvent)
  });
  assert.equal(emailRes.status, 200);
  const emailData = await emailRes.json();
  const emailCard = emailData.action.navigations[0].pushCard;

  const emailButtons = emailCard.sections.flatMap(s =>
    (s.widgets || []).flatMap(w => w.buttonList?.buttons || [])
  );
  assert.equal(emailButtons.find(b => b.text === 'Clear Contacts'), undefined, 'Clear Contacts must NOT show on email card');
  assert.equal(emailButtons.find(b => b.text === 'Disconnect Connection'), undefined, 'Disconnect Connection must NOT show on email card');
  assert.ok(emailButtons.find(b => b.text === 'Add Contact'), 'Add Contact MUST show when email is open');
});

test('POST / - handles handleClearContacts to clear all contacts and returns empty contacts homepage', async () => {
  const store = require('../src/store');

  await store.addContact({ name: 'Temporary Tester', email: 'temp.tester@example.com' });
  assert.ok(store.getContactCount() > 0, 'Contacts should exist before clearing');

  const event = {
    commonEventObject: {
      hostApp: 'GMAIL',
      userEmail: 'testuser@example.com',
      invokedFunction: 'handleClearContacts'
    }
  };

  const res = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event)
  });

  assert.equal(res.status, 200);
  const data = await res.json();

  assert.ok(data.action, 'Response must have action object');
  assert.ok(data.action.notification, 'Response must show a notification');
  assert.ok(data.action.notification.text.includes('cleared successfully'));

  const homepageCard = data.action.navigations[0].pushCard;
  assert.equal(homepageCard.header.title, 'Contacts Manager');
  assert.ok(homepageCard.header.subtitle.includes('0 Contact(s)'));

  assert.equal(store.getContactCount(), 0, 'Store must have 0 contacts after clearing');
});

test('parseFromHeader correctly extracts names and emails from RFC 5322 and MIME headers', () => {
  const { parseFromHeader } = require('../src/utils/senderHelper');

  const p1 = parseFromHeader('"John Doe" <john.doe@company.org>');
  assert.equal(p1.name, 'John Doe');
  assert.equal(p1.email, 'john.doe@company.org');

  const p2 = parseFromHeader('Jane Smith <jane.smith@partner.io>');
  assert.equal(p2.name, 'Jane Smith');
  assert.equal(p2.email, 'jane.smith@partner.io');

  const p3 = parseFromHeader('<user.test@example.com>');
  assert.equal(p3.name, '');
  assert.equal(p3.email, 'user.test@example.com');

  const p4 = parseFromHeader('bare.email@example.com');
  assert.equal(p4.name, '');
  assert.equal(p4.email, 'bare.email@example.com');
});

test('POST / - contextual trigger fetches real sender from Gmail API instead of hardcoded Alex Smith', async () => {
  const originalFetch = global.fetch;
  const mockMessageId = 'msg_live_gmail_98765';
  const mockAccessToken = 'ya29.live_ephemeral_token_abc';
  const realSenderName = 'Dr. Gordon Freeman';
  const realSenderEmail = 'gordon.freeman@blackmesa.gov';

  let gmailApiCalled = false;

  global.fetch = async (url, options = {}) => {
    if (typeof url === 'string' && url.includes('gmail.googleapis.com')) {
      gmailApiCalled = true;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: mockMessageId,
          payload: {
            headers: [
              { name: 'From', value: `${realSenderName} <${realSenderEmail}>` },
              { name: 'Subject', value: 'Test Message Subject' }
            ]
          }
        }),
        text: async () => ''
      };
    }
    return originalFetch(url, options);
  };

  try {
    const contextualEvent = {
      commonEventObject: {
        hostApp: 'GMAIL',
        userEmail: 'testuser@example.com'
      },
      gmail: {
        messageId: mockMessageId,
        accessToken: mockAccessToken
      }
    };

    const res = await originalFetch(`${baseUrl}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(contextualEvent)
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    const card = data.action.navigations[0].pushCard;

    assert.equal(gmailApiCalled, true, 'Add-on must query Gmail API');

    const cardJson = JSON.stringify(card);
    assert.equal(cardJson.includes('alex.smith@example.com'), false, 'Card must NOT contain hardcoded alex.smith@example.com');
    assert.equal(cardJson.includes('Alex Smith'), false, 'Card must NOT contain hardcoded Alex Smith');

    // Verify sender info is displayed
    const senderSection = card.sections.find(s => s.header === 'Sender Information');
    assert.ok(senderSection);

    const nameWidget = senderSection.widgets.find(w => w.decoratedText && w.decoratedText.topLabel === 'Sender Name');
    assert.ok(nameWidget);
    assert.ok(nameWidget.decoratedText.text.includes(realSenderName));

    const emailWidget = senderSection.widgets.find(w => w.decoratedText && w.decoratedText.topLabel === 'Sender Email');
    assert.ok(emailWidget);
    assert.ok(emailWidget.decoratedText.text.includes(realSenderEmail));

    // Verify Add Contact button with real sender parameters
    const btnWidget = senderSection.widgets.find(w => w.buttonList);
    const addBtn = btnWidget.buttonList.buttons.find(b => b.text === 'Add Contact');
    assert.ok(addBtn);
    assert.equal(addBtn.onClick.action.parameters.find(p => p.key === 'contactEmail').value, realSenderEmail);
    assert.equal(addBtn.onClick.action.parameters.find(p => p.key === 'contactName').value, realSenderName);
  } finally {
    global.fetch = originalFetch;
  }
});

test('POST / - contextual trigger does NOT prefill Alex Smith when message metadata fetch fails', async () => {
  const originalFetch = global.fetch;
  const mockMessageId = 'msg_not_found_404';
  const mockAccessToken = 'ya29.invalid_token';

  global.fetch = async (url, options = {}) => {
    if (typeof url === 'string' && url.includes('gmail.googleapis.com')) {
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: 'Not found' }),
        text: async () => 'Not found'
      };
    }
    return originalFetch(url, options);
  };

  try {
    const contextualEvent = {
      commonEventObject: {
        hostApp: 'GMAIL',
        userEmail: 'testuser@example.com'
      },
      gmail: {
        messageId: mockMessageId,
        accessToken: mockAccessToken
      }
    };

    const res = await originalFetch(`${baseUrl}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(contextualEvent)
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    const card = data.action.navigations[0].pushCard;

    const cardJson = JSON.stringify(card);
    assert.equal(cardJson.includes('alex.smith@example.com'), false);
    assert.equal(cardJson.includes('Alex Smith'), false);

    const senderSection = card.sections.find(s => s.header === 'Sender Information');
    assert.ok(senderSection);
    const textWidget = senderSection.widgets.find(w => w.textParagraph);
    assert.ok(textWidget);
    assert.ok(textWidget.textParagraph.text.includes('No sender details detected'));
  } finally {
    global.fetch = originalFetch;
  }
});

test('Stores connection token in Firestore upon connect, and clears token and auth info from Firestore upon disconnect', async () => {
  const store = require('../src/store');
  const testEmail = 'firestore.tokens@example.com';

  const mockFirestoreState = new Map();

  const mockFirestore = {
    collection: (colName) => {
      return {
        doc: (docId) => ({
          set: async (data) => {
            mockFirestoreState.set(`${colName}/${docId}`, data);
          },
          delete: async () => {
            mockFirestoreState.delete(`${colName}/${docId}`);
          },
          get: async () => {
            const data = mockFirestoreState.get(`${colName}/${docId}`);
            return { exists: Boolean(data), data: () => data };
          }
        }),
        get: async () => {
          const docs = [];
          for (const [key, val] of mockFirestoreState.entries()) {
            if (key.startsWith(`${colName}/`)) {
              docs.push({
                id: key.replace(`${colName}/`, ''),
                ref: {
                  delete: async () => mockFirestoreState.delete(key)
                },
                data: () => val
              });
            }
          }
          return {
            empty: docs.length === 0,
            size: docs.length,
            docs,
            forEach: (cb) => docs.forEach(cb)
          };
        },
        batch: () => ({
          delete: (docRef) => {
            for (const [key] of mockFirestoreState.entries()) {
              if (key.includes(testEmail)) mockFirestoreState.delete(key);
            }
          },
          commit: async () => {}
        })
      };
    }
  };

  const originalDb = store.getFirestoreDb();
  store.setFirestoreDb(mockFirestore);

  try {
    // 1. Connect user
    await store.connectUser(testEmail);
    assert.ok(mockFirestoreState.has(`tokens/${testEmail}`), 'Firestore must contain token doc after connect');
    const storedTokenDoc = mockFirestoreState.get(`tokens/${testEmail}`);
    assert.equal(storedTokenDoc.userId, testEmail);
    assert.ok(storedTokenDoc.accessToken);
    assert.equal(storedTokenDoc.connected, true);

    // 2. Disconnect user - clears all token and auth info
    await store.disconnectUser(testEmail);
    assert.equal(mockFirestoreState.has(`tokens/${testEmail}`), false, 'Firestore token doc must be deleted upon disconnect');
  } finally {
    store.setFirestoreDb(originalDb);
  }
});

test('OAuth authorization dance stores token in Firestore and handleDisconnect deletes token and auth info from Firestore', async () => {
  const store = require('../src/store');
  const testEmail = 'http.firestore.user@example.com';

  const mockFirestoreTokens = new Map();

  const mockFirestore = {
    collection: (colName) => {
      return {
        doc: (docId) => ({
          set: async (data) => mockFirestoreTokens.set(`${colName}/${docId}`, data),
          delete: async () => mockFirestoreTokens.delete(`${colName}/${docId}`),
          get: async () => {
            const data = mockFirestoreTokens.get(`${colName}/${docId}`);
            return { exists: Boolean(data), data: () => data };
          }
        }),
        get: async () => {
          const docs = [];
          for (const [k, v] of mockFirestoreTokens.entries()) {
            if (k.startsWith(`${colName}/`)) {
              docs.push({ id: k.replace(`${colName}/`, ''), ref: { delete: async () => mockFirestoreTokens.delete(k) }, data: () => v });
            }
          }
          return { empty: docs.length === 0, size: docs.length, docs, forEach: (cb) => docs.forEach(cb) };
        },
        batch: () => ({
          delete: (docRef) => {
            for (const [k] of mockFirestoreTokens.entries()) {
              if (k.includes(testEmail)) mockFirestoreTokens.delete(k);
            }
          },
          commit: async () => {}
        })
      };
    }
  };

  const originalDb = store.getFirestoreDb();
  store.setFirestoreDb(mockFirestore);

  try {
    const oauthRes = await fetch(`${baseUrl}/oauth/authorize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ userId: testEmail })
    });
    assert.equal(oauthRes.status, 200);
    assert.ok(mockFirestoreTokens.has(`tokens/${testEmail}`), 'Token doc must exist in Firestore after OAuth authorization');

    const disconnectEvent = {
      commonEventObject: {
        userEmail: testEmail,
        invokedFunction: 'handleDisconnect'
      }
    };
    const disconnectRes = await fetch(`${baseUrl}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(disconnectEvent)
    });
    assert.equal(disconnectRes.status, 200);
    assert.equal(mockFirestoreTokens.has(`tokens/${testEmail}`), false, 'Token doc must be deleted from Firestore after handleDisconnect');
  } finally {
    store.setFirestoreDb(originalDb);
  }
});

test('After handleDisconnect, refreshing/reloading onHomepage remains disconnected', async () => {
  const store = require('../src/store');
  const testEmail = 'persist.disconnect@example.com';

  await store.connectUser(testEmail);
  assert.equal(store.isConnected(testEmail), true);

  const disconnectEvent = {
    commonEventObject: {
      userEmail: testEmail,
      invokedFunction: 'handleDisconnect'
    }
  };
  const disconnectRes = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(disconnectEvent)
  });
  assert.equal(disconnectRes.status, 200);
  assert.equal(store.isConnected(testEmail), false, 'User must be disconnected');

  const refreshEvent = {
    commonEventObject: {
      hostApp: 'GMAIL',
      userEmail: testEmail,
      invokedFunction: 'onHomepage'
    }
  };
  const refreshRes = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(refreshEvent)
  });
  assert.equal(refreshRes.status, 200);
  const refreshData = await refreshRes.json();
  const pushCard = refreshData.action.navigations[0].pushCard;

  assert.equal(pushCard.header.title, 'Connect Contacts');
  assert.equal(store.isConnected(testEmail), false);
});

test('Clear Contacts clears all contacts for the current user in Firestore without affecting other users', async () => {
  const store = require('../src/store');
  const userA = 'user.a@example.com';
  const userB = 'user.b@example.com';

  const mockDbContacts = new Map();

  const toDelete = [];
  const mockFirestore = {
    batch: () => {
      return {
        delete: (ref) => toDelete.push(ref),
        commit: async () => {
          for (const ref of toDelete) await ref.delete();
        }
      };
    },
    collection: (colName) => {
      assert.equal(colName, 'contacts');
      return {
        doc: (id) => ({
          set: async (data) => mockDbContacts.set(id, data),
          delete: async () => mockDbContacts.delete(id)
        }),
        get: async () => {
          const docs = [];
          for (const [id, data] of mockDbContacts.entries()) {
            docs.push({
              id,
              data: () => data,
              ref: { delete: async () => mockDbContacts.delete(id) }
            });
          }
          return {
            empty: docs.length === 0,
            size: docs.length,
            docs,
            forEach: (cb) => docs.forEach(cb)
          };
        }
      };
    }
  };

  const origDb = store.getFirestoreDb();
  store.setFirestoreDb(mockFirestore);

  try {
    // Add contacts for User A and User B
    await store.addContact({ name: 'Contact A1', email: 'a1@test.com' }, userA);
    await store.addContact({ name: 'Contact A2', email: 'a2@test.com' }, userA);
    await store.addContact({ name: 'Contact B1', email: 'b1@test.com' }, userB);

    assert.equal(mockDbContacts.size, 3);
    assert.equal(store.getContacts(userA).length, 2);
    assert.equal(store.getContacts(userB).length, 1);

    // User A clears contacts
    await store.clearContacts(userA);

    // User A should have 0 contacts
    assert.equal(store.getContacts(userA).length, 0);

    // User B's contact should still exist in Firestore!
    assert.equal(mockDbContacts.size, 1);
    const remainingContact = Array.from(mockDbContacts.values())[0];
    assert.equal(remainingContact.userId, userB);
    assert.equal(remainingContact.email, 'b1@test.com');
  } finally {
    store.setFirestoreDb(origDb);
  }
});

test('Disconnect Connection clears all token and auth info from Firestore for current user', async () => {
  const store = require('../src/store');
  const user = 'disconnect.test.user@example.com';

  const mockDbTokens = new Map();
  const mockDbAuth = new Map();

  const mockFirestore = {
    batch: () => {
      const deletes = [];
      return {
        delete: (ref) => deletes.push(ref),
        commit: async () => {
          for (const d of deletes) await d.delete();
        }
      };
    },
    collection: (colName) => {
      if (colName === 'tokens') {
        return {
          doc: (id) => ({
            set: async (data) => mockDbTokens.set(id, data),
            delete: async () => mockDbTokens.delete(id),
            get: async () => ({ exists: mockDbTokens.has(id), data: () => mockDbTokens.get(id) })
          }),
          get: async () => {
            const docs = [];
            for (const [id, data] of mockDbTokens.entries()) {
              docs.push({
                id,
                data: () => data,
                ref: { delete: async () => mockDbTokens.delete(id) }
              });
            }
            return {
              empty: docs.length === 0,
              size: docs.length,
              docs,
              forEach: (cb) => docs.forEach(cb)
            };
          }
        };
      }
      if (colName === 'auth') {
        return {
          doc: (id) => ({
            set: async (data) => mockDbAuth.set(id, data),
            delete: async () => mockDbAuth.delete(id),
            get: async () => ({ exists: mockDbAuth.has(id), data: () => mockDbAuth.get(id) })
          })
        };
      }
      throw new Error(`Unexpected collection: ${colName}`);
    }
  };

  const origDb = store.getFirestoreDb();
  store.setFirestoreDb(mockFirestore);

  try {
    // 1. Connect user
    await store.connectUser(user);
    mockDbAuth.set(user, { user, authState: 'valid' });

    assert.ok(mockDbTokens.has(user), 'Token must exist in Firestore');
    assert.ok(mockDbAuth.has(user), 'Auth doc must exist in Firestore');
    assert.equal(store.isConnected(user), true);

    // 2. Disconnect Connection
    await store.disconnectUser(user);

    // 3. Verify all token and auth info is removed from Firestore
    assert.equal(mockDbTokens.has(user), false, 'Token must be removed from Firestore');
    assert.equal(mockDbAuth.has(user), false, 'Auth info must be removed from Firestore');
    assert.equal(store.isConnected(user), false, 'User must be marked disconnected');
  } finally {
    store.setFirestoreDb(origDb);
  }
});

test('Gmail API request includes both Authorization: Bearer <userOAuthToken> and X-Goog-Gmail-Access-Token: <gmailAccessToken>', async () => {
  const { fetchSenderFromGmailApi } = require('../src/utils/senderHelper');
  const originalFetch = global.fetch;

  let capturedHeaders = null;
  let capturedUrl = null;

  global.fetch = async (url, options = {}) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: '12345',
        payload: {
          headers: [
            { name: 'From', value: 'Ada Lovelace <ada@example.org>' }
          ]
        }
      }),
      text: async () => ''
    };
  };

  try {
    const sender = await fetchSenderFromGmailApi('12345', {
      userOAuthToken: 'ya29.user_oauth_token_val',
      gmailAccessToken: 'ephemeral_message_unlock_val'
    });

    assert.ok(sender);
    assert.equal(sender.name, 'Ada Lovelace');
    assert.equal(sender.email, 'ada@example.org');

    assert.ok(capturedHeaders, 'Headers must be captured');
    assert.equal(capturedHeaders['Authorization'], 'Bearer ya29.user_oauth_token_val');
    assert.equal(capturedHeaders['X-Goog-Gmail-Access-Token'], 'ephemeral_message_unlock_val');
    assert.equal(capturedHeaders['Accept'], 'application/json');
    assert.ok(capturedUrl.includes('/users/me/messages/12345'));
  } finally {
    global.fetch = originalFetch;
  }
});

test('Gmail API request retries msg-f format with hexadecimal ID on 404', async () => {
  const { fetchSenderFromGmailApi } = require('../src/utils/senderHelper');
  const originalFetch = global.fetch;

  const attemptedUrls = [];

  global.fetch = async (url, options = {}) => {
    attemptedUrls.push(url);
    if (url.includes('msg-f%3A1876057502532063256') || url.includes('msg-f:1876057502532063256')) {
      return {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: async () => 'Not Found'
      };
    }
    // Hex converted ID BigInt('1876057502532063256').toString(16) === '1a09185bd8a15018'
    if (url.includes('1a09185bd8a15018')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: '1a09185bd8a15018',
          payload: {
            headers: [
              { name: 'From', value: 'Alan Turing <alan.turing@bletchley.uk>' }
            ]
          }
        }),
        text: async () => ''
      };
    }
    return { ok: false, status: 500, statusText: 'Error', text: async () => '' };
  };

  try {
    const sender = await fetchSenderFromGmailApi('msg-f:1876057502532063256', {
      userOAuthToken: 'ya29.valid_user_token',
      gmailAccessToken: 'msg_unlock_token'
    });

    assert.ok(sender, 'Sender must be extracted on retry');
    assert.equal(sender.name, 'Alan Turing');
    assert.equal(sender.email, 'alan.turing@bletchley.uk');
    assert.ok(attemptedUrls.length >= 2, 'Must have attempted initial msg-f then retried hex');
    assert.ok(attemptedUrls.some(u => u.includes('1a09185bd8a15018')), 'A retry attempt must use hex ID');
  } finally {
    global.fetch = originalFetch;
  }
});

test('Closing overlay without going through auth dance leaves user disconnected', async () => {
  const store = require('../src/store');
  const danceEmail = 'dance.tester@example.com';

  await store.disconnectUser(danceEmail);
  assert.equal(store.isConnected(danceEmail), false);

  // 1. Initial homepage shows Connect card with overlay button
  const homeRes = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      commonEventObject: {
        hostApp: 'GMAIL',
        userEmail: danceEmail,
        invokedFunction: 'onHomepage'
      }
    })
  });
  const homeData = await homeRes.json();
  const card = homeData.action.navigations[0].pushCard;
  assert.equal(card.header.title, 'Connect Contacts');

  // Verify the Connect button has openUrl with OVERLAY and RELOAD
  const allButtons = card.sections.flatMap(s =>
    (s.widgets || []).flatMap(w => w.buttonList?.buttons || [])
  );
  const connectBtn = allButtons.find(b => b.text === 'Connect Account');
  assert.ok(connectBtn);
  assert.equal(connectBtn.onClick.openLink.openAs, 'OVERLAY');
  assert.equal(connectBtn.onClick.openLink.onClose, 'RELOAD');

  // 2. User closes overlay WITHOUT authorizing (no /oauth/authorize called)
  // Simulate Gmail onClose: 'RELOAD' triggering homepage reload
  const reloadRes = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      commonEventObject: {
        hostApp: 'GMAIL',
        userEmail: danceEmail,
        invokedFunction: 'onHomepage'
      }
    })
  });
  const reloadData = await reloadRes.json();
  const reloadedCard = reloadData.action.navigations[0].pushCard;

  // MUST STILL SHOW Connect Contacts card, NOT Contacts Manager!
  assert.equal(reloadedCard.header.title, 'Connect Contacts', 'Must remain on Connect Contacts card');
  assert.equal(store.isConnected(danceEmail), false, 'User must remain disconnected');
});

test('POST / - onGmailMessageOpen returns requesting_google_scopes when authorizedScopes lacks gmail.readonly', async () => {
  const store = require('../src/store');
  const user = 'scopes.tester@example.com';
  await store.connectUser(user);

  const event = {
    commonEventObject: {
      hostApp: 'GMAIL',
      userEmail: user,
      invokedFunction: 'onGmailMessageOpen'
    },
    authorizationEventObject: {
      userOAuthToken: 'ya29.partial_scopes_token',
      authorizedScopes: [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/gmail.addons.execute'
      ]
    },
    gmail: {
      messageId: 'msg-12345',
      accessToken: 'msg-token-123'
    }
  };

  const res = await fetch(`${baseUrl}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event)
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.requesting_google_scopes, 'Response must request google scopes');
  assert.deepEqual(data.requesting_google_scopes.scopes, ['https://www.googleapis.com/auth/gmail.readonly']);
});

test('POST / - onGmailMessageOpen returns requesting_google_scopes when Gmail API returns 403 Insufficient Scope', async () => {
  const store = require('../src/store');
  const user = 'scope403.tester@example.com';
  await store.connectUser(user);

  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    if (typeof url === 'string' && url.includes('gmail.googleapis.com')) {
      return {
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: async () => JSON.stringify({
          error: {
            code: 403,
            message: 'Request had insufficient authentication scopes.',
            errors: [{ message: 'Insufficient Permission', domain: 'global', reason: 'insufficientPermissions' }]
          }
        })
      };
    }
    return originalFetch(url, options);
  };

  try {
    const event = {
      commonEventObject: {
        hostApp: 'GMAIL',
        userEmail: user,
        invokedFunction: 'onGmailMessageOpen'
      },
      authorizationEventObject: {
        userOAuthToken: 'ya29.insufficient_token'
      },
      gmail: {
        messageId: 'msg-12345',
        accessToken: 'msg-token-123'
      }
    };

    const res = await originalFetch(`${baseUrl}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event)
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.requesting_google_scopes, 'Response must request google scopes when 403 is received');
    assert.deepEqual(data.requesting_google_scopes.scopes, ['https://www.googleapis.com/auth/gmail.readonly']);
  } finally {
    global.fetch = originalFetch;
  }
});

