import os
import asyncio
import ssl
import tempfile
import datetime
import ipaddress
from aiohttp import web
from aiohttp_session import setup, get_session, new_session
from aiohttp_session.cookie_storage import EncryptedCookieStorage
from cryptography.fernet import Fernet
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from aiortc import RTCPeerConnection, RTCSessionDescription, AudioStreamTrack
from aiortc.contrib.media import MediaRelay
import base64
import json
import threading
import time
import numpy as np
from av import AudioFrame
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))

class AudioMixerTrack(AudioStreamTrack):
    """
    An audio track that mixes multiple input tracks.
    This creates a custom mixed audio stream for each client.
    """
    kind = "audio"
    
    def __init__(self, sources=None, owner=None):
        super().__init__()
        self.sources = sources or {}  # {username: track}
        self.sample_rate = 48000
        self.samples_per_frame = 960  # 20ms at 48kHz
        self.time_base = self.sample_rate
        self.audio_samples = 0
        self.owner = owner  # Who this mixer belongs to
        self._stats = {
            'frames_sent': 0,
            'last_activity': None,
            'total_amplitude': 0
        }
        self._started = False
        print(f"[MIXER-{self.owner}] 🎛️ Mixer track created")
        
    def add_source(self, username, track):
        """Add an audio source to the mix"""
        print(f"[MIXER-{self.owner}] ➕ Adding source {username} to mixer")
        self.sources[username] = track
        
    def remove_source(self, username):
        """Remove an audio source from the mix"""
        if username in self.sources:
            print(f"[MIXER-{self.owner}] ➖ Removing source {username} from mixer")
            del self.sources[username]
            
    def get_stats(self):
        """Get mixer statistics"""
        return {
            'frames_sent': self._stats['frames_sent'],
            'sources': list(self.sources.keys()),
            'last_activity': self._stats['last_activity'],
            'avg_amplitude': float(self._stats['total_amplitude'] / max(1, self._stats['frames_sent'])),
            'started': self._started
        }
    
    def start(self):
        """Start the track"""
        self._started = True
        print(f"[MIXER-{self.owner}] ▶️ Mixer track started")
    
    def stop(self):
        """Stop the track"""
        self._started = False
        print(f"[MIXER-{self.owner}] ⏹️ Mixer track stopped")
            
    async def recv(self):
        if not self._started:
            print(f"[MIXER-{self.owner}] ⚠️ recv() called but track not started!")
        # Leeres Float-Buffer
        samples = np.zeros(self.samples_per_frame, dtype=np.float32)
        active_sources = 0
        errors = []

        if not self.sources:
            # Fallback-Testton
            t = np.arange(self.samples_per_frame) / self.sample_rate
            test_tone = 0.05 * np.sin(2 * np.pi * 440 * t)
            samples += test_tone
            active_sources = 1
            print(f"[MIXER-{self.owner}] 🎶 Fallback-Testton aktiv – keine Quellen.")

        for username, track in list(self.sources.items()):
            try:
                source_frame = await track.recv()

                # Richtiges Extrahieren des PCM
                arr = source_frame.to_ndarray()  # liefert shape=(channels, samples) oder (samples,) 
                # Mono-Flatten und Normierung auf [-1,1]
                if arr.ndim > 1:
                    source_float = arr.mean(axis=0).astype(np.float32)
                else:
                    source_float = arr.astype(np.float32)
                # Falls nicht Float32, normieren
                if source_float.dtype != np.float32:
                    # Wenn Int16, durch 32768 teilen
                    if source_float.dtype == np.int16:
                        source_float = source_float / 32768.0
                    else:
                        source_float = source_float / np.max(np.abs(source_float), initial=1.0)

                # Auf samples_per_frame trimmen oder up/down-sample
                if len(source_float) != self.samples_per_frame:
                    source_float = np.resize(source_float, self.samples_per_frame)

                samples += source_float
                active_sources += 1

            except Exception as e:
                err = f"{username}: {e}"
                if err not in errors:
                    errors.append(err)

        # Stats, Logging etc. unverändert …
        self._stats['frames_sent'] += 1
        self._stats['last_activity'] = time.time()
        amp = np.abs(samples).mean()
        self._stats['total_amplitude'] += amp

        if active_sources > 1:
            samples = samples / np.sqrt(active_sources)

        # Zurück nach Int16 für Transport
        samples_int16 = (samples * 32767).clip(-32768, 32767).astype(np.int16)

        # Frame neu bauen
        frame = AudioFrame(format='s16', layout='mono', samples=self.samples_per_frame)
        frame.pts = self.audio_samples
        frame.sample_rate = self.sample_rate
        frame.time_base = '1/' + str(self.sample_rate)
        frame.planes[0].update(samples_int16.tobytes())

        self.audio_samples += self.samples_per_frame
        return frame

