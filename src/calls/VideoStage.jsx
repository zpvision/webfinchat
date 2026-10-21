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
    autoPlay playsInline muted controls={false} disablePictureInPicture disableRemotePlayback
    controlsList="nodownload nofullscreen noremoteplayback" aria-label={label} />;
}

function ParticipantTile({ participant, participantNames = {} }) {
  const name = participant.local ? 'Вы' : participantNames[participant.identity.split(':')[0]] || participant.name || 'Участник';
  const initials = name.trim().split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0]).join('').toUpperCase();
  return <div className={`call-participant-tile ${participant.speaking ? 'is-speaking' : ''}`}>
    {participant.track ? <ParticipantVideo track={participant.track} local={participant.local} label={name} />
      : <div className="call-participant-avatar" aria-label={`${name}: камера выключена`}>{initials}</div>}
    <span className="call-participant-name">{name}{participant.microphoneMuted ? ' · Без микрофона' : ''}</span>
  </div>;
}

export function VideoStage({ localVideo, remoteVideos = [], group = false, participants = [], minimized = false,
  participantNames, microphoneMuted = false }) {
  if (group) {
    const local = { identity: 'local', local: true, track: localVideo, microphoneMuted };
    const tiles = minimized ? [participants.find((participant) => participant.speaking) || participants[0] || local]
      : [...participants, local];
    return <div className={`call-video-stage call-group-grid ${tiles.length === 1 ? 'call-group-grid-single' : ''}`}>
      {tiles.map((participant) => <ParticipantTile key={participant.identity} participant={participant} participantNames={participantNames} />)}
    </div>;
  }
  const remote = remoteVideos[0];
  return <div className={`call-video-stage ${remote ? '' : 'call-video-stage-local-only'}`}>
    {remote && <ParticipantVideo key={remote.identity} track={remote.track} label={remote.name || 'Видео собеседника'} />}
    {localVideo && <ParticipantVideo track={localVideo} local label="Ваша камера" />}
  </div>;
}
