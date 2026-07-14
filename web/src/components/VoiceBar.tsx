import { useStore } from '../store';
import { joinVoice, leaveVoice, toggleMute, voiceSupported } from '../voice';

export function VoiceBar(): JSX.Element {
  const voiceJoined = useStore((s) => s.voiceJoined);
  const voiceMuted = useStore((s) => s.voiceMuted);
  const voicePeers = useStore((s) => s.voicePeers);

  if (!voiceSupported()) {
    return (
      <div className="voice-bar voice-unsupported" title="通过 HTTPS 或 localhost 访问可启用语音">
        🔇 语音需 HTTPS/localhost
      </div>
    );
  }

  return (
    <div className="voice-bar">
      {!voiceJoined ? (
        <button className="btn btn-sm btn-voice" onClick={() => void joinVoice()}>
          🎙️ 加入语音
        </button>
      ) : (
        <>
          <button className="btn btn-sm btn-voice" onClick={toggleMute}>
            {voiceMuted ? '🔇 已静音' : '🎙️ 麦克风开'}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={leaveVoice}>
            退出语音
          </button>
        </>
      )}
      <span className="voice-count">{voicePeers.length > 0 ? `${voicePeers.length} 人语音中` : ''}</span>
    </div>
  );
}