class AudioRouter:
    def __init__(self):
        self.peers = {}  # {username: RTCPeerConnection}
        self.incoming_tracks = {}  # {username: track} - tracks FROM clients
        self.outgoing_tracks = {}  # {username: AudioMixerTrack} - mixed tracks TO clients
        self.audio_stats = {}  # {username: stats}
        self.routing_table = {}  # {username: [usernames]} - who can hear whom
        self.relay = MediaRelay()  # Keep relay for track subscription
        
    async def register(self, username, pc):
        print(f"[AUDIO_ROUTER] 📝 Registering user: {username}")
        
        # Clean up old connection if exists…
        if username in self.peers:
            old_pc = self.peers[username]
            if old_pc:
                await old_pc.close()
                print(f"[AUDIO_ROUTER] 🔄 Closed old connection for {username}")
        
        # Store PeerConnection
        self.peers[username] = pc
        
        # Hier wird der Mixer erzeugt und **sofort gestartet**
        mixer = AudioMixerTrack(owner=username)
        mixer.start()                      # ← neu: Track läuft ab sofort
        self.outgoing_tracks[username] = mixer
        
        # Initiales Routing (jeder hört jeden, inkl. sich selbst)
        self.routing_table[username] = [username]
        for other_username in self.peers:
            if other_username != username:
                self.routing_table[other_username].append(username)
                self.routing_table[username].append(other_username)
        
        # Stats initialisieren…
        self.audio_stats[username] = {
            'last_audio': None, 
            'packet_count': 0, 
            'last_frame_time': None,
            'is_talking': False
        }
        
        print(f"[AUDIO_ROUTER] ✅ User {username} registered. Total users: {len(self.peers)}")
        print(f"[AUDIO_ROUTER] 🔊 Routing table updated: {self.routing_table}")
        
        # Und alle Mixer updaten
        await self._update_all_mixers()

    
    async def add_incoming_track(self, username, track):
        """Handle incoming audio track from a client"""
        print(f"[AUDIO_ROUTER] 🎵 NEW INCOMING TRACK from {username}")
        
        # Store the incoming track
        self.incoming_tracks[username] = track
        
        # Monitor track for stats
        self._monitor_track_data(username, track)
        
        # Update all mixers to include this new source
        await self._update_all_mixers()
        
        print(f"[AUDIO_ROUTER] ✅ Incoming track from {username} added to routing system")
    
    async def _update_all_mixers(self):
        """Update all mixer tracks based on current routing table"""
        print(f"[AUDIO_ROUTER] 🔄 Updating all audio mixers...")
        
        for listener_username, mixer in self.outgoing_tracks.items():
            # Clear current sources
            mixer.sources.clear()
            
            # Add sources based on routing table
            sources_to_hear = self.routing_table.get(listener_username, [])
            
            for source_username in sources_to_hear:
                if source_username in self.incoming_tracks:
                    track = self.incoming_tracks[source_username]
                    # Use relay to subscribe to the track
                    relayed_track = self.relay.subscribe(track, buffered=False)
                    mixer.add_source(source_username, relayed_track)
                    print(f"[AUDIO_ROUTER] 🔊 {listener_username} will hear {source_username}")
        
        print(f"[AUDIO_ROUTER] ✅ All mixers updated")
    
    def set_routing(self, listener, sources):
        """Set who a specific user can hear"""
        if listener in self.routing_table:
            self.routing_table[listener] = sources
            print(f"[AUDIO_ROUTER] 🎯 Routing updated: {listener} -> {sources}")
            # Note: You'd need to call _update_all_mixers after this
    
    def _monitor_track_data(self, username, track):
        """Monitor track for actual audio data using asyncio task"""
        async def monitor_frames():
            print(f"[AUDIO_MONITOR] 🎧 Starting frame monitoring for {username}")
            frame_count = 0
            try:
                while True:
                    try:
                        frame = await track.recv()
                        frame_count += 1
                        current_time = time.time()
                        
                        if username in self.audio_stats:
                            self.audio_stats[username]['last_audio'] = current_time
                            self.audio_stats[username]['packet_count'] = frame_count
                            self.audio_stats[username]['last_frame_time'] = current_time
                        
                        if frame_count % 50 == 0:
                            print(f"[AUDIO_DATA] 🔊 {username}: {frame_count} audio frames received")
                            
                    except Exception as e:
                        if "track ended" in str(e).lower() or "track is closed" in str(e).lower():
                            print(f"[AUDIO_MONITOR] 📍 Track ended for {username}")
                            break
                        else:
                            print(f"[AUDIO_MONITOR] ⚠️ Frame receive error for {username}: {e}")
                            await asyncio.sleep(0.1)
                            
            except Exception as e:
                print(f"[AUDIO_MONITOR] ❌ Error monitoring {username}: {e}")
            finally:
                print(f"[AUDIO_MONITOR] 🛑 Frame monitoring stopped for {username}")
        
        asyncio.create_task(monitor_frames())
        print(f"[AUDIO_ROUTER] 🎧 Started async frame monitoring for {username}")
    
    async def unregister(self, username):
        print(f"[AUDIO_ROUTER] 🚪 Unregistering user: {username}")
        
        # Close peer connection
        if username in self.peers:
            pc = self.peers[username]
            if pc:
                try:
                    await pc.close()
                except Exception as e:
                    print(f"[AUDIO_ROUTER] ⚠️ Error closing connection: {e}")
            del self.peers[username]
        
        # Remove from tracks
        if username in self.incoming_tracks:
            del self.incoming_tracks[username]
        
        if username in self.outgoing_tracks:
            del self.outgoing_tracks[username]
        
        # Remove from routing table
        if username in self.routing_table:
            del self.routing_table[username]
        
        # Remove from other users' routing tables
        for other_username in self.routing_table:
            if username in self.routing_table[other_username]:
                self.routing_table[other_username].remove(username)
        
        # Remove stats
        if username in self.audio_stats:
            del self.audio_stats[username]
        
        # Update all mixers
        await self._update_all_mixers()
        
        print(f"[AUDIO_ROUTER] ✅ User {username} unregistered. Remaining users: {len(self.peers)}")
    
    def get_active_users(self):
        return list(self.peers.keys())
    
    def get_audio_stats(self):
        stats = {}
        current_time = time.time()
        for username, stat in self.audio_stats.items():
            last_audio = stat['last_audio']
            stats[username] = {
                'packet_count': stat['packet_count'],
                'last_audio_ago': current_time - last_audio if last_audio else None,
                'has_recent_audio': (current_time - last_audio) < 5 if last_audio else False,
                'is_talking': stat.get('is_talking', False)
            }
        return stats

