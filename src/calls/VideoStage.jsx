import { useEffect, useRef } from 'react';

function ParticipantVideo({ track, local = false, label }) {
  const video = useRef(null);
  useEffect(() => {
    const element = video.current;
    track.attach(element);
    return () => {
      track.detach(element);
      element.srcObject = null;
    };
  }, [track]);
  return <video ref={video} className={local ? 'call-local-video' : 'call-remote-video'}
    autoPlay playsInline muted aria-label={label} />;
}

export function VideoStage({ localVideo, remoteVideos = [] }) {
  const remote = remoteVideos[0];
  return <div className="call-video-stage">
    {remote && <ParticipantVideo key={remote.identity} track={remote.track} label={remote.name || 'Видео собеседника'} />}
    {localVideo && <ParticipantVideo track={localVideo} local label="Ваша камера" />}
  </div>;
}
