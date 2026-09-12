/**
 * Card Builder Utility for Google Workspace Add-ons (google.apps.card.v1 format)
 */

/**
 * Wraps a card object into a CardsV2 structure.
 * @param {string} cardId - Unique identifier for the card
 * @param {Object} card - Card content object
 * @returns {Object} CardsV2 structure
 */
function createCardV2(cardId, card) {
  return {
    cardId: cardId || `card_${Date.now()}`,
    card: card
  };
}

/**
 * Builds a Card structure with header and sections.
 * @param {Object} options
 * @param {string} options.title - Header title
 * @param {string} [options.subtitle] - Header subtitle
 * @param {string} [options.imageUrl] - Header icon URL
 * @param {Array<Object>} [options.sections] - Array of section objects
 * @returns {Object}
 */
function buildCard({ title, subtitle, imageUrl, sections = [] }) {
  const card = {};

  if (title) {
    card.header = {
      title,
      ...(subtitle && { subtitle }),
      ...(imageUrl && { imageUrl, imageType: 'CIRCLE' })
    };
  }

  card.sections = sections;
  return card;
}

/**
 * Creates a section containing widgets.
 * @param {Object} options
 * @param {string} [options.header] - Section title
 * @param {Array<Object>} options.widgets - Widgets array
 * @returns {Object}
 */
function createSection({ header, widgets = [] }) {
  return {
    ...(header && { header }),
    widgets
  };
}

/**
 * Text Paragraph widget
 * @param {string} text - HTML formatted text string
 * @returns {Object}
 */
function createTextParagraph(text) {
  return {
    textParagraph: {
      text
    }
  };
}

/**
 * Decorated Text widget (Key-value like list item)
 * @param {Object} options
 * @param {string} options.text - Main text
 * @param {string} [options.topLabel] - Label above main text
 * @param {string} [options.bottomLabel] - Label below main text
 * @param {Object} [options.startIcon] - Icon specifier (e.g. { knownIcon: 'EMAIL' })
 * @param {Object} [options.button] - Button widget attached to the right
 * @returns {Object}
 */
function createDecoratedText({ text, topLabel, bottomLabel, startIcon, button }) {
  return {
    decoratedText: {
      text,
      ...(topLabel && { topLabel }),
      ...(bottomLabel && { bottomLabel }),
      ...(startIcon && { startIcon }),
      ...(button && { button })
    }
  };
}

/**
 * Button object matching google.apps.card.v1.Button
 * @param {Object} options
 * @param {string} options.text - Button text label
 * @param {string} [options.actionMethod] - Action function name to invoke on click
 * @param {Object} [options.parameters] - Key-value map of parameters sent with action
 * @param {string} [options.openUrl] - External URL to open when clicked
 * @param {boolean} [options.isPrimary] - Style as primary filled button
 * @returns {Object}
 */
function createButton({ text, actionMethod, parameters = {}, openUrl, openAs, onClose, isPrimary = false, endpointUrl }) {
  const onClick = {};

  if (openUrl) {
    onClick.openLink = {
      url: openUrl,
      ...(openAs && { openAs }),
      ...(onClose && { onClose })
    };
  } else if (actionMethod) {
    const fn = (actionMethod.startsWith('http://') || actionMethod.startsWith('https://'))
      ? actionMethod
      : (endpointUrl || process.env.APP_URL || process.env.BASE_URL || 'http://localhost:3000/');

    const params = {
      invokedFunction: actionMethod,
      ...parameters
    };

    onClick.action = {
      function: fn,
      parameters: Object.entries(params).map(([key, value]) => ({
        key,
        value: String(value)
      }))
    };
  }

  return {
    text,
    onClick,
    ...(isPrimary && { color: { red: 0.1, green: 0.45, blue: 0.91, alpha: 1 } })
  };
}

/**
 * TextInput widget for forms matching google.apps.card.v1.TextInput
 * @param {Object} options
 * @param {string} options.name - Field input key name in event payload
 * @param {string} options.label - Label text for input box
 * @param {string} [options.hint] - Subtext/hint for user
 * @param {string} [options.value] - Initial input text value
 * @param {boolean} [options.multiline] - Multiline input box
 * @returns {Object}
 */
function createTextInput({ name, label, hint, value = '', multiline = false }) {
  return {
    textInput: {
      name,
      label,
      type: multiline ? 'MULTIPLE_LINE' : 'SINGLE_LINE',
      value,
      ...(hint && { hintText: hint })
    }
  };
}

/**
 * Generates standard Google Workspace renderActions response structure matching google.apps.card.v1.RenderActions
 * @param {Object} options
 * @param {Array<Object>} [options.cards] - Array of Card objects to render
 * @param {string} [options.notificationText] - Toast notification message text
 * @param {Object} [options.link] - OpenLink object
 * @returns {Object}
 */
function createResponsePayload({
  cards = [],
  notificationText = null,
  link = null,
  navigations = null
} = {}) {
  const action = {};

  if (navigations && navigations.length > 0) {
    action.navigations = navigations;
  } else if (cards.length > 0) {
    action.navigations = cards.map(cardV2 => ({
      pushCard: cardV2.card || cardV2
    }));
  }

  if (notificationText) {
    action.notification = {
      text: notificationText
    };
  }

  if (link) {
    action.link = link;
  }

  return { action };
}

module.exports = {
  createCardV2,
  buildCard,
  createSection,
  createTextParagraph,
  createDecoratedText,
  createButton,
  createTextInput,
  createResponsePayload
};