audio_router = AudioRouter()

async def index(request):
    session = await get_session(request)
    username = session.get('username')
    if username:
        content = """<!DOCTYPE html>
<html>
<head>
  <title>Audio Intercom with Mixing</title>
  <style>
    body { font-family: Arial; padding: 20px; background: #f5f5f5; }
    .container { max-width: 600px; margin: 0 auto; background: white; padding: 20px; border-radius: 10px; }
    button { padding: 15px 30px; font-size: 18px; margin: 10px; border: none; border-radius: 5px; cursor: pointer; }
    .connect-btn { background: #2196F3; color: white; }
    .talk-btn { background: #4CAF50; color: white; font-size: 24px; padding: 20px 40px; }
    .talk-btn.active { background: #ff4444; }
    .talk-btn:disabled { background: #ccc; }
    .status { margin: 15px 0; padding: 15px; background: #e8f4fd; border-radius: 5px; }
    .error { background: #ffebee; color: #c62828; }
    .success { background: #e8f5e8; color: #2e7d2e; }
    .users { margin: 20px 0; padding: 15px; background: #f9f9f9; border-radius: 5px; }
    .user-item { 
      display: flex; 
      align-items: center; 
      padding: 10px; 
      margin: 5px 0; 
      background: #fff; 
      border-radius: 5px; 
      border: 1px solid #ddd; 
    }
    .user-item.talking { background: #e8f5e8; border-color: #4CAF50; }
    .user-status { flex: 1; }
    .direct-talk-btn { 
      padding: 8px 16px; 
      font-size: 14px; 
      background: #FF9800; 
      color: white; 
      border: none; 
      border-radius: 5px; 
      cursor: pointer; 
    }
    .direct-talk-btn:disabled { background: #ccc; }
    .audio-debug { margin: 10px 0; padding: 10px; background: #fff3cd; border-radius: 5px; font-size: 12px; }
    .audio-meter { 
      height: 20px; 
      background: #e0e0e0; 
      border-radius: 10px; 
      margin: 10px 0; 
      overflow: hidden; 
    }
    .audio-meter-bar { 
      height: 100%; 
      background: #4CAF50; 
      width: 0%; 
      transition: width 0.1s; 
    }
  </style>
</head>
<body>
  <div class="container">
    <h2>🔊 Audio Intercom with Server Mixing</h2>
    
    <div style="text-align: center;">
      <button class="connect-btn" onclick="connect()">📡 Connect</button>
      <button class="connect-btn" onclick="playTestTone()" style="background: #FF9800;" disabled id="test-tone-btn">🔔 Test Tone</button>
      <br><br>
      <button class="talk-btn" 
              onmousedown="startTalking()" 
              onmouseup="stopTalking()"
              ontouchstart="startTalking()" 
              ontouchend="stopTalking()"
              disabled>
        🎤 Hold to Talk (All)
      </button>
    </div>
    
    <div id="status" class="status">Ready to connect...</div>
    
    <div class="users">
      <h3>Connected Users:</h3>
      <div id="users">No users connected</div>
    </div>
    
    <div class="audio-debug">
      <h4>Audio Debug:</h4>
      <div id="debug-info">No debug info</div>
      <div>
        <strong>Local Mic Level:</strong>
        <div class="audio-meter"><div id="local-meter" class="audio-meter-bar"></div></div>
      </div>
      <div>
        <strong>Remote Audio Level:</strong>
        <div class="audio-meter"><div id="remote-meter" class="audio-meter-bar"></div></div>
      </div>
      <button onclick="monitorAudio()" style="padding: 5px 10px; font-size: 12px;">Start Audio Monitor</button>
    </div>
  </div>
  
  <script>
    let pc = null;
    let localStream = null;
    let isTalking = false;
    let isConnected = false;
    let audioContext = null;
    let gainNode = null;
    let source = null;
    let currentUsers = [];
    let remoteAudio = null;
    let audioMonitorInterval = null;
    
    function updateStatus(message, type = 'info') {
      const statusDiv = document.getElementById('status');
      statusDiv.textContent = message;
      statusDiv.className = `status ${type}`;
      console.log(`STATUS: ${message}`);
    }
    
    function updateDebugInfo(info) {
      const debugDiv = document.getElementById('debug-info');
      const transceivers = pc ? pc.getTransceivers() : [];
      const receivingAudio = transceivers.filter(t => 
        t.receiver && t.receiver.track && t.receiver.track.kind === 'audio'
      ).length;
      
      debugDiv.innerHTML = `
        <div>Connection state: ${pc ? pc.connectionState : 'none'}</div>
        <div>ICE state: ${pc ? pc.iceConnectionState : 'none'}</div>
        <div>Transceivers: ${transceivers.length}</div>
        <div>Receiving audio tracks: ${receivingAudio}</div>
        <div>Audio context state: ${audioContext ? audioContext.state : 'none'}</div>
        <div>${info || ''}</div>
      `;
    }
    
    function updateUsers(users, current, stats = {}) {
      const usersDiv = document.getElementById('users');
      currentUsers = users;
      
      if (users.length === 0) {
        usersDiv.innerHTML = 'No users connected';
        return;
      }
      
      usersDiv.innerHTML = users.map(user => {
        const isMe = user === current;
        const userStats = stats[user] || {};
        const isTalking = userStats.has_recent_audio;
        
        return `
          <div class="user-item ${isTalking ? 'talking' : ''}">
            <div class="user-status">
              ${isMe ? '👤' : '🟢'} ${user}${isMe ? ' (You)' : ''}
              ${isTalking ? ' 🔊' : ''}
            </div>
            ${!isMe ? `<button class="direct-talk-btn" disabled>🎯 Direct Talk (Coming Soon)</button>` : ''}
          </div>
        `;
      }).join('');
    }
    
    async function loadUsers() {
      if (!isConnected) return;
      
      try {
        const response = await fetch('/users');
        if (response.ok) {
          const data = await response.json();
          updateUsers(data.users, data.current_user, data.stats || {});
        }
      } catch (error) {
        console.error('Error loading users:', error);
      }
    }
    
    async function connect() {
      try {
        updateStatus('Connecting...', 'info');
        console.log('Starting connection...');
        
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('getUserMedia not available. HTTPS required!');
        }
        
        // Track if we received any tracks
        let tracksReceived = 0;
        
        pc = new RTCPeerConnection({
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
          ]
        });
        
        console.log('RTCPeerConnection created');
        
        // Get microphone access
        localStream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 48000,
            channelCount: 1
          } 
        });
        
        console.log('Local audio stream obtained');
        
        // Create audio context for volume control
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        source = audioContext.createMediaStreamSource(localStream);
        gainNode = audioContext.createGain();
        
        // Start with gain at 0 (muted)
        gainNode.gain.value = 0;
        source.connect(gainNode);
        
        // Create a destination stream for WebRTC
        const destination = audioContext.createMediaStreamDestination();
        gainNode.connect(destination);
        
        // Add the processed audio track to peer connection
        const processedTrack = destination.stream.getAudioTracks()[0];
        pc.addTrack(processedTrack, destination.stream);
        console.log('Audio track added to peer connection');
        
        // Connection state handlers
        pc.oniceconnectionstatechange = () => {
          console.log(`ICE connection state: ${pc.iceConnectionState}`);
          updateDebugInfo(`ICE: ${pc.iceConnectionState}`);
          
          if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
            isConnected = true;
            document.querySelector('.talk-btn').disabled = false;
            document.getElementById('test-tone-btn').disabled = false;
            updateStatus('Connected! Ready to talk.', 'success');
            loadUsers();
            setInterval(loadUsers, 2000);
            
            // Check if we got tracks
            setTimeout(() => {
              if (tracksReceived === 0) {
                console.warn('⚠️ Connected but no tracks received!');
                updateDebugInfo('WARNING: No audio tracks received from server');
              }
            }, 2000);
          }
        };
        
        pc.onconnectionstatechange = () => {
          console.log(`Connection state: ${pc.connectionState}`);
          updateDebugInfo();
        };
        
        // Receive mixed audio from server
        pc.ontrack = (event) => {
            tracksReceived++;

            console.log('=== ONTRACK EVENT ===');
            console.log(`Track kind: ${event.track.kind}`);
            console.log(`Streams count: ${event.streams.length}`);
            
            if (event.track.kind === 'audio') {
                // aiortc liefert oft kein event.streams[0], 
                // also selbst einen MediaStream aus dem Track bauen
                const stream = event.streams.length > 0
                ? event.streams[0]
                : new MediaStream([event.track]);
                
                console.log('Audio track received, attaching stream…');
                
                // HTML5-Audio-Element anlegen und sofort abspielen
                const audio = document.createElement('audio');
                audio.srcObject = stream;
                audio.autoplay = true;
                audio.volume = 1.0;
                audio.controls = true; 
                document.body.appendChild(audio);

                remoteAudio = audio;
                
                // Direkt starten, oder auf User-Interaktion warten
                const playPromise = audio.play();
                if (playPromise !== undefined) {
                playPromise
                    .then(() => {
                    console.log('✅ Audio playback started successfully!');
                    updateDebugInfo('Receiving and playing mixed audio from server');
                    })
                    .catch(error => {
                    console.error('❌ Audio playback failed:', error);
                    updateDebugInfo('Audio blocked – click to enable');
                    document.addEventListener('click', async () => {
                        if (audioContext && audioContext.state === 'suspended') {
                        await audioContext.resume();
                        }
                        await audio.play();
                    }, { once: true });
                    });
                }
                
                // Track-Ereignisse
                event.track.onended   = () => console.log('Remote track ended');
                event.track.onmute    = () => console.log('Remote track muted');
                event.track.onunmute  = () => console.log('Remote track unmuted');
            }
        };


        
        // Create and send offer
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: false
        });
        await pc.setLocalDescription(offer);
        
        console.log('Offer created, sending to server...');
        
        const response = await fetch('/offer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            sdp: offer.sdp, 
            type: offer.type 
          })
        });
        
        if (!response.ok) {
          throw new Error(`Server error: ${response.status}`);
        }
        
        const answer = await response.json();
        console.log('Answer received from server');
        
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        console.log('Answer set as remote description');
        
        updateDebugInfo('WebRTC negotiation complete');
        
      } catch (error) {
        console.error('Connection error:', error);
        updateStatus(`Error: ${error.message}`, 'error');
      }
    }
    
    function startTalking() {
      if (!isConnected || isTalking) return;
      
      console.log('Started talking');
      isTalking = true;
      
      if (gainNode) {
        gainNode.gain.value = 1;
      }
      
      const btn = document.querySelector('.talk-btn');
      btn.classList.add('active');
      btn.textContent = '🔴 Talking...';
      
      updateStatus('🎤 Broadcasting to all users', 'success');
    }
    
    function stopTalking() {
      if (!isTalking) return;
      
      console.log('Stopped talking');
      isTalking = false;
      
      if (gainNode) {
        gainNode.gain.value = 0;
      }
      
      const btn = document.querySelector('.talk-btn');
      btn.classList.remove('active');
      btn.textContent = '🎤 Hold to Talk (All)';
      
      updateStatus('Connected! Ready to talk.', 'success');
    }
    
    async function playTestTone() {
      try {
        updateStatus('Requesting server test tone...', 'info');
        
        const response = await fetch('/test-tone', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        
        const result = await response.json();
        console.log('Test tone response:', result);
        
        if (result.status === 'success') {
          updateStatus('Test tone sent from server', 'success');
        }
        
      } catch (error) {
        console.error('Test tone error:', error);
        updateStatus(`Error: ${error.message}`, 'error');
      }
    }
    
    async function monitorAudio() {
      console.log('Starting audio monitoring...');
      
      // Monitor local microphone
      if (localStream && audioContext) {
        const analyser = audioContext.createAnalyser();
        source.connect(analyser);
        analyser.fftSize = 256;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        // Monitor remote audio
        let remoteAnalyser = null;
        if (remoteAudio && remoteAudio.srcObject) {
          const remoteSource = audioContext.createMediaStreamSource(remoteAudio.srcObject);
          remoteAnalyser = audioContext.createAnalyser();
          remoteSource.connect(remoteAnalyser);
          remoteAnalyser.fftSize = 256;
        }
        
        const updateMeters = () => {
          // Local mic level
          analyser.getByteFrequencyData(dataArray);
          const localLevel = dataArray.reduce((a, b) => a + b) / bufferLength / 255;
          document.getElementById('local-meter').style.width = (localLevel * 100) + '%';
          
          // Remote audio level
          if (remoteAnalyser) {
            remoteAnalyser.getByteFrequencyData(dataArray);
            const remoteLevel = dataArray.reduce((a, b) => a + b) / bufferLength / 255;
            document.getElementById('remote-meter').style.width = (remoteLevel * 100) + '%';
          }
        };
        
        // Update meters every 50ms
        if (audioMonitorInterval) clearInterval(audioMonitorInterval);
        audioMonitorInterval = setInterval(updateMeters, 50);
      }
      
      // Also fetch server-side stats
      try {
        const response = await fetch('/audio-monitor');
        if (response.ok) {
          const data = await response.json();
          console.log('Audio monitor data:', data);
          
          // Display mixer info
          const mixerInfo = data.mixers[data.user];
          if (mixerInfo) {
            console.log(`Mixer stats: ${mixerInfo.frames_sent} frames sent, sources: ${mixerInfo.sources.join(', ')}`);
          }
        }
      } catch (error) {
        console.error('Error fetching audio monitor:', error);
      }
    }
    
    console.log('Audio intercom client with server mixing initialized');
  </script>
</body>
</html>"""
        return web.Response(text=content, content_type='text/html')
    else:
        raise web.HTTPFound('/login')

