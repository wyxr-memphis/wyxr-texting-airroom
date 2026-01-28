const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

const apiCall = async (endpoint, options = {}) => {
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Request failed');
  }

  return response.json();
};

export const login = async (username, password) => {
  return apiCall('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
};

export const verify = async () => {
  return apiCall('/api/verify');
};

export const logout = async () => {
  return apiCall('/api/logout', { method: 'POST' });
};

export const getMessages = async () => {
  return apiCall('/api/messages');
};

export const updateMessageReadStatus = async (id, read) => {
  return apiCall(`/api/messages/${id}/read`, {
    method: 'PATCH',
    body: JSON.stringify({ read }),
  });
};

export const replyToMessage = async (id, replyText) => {
  return apiCall(`/api/messages/${id}/reply`, {
    method: 'POST',
    body: JSON.stringify({ replyText }),
  });
};

export const getMessagingEnabled = async () => {
  return apiCall('/api/settings/messaging-enabled');
};

export const setMessagingEnabled = async (enabled) => {
  return apiCall('/api/settings/messaging-enabled', {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  });
};
