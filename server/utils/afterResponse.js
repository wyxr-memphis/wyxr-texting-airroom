// Work that must happen after the HTTP response is sent (Slack posts after
// answering Twilio; Slack event handling after answering Slack within its
// 3-second window). Errors are logged, never thrown.
//
// drain() lets tests wait for that work instead of sleeping.
const pending = new Set();

const runAfterResponse = (label, fn) => {
  const task = new Promise((resolve) => setImmediate(resolve))
    .then(fn)
    .catch((err) => console.error(`[after-response] ${label} failed:`, err.message))
    .finally(() => pending.delete(task));
  pending.add(task);
  return task;
};

const drain = async () => {
  while (pending.size > 0) {
    await Promise.all([...pending]);
  }
};

module.exports = { runAfterResponse, drain };
