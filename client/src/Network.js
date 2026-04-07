import { io } from 'socket.io-client';
import { getPilotToken } from './Auth.js';

// 1. Connect to the server. Set VITE_SERVER_URL in .env to override (e.g. for production).
const SERVER_URL = 'https://webgame-33ek.onrender.com'||'https://localhost:3000';
export const socket = io(SERVER_URL);
socket.on("connect", () => {
  console.log("🟢 SUCCESS! Connected to Railway Server with ID:", socket.id);
});

socket.on("connect_error", (err) => {
  console.log("🔴 CRITICAL: Failed to connect to server!");
  console.log("Error details:", err.message);
});
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