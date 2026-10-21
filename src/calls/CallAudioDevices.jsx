function DeviceOptions({ devices, selected, fallback }) {
  const listed = devices.filter((device) => device.deviceId && device.deviceId !== 'default');
  return <>
    <option value="default">По умолчанию</option>
    {selected !== 'default' && !listed.some((device) => device.deviceId === selected) &&
      <option value={selected}>Выбранное устройство</option>}
    {listed.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${fallback} ${index + 1}`}</option>)}
  </>;
}

export function CallAudioDevices({ calls }) {
  return <details className="call-audio-devices" onToggle={(event) => {
    if (event.currentTarget.open) calls.refreshDevices();
  }}>
    <summary>Звук и устройства</summary>
    <div className="call-audio-device-fields">
      <label>Микрофон<select value={calls.microphoneDeviceId || 'default'}
        disabled={!calls.devicesReady || calls.audioDeviceBusy}
        onChange={(event) => calls.switchAudioDevice('audioinput', event.target.value)}>
        <DeviceOptions devices={calls.audioInputs || []} selected={calls.microphoneDeviceId || 'default'} fallback="Микрофон" />
      </select></label>
      <label>Наушники / динамики<select value={calls.speakerDeviceId || 'default'}
        disabled={!calls.devicesReady || calls.audioDeviceBusy || !calls.canSelectAudioOutput}
        onChange={(event) => calls.switchAudioDevice('audiooutput', event.target.value)}>
        <DeviceOptions devices={calls.audioOutputs || []} selected={calls.speakerDeviceId || 'default'} fallback="Устройство вывода" />
      </select></label>
    </div>
    {calls.canChooseAudioOutput && calls.canSelectAudioOutput && <button className="call-device-choose" type="button"
      disabled={calls.audioDeviceBusy} onClick={calls.chooseAudioOutput}>Выбрать устройство вывода…</button>}
    {calls.devicesReady && !calls.canSelectAudioOutput && <p>В этом браузере наушники и динамики выбираются в настройках устройства.</p>}
    {calls.deviceError && <p role="status">{calls.deviceError}</p>}
  </details>;
}
