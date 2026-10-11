// ── Ringback (caller hears until answered) ──
const isOutgoingRinging =
  Boolean(session) && !remoteStream && !incomingCall && !isMinimized;

useRingtone(isOutgoingRinging, {
  pattern: RINGBACK_PATTERN,
  silenceMs: 2000,
  volume: 0.10,
  wave: 'sine',
});

// ── Incoming ring (callee hears while pending) ──
const isIncomingRinging = Boolean(incomingCall);

useRingtone(isIncomingRinging, {
  pattern: INCOMING_SOFT_PATTERN,
  silenceMs: 900,
  volume: 0.16,
  wave: 'sine',
});