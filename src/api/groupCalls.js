// Discovery is separate from local participation: leaving must not hide an ongoing group call.
export function canJoinGroup(status, now = Date.now()) {
  if (!status?.active || !status.callId || !status.seq) return false;
  if (['active', 'connecting'].includes(status.state)) return true;
  return status.state === 'ringing' && Date.parse(status.expiresAt) > now;
}

export function groupStatus(info, title) {
  return { ...info.payload, seq: Number(info.seq), topic: info.src?.startsWith('grp') ? info.src : info.topic,
    title, type: info.payload.audioOnly === false ? 'video' : 'audio', error: '' };
}
