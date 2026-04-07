import { io } from 'socket.io-client';
import { getPilotToken } from './Auth.js';

// 1. Use localhost when testing on your computer, use Railway when live on the internet
const SERVER_URL = window.location.hostname === 'localhost'  ? 'http://localhost:3000' : 'https://webgame-production-89be.up.railway.app';

export const socket = io(SERVER_URL);

// 2. Create a variable to hold the latest truth from the server
export let serverState = { players: {} };

// 3. Connection Events
socket.on('connect', () => {
  const token = getPilotToken();
  console.log('🔌 Connected to server! Pilot Token:', token);
  
  // Send our unique persistent token to the server
  socket.emit('authenticate', token);

  const statusEl = document.getElementById('server-status');
  if (statusEl) {
    statusEl.innerText = 'Connected as ' + token;
    statusEl.style.color = '#00ff00';
  }
});

socket.on('disconnect', () => {
  console.log('❌ Disconnected from server');
  const statusEl = document.getElementById('server-status');
  if (statusEl) {
    statusEl.innerText = 'Lost Connection...';
    statusEl.style.color = '#ff0000';
  }
});

// 4. The Data Receiver
// Every time the server pulses 'stateUpdate' (30 times a second), update our local variable
socket.on('stateUpdate', (newState) => {
  serverState = newState;
});