/**
 * WhatsApp Message Parser
 *
 * Extracts content from different WhatsApp message types
 * Supports: text, image, document, audio, video, location, contacts, etc.
 */

/**
 * Extracts content from a WhatsApp message based on its type
 *
 * @param {Object} message - WhatsApp message object from webhook
 * @returns {Object|null} Extracted content with { text, mediaUrl, type } or null
 */
export function extractMessageContent(message) {
  const { type } = message;

  switch (type) {
    case 'text':
      return {
        text: message.text?.body || '',
        type: 'text',
      };

    case 'image':
      return {
        text: message.image?.caption || '[Imagen]',
        mediaUrl: message.image?.id, // Media ID from Meta
        type: 'image',
      };

    case 'document':
      return {
        text: message.document?.caption || message.document?.filename || '[Documento]',
        mediaUrl: message.document?.id,
        type: 'document',
      };

    case 'audio':
      return {
        text: '[Audio]',
        mediaUrl: message.audio?.id,
        type: 'audio',
      };

    case 'video':
      return {
        text: message.video?.caption || '[Video]',
        mediaUrl: message.video?.id,
        type: 'video',
      };

    case 'location':
      return {
        text: `[Ubicación: ${message.location?.latitude}, ${message.location?.longitude}]`,
        type: 'location',
      };

    case 'contacts':
      return {
        text: '[Contacto compartido]',
        type: 'contacts',
      };

    case 'sticker':
      return {
        text: '[Sticker]',
        mediaUrl: message.sticker?.id,
        type: 'sticker',
      };

    case 'interactive':
      // User clicked a button or list item
      return extractInteractiveContent(message.interactive);

    case 'button':
      // Legacy button reply
      return {
        text: message.button?.text || '[Botón]',
        type: 'button',
      };

    default:
      return {
        text: `[Tipo de mensaje no soportado: ${type}]`,
        type: 'unknown',
      };
  }
}

/**
 * Extracts content from interactive message replies (buttons, lists)
 *
 * @param {Object} interactive - Interactive object from message
 * @returns {Object} Extracted content
 */
function extractInteractiveContent(interactive) {
  const { type } = interactive;

  if (type === 'button_reply') {
    return {
      text: interactive.button_reply?.title || '',
      type: 'interactive_button',
    };
  }

  if (type === 'list_reply') {
    return {
      text: interactive.list_reply?.title || '',
      type: 'interactive_list',
    };
  }

  return {
    text: '[Interacción]',
    type: 'interactive',
  };
}

/**
 * Checks if a message is a supported text-based message
 *
 * @param {Object} message - WhatsApp message object
 * @returns {boolean} True if text-based
 */
export function isTextBased(message) {
  const textTypes = ['text', 'interactive', 'button'];
  return textTypes.includes(message.type);
}

/**
 * Checks if a message contains media
 *
 * @param {Object} message - WhatsApp message object
 * @returns {boolean} True if contains media
 */
export function hasMedia(message) {
  const mediaTypes = ['image', 'document', 'audio', 'video', 'sticker'];
  return mediaTypes.includes(message.type);
}
