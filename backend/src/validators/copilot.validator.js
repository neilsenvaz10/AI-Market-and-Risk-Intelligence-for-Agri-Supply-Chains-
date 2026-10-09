/**
 * Validator for Copilot Chat payloads.
 */
export const ALLOWED_LANGUAGES = ['en', 'hi', 'mr'];

export function validateCopilotChatPayload(body = {}) {
  const errors = {};

  if (!body || typeof body !== 'object') {
    return { data: null, errors: { body: 'Request body must be a JSON object' } };
  }

  // Validate message
  const rawMessage = body.message;
  if (rawMessage === undefined || rawMessage === null || typeof rawMessage !== 'string' || !rawMessage.trim()) {
    errors.message = 'Message is required and must not be blank.';
  } else if (rawMessage.trim().length > 500) {
    errors.message = 'Message must be at most 500 characters.';
  }

  // Validate language
  let language = 'en';
  if (body.language !== undefined && body.language !== null) {
    if (typeof body.language !== 'string' || !ALLOWED_LANGUAGES.includes(body.language.toLowerCase())) {
      errors.language = `Language must be one of: ${ALLOWED_LANGUAGES.join(', ')}`;
    } else {
      language = body.language.toLowerCase();
    }
  }

  // Validate context (optional)
  const context = {};
  if (body.context !== undefined && body.context !== null) {
    if (typeof body.context !== 'object' || Array.isArray(body.context)) {
      errors.context = 'Context must be an object.';
    } else {
      if (body.context.commodity && typeof body.context.commodity === 'string') {
        context.commodity = body.context.commodity.trim().slice(0, 64);
      }
      if (body.context.mandi && typeof body.context.mandi === 'string') {
        context.mandi = body.context.mandi.trim().slice(0, 128);
      }
      if (body.context.horizon !== undefined && body.context.horizon !== null) {
        const h = Number(body.context.horizon);
        if (Number.isInteger(h) && h >= 1 && h <= 7) {
          context.horizon = h;
        }
      }
    }
  }

  // Validate conversationHistory (optional)
  const conversationHistory = [];
  if (body.conversationHistory !== undefined && body.conversationHistory !== null) {
    if (!Array.isArray(body.conversationHistory)) {
      errors.conversationHistory = 'Conversation history must be an array.';
    } else {
      if (body.conversationHistory.length > 10) {
        errors.conversationHistory = 'Conversation history must have at most 10 turns.';
      } else {
        for (let i = 0; i < body.conversationHistory.length; i += 1) {
          const item = body.conversationHistory[i];
          if (!item || typeof item !== 'object') {
            errors[`conversationHistory[${i}]`] = 'History entry must be an object.';
            break;
          }
          const role = item.role;
          if (role !== 'user' && role !== 'assistant') {
            errors[`conversationHistory[${i}].role`] = 'Role must be "user" or "assistant".';
            break;
          }
          if (typeof item.content !== 'string' || item.content.length > 500) {
            errors[`conversationHistory[${i}].content`] = 'Content must be text under 500 characters.';
            break;
          }
          conversationHistory.push({ role, content: item.content });
        }
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    return { data: null, errors };
  }

  return {
    data: {
      message: rawMessage.trim(),
      language,
      context,
      conversationHistory,
    },
    errors: null,
  };
}
