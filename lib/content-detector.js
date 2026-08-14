const {
  getQuotedMessage,
  getQuotedType,
  getMessageContent,
  getContentType,
  getMessageText,
  extractUrls,
  isQuotedMessage,
  isHttpUrl
} = require('./utils');

const MEDIA_TYPES = new Set(['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage']);

function detectFromContent(message) {
  const type = getContentType(message);
  const content = getMessageContent(message);
  const text = getMessageText(message);
  const urls = extractUrls(text);

  if (type && MEDIA_TYPES.has(type)) {
    const media = content[type];
    return {
      type: type.replace('Message', '').toLowerCase(),
      source: 'current-message',
      url: media?.url || null,
      message,
      text,
      mimeType: media?.mimetype || media?.mimeType || null,
      fileName: media?.fileName || null
    };
  }

  if (urls.length) {
    return {
      type: 'url',
      source: 'current-message',
      url: urls[0],
      message,
      text
    };
  }

  if (text) {
    return {
      type: 'text',
      source: 'current-message',
      url: null,
      message,
      text
    };
  }

  return {
    type: 'unknown',
    source: 'current-message',
    url: null,
    message,
    text: ''
  };
}

function detectMessageContent(message) {
  if (isQuotedMessage(message)) {
    const quoted = getQuotedMessage(message);
    const quotedType = getQuotedType(message);
    const quotedText = getMessageText({ message: quoted });
    const urls = extractUrls(quotedText);

    if (quotedType && MEDIA_TYPES.has(quotedType)) {
      const media = quoted[quotedType];
      return {
        type: quotedType.replace('Message', '').toLowerCase(),
        source: 'quoted-message',
        url: media?.url || null,
        message: quoted,
        text: quotedText,
        mimeType: media?.mimetype || media?.mimeType || null,
        fileName: media?.fileName || null
      };
    }

    if (urls.length) {
      return {
        type: 'url',
        source: 'quoted-message',
        url: urls[0],
        message: quoted,
        text: quotedText
      };
    }

    return {
      type: 'text',
      source: 'quoted-message',
      url: null,
      message: quoted,
      text: quotedText
    };
  }

  return detectFromContent(message);
}

module.exports = {
  detectMessageContent
};

