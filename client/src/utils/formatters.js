export const formatPhoneNumber = (phone) => {
  // Remove +1 country code if present
  const cleaned = phone.replace(/^\+1/, '');

  // Format as (XXX) XXX-XXXX
  const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);
  if (match) {
    return `(${match[1]}) ${match[2]}-${match[3]}`;
  }

  return phone;
};

export const formatTime = (timestamp) => {
  const date = new Date(timestamp);
  const now = new Date();

  // If today, show time only
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  // If yesterday, show "Yesterday HH:MM"
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday ' + date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  // Otherwise show date and time
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  }) + ' ' + date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
};