async def login(request):
    if request.method == 'POST':
        data = await request.post()
        username = data.get('username')
        if username:
            session = await new_session(request)
            session['username'] = username
            raise web.HTTPFound('/')
        else:
            return web.Response(text="Please provide username", status=400)
    else:
        return web.Response(text="""
            <html>
            <body style="font-family: Arial; padding: 50px; background: #f5f5f5;">
                <div style="max-width: 400px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px;">
                    <h2>🔊 Audio Intercom Login</h2>
                    <form method="post">
                        <input name="username" placeholder="Your name" style="width: 100%; padding: 15px; margin: 10px 0; border: 1px solid #ddd; border-radius: 5px; font-size: 16px;" autofocus />
                        <button type="submit" style="width: 100%; padding: 15px; background: #4CAF50; color: white; border: none; border-radius: 5px; font-size: 16px;">Login</button>
                    </form>
                </div>
            </body>
            </html>
        """, content_type='text/html')

async def get_users(request):
    session = await get_session(request)
    username = session.get('username')
    if not username:
        return web.Response(status=401, text='Not logged in')
    
    active_users = audio_router.get_active_users()
    stats = audio_router.get_audio_stats()
    
    return web.json_response({
        'users': active_users,
        'current_user': username,
        'stats': stats
    })

