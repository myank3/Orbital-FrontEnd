const APP_ID = import.meta.env.VITE_SFU_APP_ID;
const APP_SECRET = import.meta.env.VITE_SFU_APP_SECRET;

const BASE = `https://rtc.live.cloudflare.com/v1/apps/${APP_ID}`;
const HEADERS = {
  'content-type': 'application/json',
  Authorization: `Bearer ${APP_SECRET}`,
};

function check<T>(r: any): T {
  if (r?.errorCode) throw new Error(r.errorDescription);
  return r as T;
}

export async function createSession(offerSdp: string) {
  const r = await fetch(`${BASE}/sessions/new`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ sessionDescription: { type: 'offer', sdp: offerSdp } }),
  }).then((x) => x.json());
  return check<{ sessionId: string; sessionDescription: RTCSessionDescriptionInit }>(r);
}

export async function publishTrack(
  sessionId: string,
  mid: string,
  trackName: string,
  offerSdp: string,
) {
  const r = await fetch(`${BASE}/sessions/${sessionId}/tracks/new`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      sessionDescription: { type: 'offer', sdp: offerSdp },
      tracks: [{ location: 'local', mid, trackName }],
    }),
  }).then((x) => x.json());
  return check<{ sessionDescription: RTCSessionDescriptionInit }>(r);
}

export async function pullTrack(
  sessionId: string,
  remoteSessionId: string,
  remoteTrackName: string,
) {
  const r = await fetch(`${BASE}/sessions/${sessionId}/tracks/new`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      tracks: [{ location: 'remote', sessionId: remoteSessionId, trackName: remoteTrackName }],
    }),
  }).then((x) => x.json());
  return check<{
    sessionDescription?: RTCSessionDescriptionInit;
    requiresImmediateRenegotiation?: boolean;
  }>(r);
}

export async function sendAnswer(sessionId: string, answerSdp: string) {
  await fetch(`${BASE}/sessions/${sessionId}/renegotiate`, {
    method: 'PUT',
    headers: HEADERS,
    body: JSON.stringify({ sessionDescription: { type: 'answer', sdp: answerSdp } }),
  });
}