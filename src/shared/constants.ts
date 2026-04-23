export const DESTINY2_GAME_ID = 21590;

// Chrome's chrome.alarms minimum period is 1 minute (in production builds).
// Adaptive sub-minute polling from Brief #6 is not available in the extension
// platform; accept the 1-minute floor.
export const POLL_ALARM_NAME = 'cryptarch:poll';
export const POLL_PERIOD_MINUTES = 1;