async def test_tone(request):
    """Send a test tone through the mixing system"""
    session = await get_session(request)
    username = session.get('username')
    if not username:
        return web.Response(status=401, text='Not logged in')
    
    try:
        print(f"[TEST_TONE] 🔊 {username} requested test tone")
        
        # Create a test tone generator
        class ToneGenerator(AudioStreamTrack):
            kind = "audio"
            
            def __init__(self, duration=2.0):
                super().__init__()
                self.sample_rate = 48000
                self.samples_per_frame = 960
                self.duration = duration
                self.time = 0
                self.max_samples = int(duration * self.sample_rate)
                
            async def recv(self):
                if self.time >= self.max_samples:
                    raise Exception("Track ended")
                
                pts = self.time
                samples = min(self.samples_per_frame, self.max_samples - self.time)
                self.time += samples
                
                # Generate 440Hz sine wave
                t = np.arange(samples) / self.sample_rate
                frequency = 440
                audio_data = (np.sin(2 * np.pi * frequency * t) * 0.3 * 32767).astype(np.int16)
                
                frame = AudioFrame(samples, 'mono')
                frame.pts = pts
                frame.sample_rate = self.sample_rate
                frame.time_base = '1/' + str(self.sample_rate)
                frame.planes[0].update(audio_data.tobytes())
                
                return frame
        
        # Create tone generator
        tone_track = ToneGenerator(duration=1.0)
        
        # DIRECTLY add to the user's own mixer (bypass routing for testing)
        if username in audio_router.outgoing_tracks:
            mixer = audio_router.outgoing_tracks[username]
            # Use relay for proper subscription
            relayed_tone = audio_router.relay.subscribe(tone_track, buffered=False)
            mixer.add_source("__test_tone__", relayed_tone)
            print(f"[TEST_TONE] 🔊 Added test tone directly to {username}'s mixer")
            
            # Check mixer state
            stats = mixer.get_stats()
            print(f"[TEST_TONE] 📊 Mixer state: {stats['sources']} sources")
        
        # Remove after duration
        async def remove_tone():
            await asyncio.sleep(1.1)
            if username in audio_router.outgoing_tracks:
                audio_router.outgoing_tracks[username].remove_source("__test_tone__")
            print("[TEST_TONE] 🛑 Test tone removed from mixer")
        
        asyncio.create_task(remove_tone())
        
        return web.json_response({
            'status': 'success',
            'message': f'Test tone sent directly to {username}',
            'duration': '1 second'
        })
        
    except Exception as e:
        print(f"[TEST_TONE] ❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return web.json_response({
            'status': 'error',
            'message': str(e)
        }, status=500)

