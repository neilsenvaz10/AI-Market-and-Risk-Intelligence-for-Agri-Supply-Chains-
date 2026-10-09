import { apiRequest } from './api';

/**
 * Send a message to the AI Farmer Copilot.
 * Requires a valid Firebase auth token.
 */
export async function sendCopilotMessage({
  message,
  language = 'en',
  context = {},
  conversationHistory = [],
  token,
} = {}) {
  return apiRequest('/api/copilot/chat', {
    method: 'POST',
    body: {
      message,
      language,
      context,
      conversationHistory,
    },
    token,
  });
}

/**
 * Fetch available Copilot capabilities and integrations.
 */
export async function getCopilotCapabilities() {
  return apiRequest('/api/copilot/capabilities', {
    method: 'GET',
  });
}
