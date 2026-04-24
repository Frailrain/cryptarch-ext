export const DESTINY2_GAME_ID = 21590;

// Chrome 120+ honors a 30-second minimum on chrome.alarms (periodInMinutes:
// 0.5). Values below 0.5 are silently clamped up with a warning. Adaptive
// sub-30s polling from Brief #6 is still not available — 30s is the floor.
export const POLL_ALARM_NAME = 'cryptarch:poll';
export const POLL_PERIOD_MINUTES = 0.5;