async def offer(request):
    session = await get_session(request)
    username = session.get('username')
    if not username:
        return web.Response(status=401, text='Not logged in')
    
    params = await request.json()
    offer = RTCSessionDescription(sdp=params["sdp"], type=params["type"])
    pc = RTCPeerConnection()
    
    print(f"[SERVER] 🤝 Creating WebRTC connection for {username}")
    
    @pc.on("connectionstatechange")
    async def on_connectionstatechange():
        print(f"[SERVER] 🔄 Connection state for {username}: {pc.connectionState}")
        
    @pc.on("iceconnectionstatechange")
    async def on_iceconnectionstatechange():
        print(f"[SERVER] 🧊 ICE connection state for {username}: {pc.iceConnectionState}")
        if pc.iceConnectionState in ("failed", "closed", "disconnected"):
            print(f"[SERVER] 🧹 Cleaning up connection for {username}")
            await audio_router.unregister(username)
    
    @pc.on("track")
    async def on_track(track):
        print(f"[SERVER] 🎵 INCOMING TRACK from {username}: {track.kind}")
        
        if track.kind == "audio":
            print(f"[SERVER] 🔊 AUDIO TRACK RECEIVED from {username}!")
            await audio_router.add_incoming_track(username, track)
        
        @track.on("ended")
        async def on_ended():
            print(f"[SERVER] 🛑 Track ended for {username}")
    
    # Register the peer connection first
    await audio_router.register(username, pc)
    
    # IMPORTANT: Set remote description BEFORE adding tracks
    await pc.setRemoteDescription(offer)
    print(f"[SERVER] 📥 Remote description set for {username}")
    
    # Add the mixed audio track that this user will hear
    if username in audio_router.outgoing_tracks:
        mixer_track = audio_router.outgoing_tracks[username]
        sender = pc.addTrack(mixer_track)
        print(f"[SERVER] 🎧 Added mixer track to {username}'s connection (sender: {sender})")
        
        # Log the current transceivers
        transceivers = pc.getTransceivers()
        print(f"[SERVER] 📡 {username} has {len(transceivers)} transceivers after adding mixer")
        for i, t in enumerate(transceivers):
            print(f"  Transceiver {i}: direction={t.direction}, sender_track={t.sender.track is not None}")
    
    # Create answer
    answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    print(f"[SERVER] 📤 Answer created for {username}")
    
    # Log answer details
    print(f"[SERVER] 📋 Answer SDP preview for {username}:")
    sdp_lines = answer.sdp.split('\n')
    audio_lines = [line for line in sdp_lines if 'audio' in line or 'm=audio' in line]
    for line in audio_lines[:5]:  # Show first 5 audio-related lines
        print(f"  {line}")
    
    return web.json_response({
        "sdp": pc.localDescription.sdp,
        "type": pc.localDescription.type
    })

