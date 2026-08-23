import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, Video, VideoOff, MonitorUp } from 'lucide-react';

const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];

export default function CallOverlay({ chat, me, socketRef, kind = 'video', initiator = true, initialSignal = null, onClose, showToast }) {
  const localRef = useRef(null);
  const peersRef = useRef(new Map());
  const streamsRef = useRef(new Map());
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState([]);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(kind === 'voice');
  const targets = (chat.members || []).map(x => x.id || x).filter(id => id !== me.id);

  function publishRemotes() { setRemoteStreams([...streamsRef.current.entries()].map(([id, stream]) => ({ id, stream }))); }

  async function ensurePeer(userId, stream) {
    if (peersRef.current.has(userId)) return peersRef.current.get(userId);
    const pc = new RTCPeerConnection({ iceServers: ICE });
    (stream || localStream)?.getTracks().forEach(track => pc.addTrack(track, stream || localStream));
    pc.onicecandidate = e => e.candidate && socketRef.current?.emit('webrtc-signal', { chatId: chat.id, targetUserId: userId, kind, signal: { type: 'candidate', candidate: e.candidate } });
    pc.ontrack = e => { streamsRef.current.set(userId, e.streams[0]); publishRemotes(); };
    pc.onconnectionstatechange = () => { if (['failed','closed','disconnected'].includes(pc.connectionState)) { streamsRef.current.delete(userId); publishRemotes(); } };
    peersRef.current.set(userId, pc);
    return pc;
  }

  useEffect(() => {
    let alive = true;
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: kind === 'video' });
        if (!alive) return stream.getTracks().forEach(t => t.stop());
        setLocalStream(stream); if (localRef.current) localRef.current.srcObject = stream;
        if (initiator) {
          for (const userId of targets) {
            const pc = await ensurePeer(userId, stream);
            const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
            socketRef.current?.emit('webrtc-signal', { chatId: chat.id, targetUserId: userId, kind, signal: { type: 'offer', sdp: offer } });
          }
        }
        if (initialSignal) handleSignal(initialSignal.fromUserId, initialSignal.signal, stream);
        socketRef.current?.emit('call-state', { chatId: chat.id, state: 'joined', kind });
      } catch { showToast('Camera/microphone permission is required for calls.'); onClose(); }
    }
    start();
    return () => { alive = false; peersRef.current.forEach(pc => pc.close()); peersRef.current.clear(); localStream?.getTracks().forEach(t => t.stop()); socketRef.current?.emit('call-state', { chatId: chat.id, state: 'left', kind }); };
  }, []);

  useEffect(() => {
    const socket = socketRef.current; if (!socket) return;
    const listener = payload => { if (payload.chatId === chat.id) handleSignal(payload.fromUserId, payload.signal, localStream); };
    socket.on('webrtc-signal', listener); return () => socket.off('webrtc-signal', listener);
  }, [chat.id, localStream]);

  async function handleSignal(fromUserId, signal, stream) {
    try {
      const pc = await ensurePeer(fromUserId, stream);
      if (signal.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
        socketRef.current?.emit('webrtc-signal', { chatId: chat.id, targetUserId: fromUserId, kind, signal: { type: 'answer', sdp: answer } });
      } else if (signal.type === 'answer') await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      else if (signal.type === 'candidate' && signal.candidate) await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
    } catch (err) { console.warn('WebRTC signal failed', err); }
  }

  function toggleMute() { localStream?.getAudioTracks().forEach(t => { t.enabled = muted; }); setMuted(!muted); }
  function toggleCamera() { localStream?.getVideoTracks().forEach(t => { t.enabled = cameraOff; }); setCameraOff(!cameraOff); }
  async function shareScreen() {
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = display.getVideoTracks()[0];
      for (const pc of peersRef.current.values()) { const sender = pc.getSenders().find(s => s.track?.kind === 'video'); if (sender) await sender.replaceTrack(track); }
      if (localRef.current) localRef.current.srcObject = display;
      track.onended = async () => { const camera = localStream?.getVideoTracks()[0]; for (const pc of peersRef.current.values()) { const sender = pc.getSenders().find(s => s.track?.kind === 'video'); if (sender && camera) await sender.replaceTrack(camera); } if (localRef.current) localRef.current.srcObject = localStream; };
    } catch { /* user cancelled */ }
  }

  return <div className="call-overlay">
    <div className="call-head"><div><strong>{kind === 'voice' ? 'Voice call' : 'Video call'}</strong><small>{chat.title || 'Private chat'} · WebRTC encrypted media</small></div><button className="danger-button" onClick={onClose}><PhoneOff size={18}/> End</button></div>
    <div className="video-grid">
      <video ref={localRef} autoPlay muted playsInline className="video-tile" />
      {remoteStreams.map(({ id, stream }) => <RemoteVideo key={id} stream={stream} />)}
      {remoteStreams.length === 0 && <div className="call-waiting">Waiting for others to join…</div>}
    </div>
    <div className="call-controls">
      <button className="round-control" onClick={toggleMute}>{muted ? <MicOff/> : <Mic/>}</button>
      {kind === 'video' && <button className="round-control" onClick={toggleCamera}>{cameraOff ? <VideoOff/> : <Video/>}</button>}
      <button className="round-control" onClick={shareScreen}><MonitorUp/></button>
      <button className="round-control danger" onClick={onClose}><PhoneOff/></button>
    </div>
  </div>;
}

function RemoteVideo({ stream }) {
  const ref = useRef(null); useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return <video ref={ref} autoPlay playsInline className="video-tile" />;
}
