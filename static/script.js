class VideoCallApp {
    constructor() {
        this.socket = null;
        this.localStream = null;
        this.peerConnection = null;
        this.userId = this.generateUserId();
        this.roomId = null;
        this.remoteUserId = null;
        
        this.localVideo = document.getElementById('localVideo');
        this.remoteVideo = document.getElementById('remoteVideo');
        this.roomIdInput = document.getElementById('roomId');
        this.joinRoomBtn = document.getElementById('joinRoom');
        this.startCallBtn = document.getElementById('startCall');
        this.endCallBtn = document.getElementById('endCall');
        this.statusText = document.getElementById('statusText');
        this.incomingCallModal = document.getElementById('incomingCallModal');
        this.answerCallBtn = document.getElementById('answerCall');
        this.declineCallBtn = document.getElementById('declineCall');
        this.callerInfo = document.getElementById('callerInfo');
        this.ringtone = document.getElementById('ringtone');
        
        this.isRinging = false;
        this.incomingOffer = null;
        this.pendingIceCandidates = [];
        
        this.setupEventListeners();
        
        this.pcConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };
    }
    
    generateUserId() {
        return 'user_' + Math.random().toString(36).substr(2, 9);
    }
    
    setupEventListeners() {
        this.joinRoomBtn.addEventListener('click', () => this.joinRoom());
        this.startCallBtn.addEventListener('click', () => this.startCall());
        this.endCallBtn.addEventListener('click', () => this.endCall());
        this.answerCallBtn.addEventListener('click', () => this.answerCall());
        this.declineCallBtn.addEventListener('click', () => this.declineCall());
    }
    
    updateStatus(message) {
        this.statusText.textContent = message;
        console.log(message);
    }
    
    async joinRoom() {
        this.roomId = this.roomIdInput.value.trim();
        if (!this.roomId) {
            this.updateStatus('Please enter a room ID');
            return;
        }
        
        try {
            this.updateStatus('Connecting to server...');
            
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const host = window.location.host;
            this.socket = new WebSocket(`${protocol}//${host}/ws/${this.userId}`);
            
            this.socket.onopen = () => {
                this.updateStatus('Connected to server');
                this.socket.send(JSON.stringify({
                    type: 'join_room',
                    room_id: this.roomId
                }));
                this.joinRoomBtn.disabled = true;
                this.startCallBtn.disabled = false;
            };
            
            this.socket.onmessage = (event) => {
                this.handleSignalingMessage(JSON.parse(event.data));
            };
            
            this.socket.onclose = () => {
                this.updateStatus('Disconnected from server');
                this.joinRoomBtn.disabled = false;
                this.startCallBtn.disabled = true;
                this.endCallBtn.disabled = true;
            };
            
            this.socket.onerror = (error) => {
                this.updateStatus('Connection error');
                console.error('WebSocket error:', error);
            };
            
        } catch (error) {
            this.updateStatus('Failed to connect to server');
            console.error('Connection error:', error);
        }
    }
    
    async handleSignalingMessage(message) {
        switch (message.type) {
            case 'user_joined':
                this.updateStatus(`User ${message.user_id} joined the room`);
                this.remoteUserId = message.user_id;
                break;
                
            case 'user_left':
                this.updateStatus(`User ${message.user_id} left the room`);
                if (message.user_id === this.remoteUserId) {
                    this.endCall();
                }
                break;
                
            case 'offer':
                await this.handleOffer(message);
                break;
                
            case 'answer':
                await this.handleAnswer(message);
                break;
                
            case 'ice_candidate':
                await this.handleIceCandidate(message);
                break;
                
            case 'call_request':
                this.handleIncomingCall(message);
                break;
                
            case 'call_accepted':
                await this.handleCallAccepted(message);
                break;
                
            case 'call_declined':
                this.handleCallDeclined(message);
                break;
        }
    }
    
    async startCall() {
        try {
            this.updateStatus('Starting call...');
            
            // Initialize media and peer connection first
            await this.initializePeerConnection();
            
            if (this.remoteUserId) {
                // Send call request
                this.socket.send(JSON.stringify({
                    type: 'call_request',
                    target_user_id: this.remoteUserId
                }));
                
                this.updateStatus('Calling...');
            } else {
                this.updateStatus('Waiting for someone to join...');
            }
            
            this.startCallBtn.disabled = true;
            this.endCallBtn.disabled = false;
            
        } catch (error) {
            this.updateStatus('Failed to start call');
            console.error('Error starting call:', error);
        }
    }
    
    handleIncomingCall(message) {
        this.remoteUserId = message.from_user_id;
        this.callerInfo.textContent = `User ${message.from_user_id} is calling...`;
        this.incomingCallModal.classList.remove('hidden');
        this.isRinging = true;
        this.ringtone.play().catch(e => console.log('Could not play ringtone:', e));
    }
    
    async answerCall() {
        this.isRinging = false;
        this.ringtone.pause();
        this.ringtone.currentTime = 0;
        this.incomingCallModal.classList.add('hidden');
        
        try {
            // Initialize media and peer connection FIRST
            await this.initializePeerConnection();
            
            // Then send call accepted signal
            this.socket.send(JSON.stringify({
                type: 'call_accepted',
                target_user_id: this.remoteUserId
            }));
            
            this.startCallBtn.disabled = true;
            this.endCallBtn.disabled = false;
            this.updateStatus('Call accepted, waiting for connection...');
        } catch (error) {
            this.updateStatus('Failed to initialize call');
            console.error('Error initializing call:', error);
        }
    }
    
    declineCall() {
        this.isRinging = false;
        this.ringtone.pause();
        this.ringtone.currentTime = 0;
        this.incomingCallModal.classList.add('hidden');
        
        this.socket.send(JSON.stringify({
            type: 'call_declined',
            target_user_id: this.remoteUserId
        }));
        
        this.updateStatus('Call declined');
        this.remoteUserId = null;
    }
    
    async handleCallAccepted(message) {
        try {
            this.updateStatus('Call accepted, establishing connection...');
            
            // Ensure we have peer connection with tracks
            if (!this.peerConnection) {
                console.error('Peer connection not ready for call acceptance');
                return;
            }
            
            // Create and send offer
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            
            console.log('Sending offer with', this.localStream.getTracks().length, 'tracks');
            
            this.socket.send(JSON.stringify({
                type: 'offer',
                offer: offer,
                target_user_id: this.remoteUserId
            }));
        } catch (error) {
            console.error('Error handling call accepted:', error);
            this.updateStatus('Error establishing connection');
        }
    }
    
    handleCallDeclined(message) {
        this.updateStatus('Call was declined');
        this.endCall();
    }
    
    async handleOffer(message) {
        try {
            // Ensure peer connection exists
            if (!this.peerConnection) {
                console.error('Peer connection not initialized when handling offer');
                this.updateStatus('Call setup error - please try again');
                return;
            }
            
            console.log('Setting remote description from offer');
            await this.peerConnection.setRemoteDescription(message.offer);
            
            // Process any buffered ICE candidates
            console.log('Processing', this.pendingIceCandidates.length, 'buffered ICE candidates');
            for (const candidate of this.pendingIceCandidates) {
                try {
                    await this.peerConnection.addIceCandidate(candidate);
                } catch (e) {
                    console.error('Error adding buffered ICE candidate:', e);
                }
            }
            this.pendingIceCandidates = [];
            
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            
            console.log('Sending answer');
            this.socket.send(JSON.stringify({
                type: 'answer',
                answer: answer,
                target_user_id: this.remoteUserId
            }));
            
            this.updateStatus('Connecting call...');
            
        } catch (error) {
            this.updateStatus('Error handling call offer');
            console.error('Error handling offer:', error);
        }
    }
    
    async handleAnswer(message) {
        try {
            console.log('Setting remote description from answer');
            await this.peerConnection.setRemoteDescription(message.answer);
            
            // Process any buffered ICE candidates
            console.log('Processing', this.pendingIceCandidates.length, 'buffered ICE candidates');
            for (const candidate of this.pendingIceCandidates) {
                try {
                    await this.peerConnection.addIceCandidate(candidate);
                } catch (e) {
                    console.error('Error adding buffered ICE candidate:', e);
                }
            }
            this.pendingIceCandidates = [];
            
            this.updateStatus('Call answer received, connecting...');
        } catch (error) {
            this.updateStatus('Error handling call answer');
            console.error('Error handling answer:', error);
        }
    }
    
    async handleIceCandidate(message) {
        try {
            if (this.peerConnection && this.peerConnection.remoteDescription) {
                await this.peerConnection.addIceCandidate(message.candidate);
                console.log('Added ICE candidate');
            } else {
                console.log('Buffering ICE candidate until remote description is set');
                this.pendingIceCandidates.push(message.candidate);
            }
        } catch (error) {
            console.error('Error handling ICE candidate:', error);
        }
    }
    
    async initializePeerConnection() {
        // Get user media
        this.localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        });
        
        this.localVideo.srcObject = this.localStream;
        
        // Create peer connection
        this.peerConnection = new RTCPeerConnection(this.pcConfig);
        
        // Set up event handlers
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate && this.remoteUserId) {
                this.socket.send(JSON.stringify({
                    type: 'ice_candidate',
                    candidate: event.candidate,
                    target_user_id: this.remoteUserId
                }));
            }
        };
        
        this.peerConnection.ontrack = (event) => {
            console.log('Remote track received:', event.streams[0]);
            this.remoteVideo.srcObject = event.streams[0];
            this.updateStatus('Call connected');
        };
        
        this.peerConnection.onconnectionstatechange = () => {
            console.log('Connection state:', this.peerConnection.connectionState);
            if (this.peerConnection.connectionState === 'connected') {
                this.updateStatus('Call connected successfully');
            } else if (this.peerConnection.connectionState === 'failed') {
                this.updateStatus('Connection failed - trying to reconnect...');
                this.restartIce();
            } else if (this.peerConnection.connectionState === 'disconnected') {
                this.updateStatus('Call disconnected');
            }
        };
        
        this.peerConnection.oniceconnectionstatechange = () => {
            console.log('ICE connection state:', this.peerConnection.iceConnectionState);
        };
        
        // Add local tracks to peer connection
        this.localStream.getTracks().forEach(track => {
            console.log('Adding local track:', track.kind);
            this.peerConnection.addTrack(track, this.localStream);
        });
        
        console.log('Peer connection initialized with', this.localStream.getTracks().length, 'tracks');
    }
    
    endCall() {
        this.updateStatus('Call ended');
        
        // Stop ringing if active
        if (this.isRinging) {
            this.isRinging = false;
            this.ringtone.pause();
            this.ringtone.currentTime = 0;
            this.incomingCallModal.classList.add('hidden');
        }
        
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
        
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        
        this.localVideo.srcObject = null;
        this.remoteVideo.srcObject = null;
        
        this.startCallBtn.disabled = false;
        this.endCallBtn.disabled = true;
        this.remoteUserId = null;
        this.pendingIceCandidates = [];
    }
    
    async restartIce() {
        try {
            if (this.peerConnection && this.peerConnection.connectionState !== 'closed') {
                console.log('Attempting ICE restart');
                const offer = await this.peerConnection.createOffer({ iceRestart: true });
                await this.peerConnection.setLocalDescription(offer);
                
                if (this.remoteUserId) {
                    this.socket.send(JSON.stringify({
                        type: 'offer',
                        offer: offer,
                        target_user_id: this.remoteUserId
                    }));
                }
            }
        } catch (error) {
            console.error('Error during ICE restart:', error);
        }
    }
}

const app = new VideoCallApp();