async def get_debug_info(request):
    """Debug endpoint to check audio system state"""
    session = await get_session(request)
    username = session.get('username')
    if not username:
        return web.Response(status=401, text='Not logged in')
    
    debug_info = {
        'user': username,
        'peers': list(audio_router.peers.keys()),
        'incoming_tracks': list(audio_router.incoming_tracks.keys()),
        'outgoing_tracks': list(audio_router.outgoing_tracks.keys()),
        'routing_table': audio_router.routing_table,
        'mixer_sources': {}
    }
    
    # Check each mixer's sources
    for user, mixer in audio_router.outgoing_tracks.items():
        debug_info['mixer_sources'][user] = list(mixer.sources.keys())
    
    return web.json_response(debug_info)

async def get_audio_monitor(request):
    """Real-time audio monitoring endpoint"""
    session = await get_session(request)
    username = session.get('username')
    if not username:
        return web.Response(status=401, text='Not logged in')
    
    monitor_data = {
        'timestamp': time.time(),
        'user': username,
        'mixers': {},
        'incoming_audio': audio_router.get_audio_stats(),
        'peer_states': {}
    }
    
    # Get mixer stats
    for user, mixer in audio_router.outgoing_tracks.items():
        monitor_data['mixers'][user] = mixer.get_stats()
    
    # Get peer connection states
    for user, pc in audio_router.peers.items():
        monitor_data['peer_states'][user] = {
            'connection_state': pc.connectionState,
            'ice_state': pc.iceConnectionState,
            'transceivers': len(pc.getTransceivers())
        }
    
    return web.json_response(monitor_data)

