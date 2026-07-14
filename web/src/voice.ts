import type { VoicePeer } from '@draw-guess/shared';
import { socket } from './socket';
import { useStore } from './store';

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

let localStream: MediaStream | null = null;
const pcs = new Map<string, RTCPeerConnection>();
const pendingIce = new Map<string, RTCIceCandidateInit[]>();
const audios = new Map<string, HTMLAudioElement>();
let audioContainer: HTMLElement | null = null;

type SignalData =
  | { type: 'offer'; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; sdp: RTCSessionDescriptionInit }
  | { type: 'ice'; candidate: RTCIceCandidateInit };

const store = (): ReturnType<typeof useStore.getState> => useStore.getState();

export function voiceSupported(): boolean {
  return window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && 'RTCPeerConnection' in window;
}

export async function joinVoice(): Promise<void> {
  if (!voiceSupported()) {
    store().showToast('浏览器不支持语音(需 HTTPS 或 localhost 访问)');
    return;
  }
  if (localStream) return;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch {
    store().showToast('无法获取麦克风权限');
    return;
  }
  store().setVoiceJoined(true);
  store().setVoiceMuted(false);
  socket.emit('voice:join');
}

export function leaveVoice(): void {
  socket.emit('voice:leave');
  cleanupLocal();
}

export function toggleMute(): void {
  if (!localStream) return;
  const muted = !store().voiceMuted;
  for (const track of localStream.getAudioTracks()) track.enabled = !muted;
  store().setVoiceMuted(muted);
  socket.emit('voice:mute', { muted });
}

function cleanupLocal(): void {
  for (const id of [...pcs.keys()]) closePeer(id);
  if (localStream) {
    for (const track of localStream.getTracks()) track.stop();
    localStream = null;
  }
  store().setVoiceJoined(false);
  store().setVoiceMuted(false);
}

function closePeer(id: string): void {
  pcs.get(id)?.close();
  pcs.delete(id);
  pendingIce.delete(id);
  const el = audios.get(id);
  if (el) {
    el.srcObject = null;
    el.remove();
    audios.delete(id);
  }
}

function createPeer(id: string): RTCPeerConnection {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  pcs.set(id, pc);
  if (localStream) {
    for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
  }
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      sendSignal(id, { type: 'ice', candidate: e.candidate.toJSON() });
    }
  };
  pc.ontrack = (e) => {
    attachAudio(id, e.streams[0]);
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      closePeer(id);
    }
  };
  return pc;
}

function attachAudio(id: string, stream: MediaStream): void {
  if (!audioContainer) {
    audioContainer = document.createElement('div');
    audioContainer.style.display = 'none';
    document.body.appendChild(audioContainer);
  }
  let el = audios.get(id);
  if (!el) {
    el = document.createElement('audio');
    el.autoplay = true;
    el.setAttribute('playsinline', '');
    audioContainer.appendChild(el);
    audios.set(id, el);
  }
  el.srcObject = stream;
  void el.play().catch(() => {
    // 自动播放被拦截时,任意一次用户交互后重试
    const retry = (): void => {
      void el!.play().catch(() => {});
      document.removeEventListener('click', retry);
    };
    document.addEventListener('click', retry, { once: true });
  });
}

function sendSignal(to: string, data: SignalData): void {
  socket.emit('voice:signal', { to, data });
}

async function initiateOffer(id: string): Promise<void> {
  const pc = createPeer(id);
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal(id, { type: 'offer', sdp: offer });
  } catch {
    closePeer(id);
  }
}

async function handleSignal(from: string, data: SignalData): Promise<void> {
  if (!localStream) return; // 未加入语音,忽略
  try {
    if (data.type === 'offer') {
      // 收到 offer:作为应答方重建连接
      if (pcs.has(from)) closePeer(from);
      const pc = createPeer(from);
      await pc.setRemoteDescription(data.sdp);
      await flushIce(from, pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal(from, { type: 'answer', sdp: answer });
    } else if (data.type === 'answer') {
      const pc = pcs.get(from);
      if (!pc) return;
      await pc.setRemoteDescription(data.sdp);
      await flushIce(from, pc);
    } else if (data.type === 'ice') {
      const pc = pcs.get(from);
      if (pc && pc.remoteDescription) {
        await pc.addIceCandidate(data.candidate);
      } else {
        const list = pendingIce.get(from) ?? [];
        list.push(data.candidate);
        pendingIce.set(from, list);
      }
    }
  } catch (e) {
    console.warn('[voice] signal error', e);
  }
}

async function flushIce(id: string, pc: RTCPeerConnection): Promise<void> {
  const list = pendingIce.get(id) ?? [];
  pendingIce.delete(id);
  for (const c of list) {
    try {
      await pc.addIceCandidate(c);
    } catch {
      // 忽略过期 candidate
    }
  }
}

function syncPeers(peers: VoicePeer[]): void {
  const myId = store().playerId;
  const active = new Set(peers.map((p) => p.playerId));
  // 清理已退出语音的对端
  for (const id of [...pcs.keys()]) {
    if (!active.has(id)) closePeer(id);
  }
  if (!localStream || !active.has(myId)) return;
  // 双方都在语音中且尚未建连时,playerId 较小的一方主动发起,避免 glare
  for (const p of peers) {
    if (p.playerId === myId || pcs.has(p.playerId)) continue;
    if (myId < p.playerId) void initiateOffer(p.playerId);
  }
}

socket.on('voice:peers', ({ peers }) => {
  store().setVoicePeers(peers);
  syncPeers(peers);
});

socket.on('voice:signal', ({ from, data }) => {
  void handleSignal(from, data as SignalData);
});

socket.on('disconnect', () => {
  // 连接断开后服务端已将我们移出语音,本地一并清理
  cleanupLocal();
});