def load_or_create_fernet_key(path="fernet.key"):
    if os.path.exists(path):
        with open(path, "r") as f:
            key_str = f.read().strip()
        key = base64.urlsafe_b64decode(key_str)
        print(f"[SERVER] 🔑 Loaded Fernet key from {path}")
    else:
        key = Fernet.generate_key()
        key_str = base64.urlsafe_b64encode(key).decode()
        with open(path, "w") as f:
            f.write(key_str)
        print(f"[SERVER] 🔑 Generated new Fernet key and saved to {path}")
    
    return key

def create_ssl_context():
    """Create self-signed SSL certificate for development"""
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )
    
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, u"localhost"),
    ])
    
    cert = x509.CertificateBuilder().subject_name(
        subject
    ).issuer_name(
        issuer
    ).public_key(
        private_key.public_key()
    ).serial_number(
        x509.random_serial_number()
    ).not_valid_before(
        datetime.datetime.utcnow()
    ).not_valid_after(
        datetime.datetime.utcnow() + datetime.timedelta(days=365)
    ).add_extension(
        x509.SubjectAlternativeName([
            x509.DNSName(u"localhost"),
            x509.IPAddress(ipaddress.IPv4Address(u"127.0.0.1")),
        ]),
        critical=False,
    ).sign(private_key, hashes.SHA256())
    
    cert_file = tempfile.NamedTemporaryFile(mode='wb', delete=False, suffix='.crt')
    key_file = tempfile.NamedTemporaryFile(mode='wb', delete=False, suffix='.key')
    
    cert_file.write(cert.public_bytes(serialization.Encoding.PEM))
    cert_file.close()
    
    key_file.write(private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    ))
    key_file.close()
    
    ssl_context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    ssl_context.load_cert_chain(cert_file.name, key_file.name)
    
    return ssl_context

def get_local_ip():
    import socket
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except:
        return "localhost"

def print_audio_stats():
    """Print audio statistics every 10 seconds"""
    while True:
        time.sleep(10)
        stats = audio_router.get_audio_stats()
        if stats:
            print(f"\n[AUDIO_STATS] 📊 Current Audio Statistics:")
            for username, stat in stats.items():
                recent = "✅" if stat['has_recent_audio'] else "❌"
                print(f"  {username}: {stat['packet_count']} packets {recent}")
            
            # Print routing table
            print(f"[AUDIO_STATS] 🎯 Current Routing:")
            for listener, sources in audio_router.routing_table.items():
                print(f"  {listener} hears: {sources}")
        else:
            print(f"[AUDIO_STATS] 📊 No active audio connections")

def main():
    app = web.Application()
    fernet_key = load_or_create_fernet_key()
    
    setup(app, EncryptedCookieStorage(fernet_key))
    
    app.router.add_get('/', index)
    app.router.add_get('/login', login)
    app.router.add_post('/login', login)
    app.router.add_post('/offer', offer)
    app.router.add_get('/users', get_users)
    app.router.add_post('/test-tone', test_tone)
    app.router.add_get('/debug', get_debug_info)
    app.router.add_get('/audio-monitor', get_audio_monitor)
    
    ssl_context = create_ssl_context()
    local_ip = get_local_ip()
    
    # Start audio stats thread
    stats_thread = threading.Thread(target=print_audio_stats, daemon=True)
    stats_thread.start()
    
    print("=== 🔊 AUDIO INTERCOM WITH SERVER-SIDE MIXING ===")
    print(f"Mac/Desktop: https://localhost:8443")
    print(f"iPhone/iPad: https://{local_ip}:8443")
    print("IMPORTANT: Accept the self-signed certificate!")
    print("")
    print("FEATURES:")
    print("- Server-side audio mixing")
    print("- Each client gets a custom mixed audio stream")
    print("- Ready for selective routing (coming next)")
    print("- Test tone goes through mixing system")
    print("==================================================")
    
    web.run_app(app, host='0.0.0.0', port=8443, ssl_context=ssl_context)

if __name__ == "__main__":
    main()