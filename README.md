"Low Poly Jet Mk.2" (https://skfb.ly/6ZrWs) by checkersai is licensed under Creative Commons Attribution (http://creativecommons.org/licenses/by/4.0/).
# Multiplayer Web Game

A full-stack multiplayer web application built with a Vite frontend and a Node.js/Express/Socket.io backend. 

Tech Stack
* **Frontend:** Vite, HTML/JS, Socket.io-client
* **Backend:** Node.js, Express, Socket.io
* **Deployment:** GitHub Pages (Frontend), Render (Backend)

Project Structure
This repository is a monorepo containing both the frontend and backend code in separate directories:
* `/client` - Contains the Vite frontend application.
* `/server` - Contains the Node.js backend server.

---

Local Development Setup

To run this game on your local machine, you will need to start both the backend server and the frontend development server.

### 1. Backend Setup
1. Open your terminal and navigate to the server folder:
   ```bash
   cd server
Install the required backend dependencies:

Bash
npm install
Start the server:

   ```bash
   npm start
```
You should see a message in the console: 🚀 Server is running on port 3000

2. Frontend Setup
Open a new terminal window and navigate to the client folder:

```bash
cd client
```
Install the required frontend dependencies:

```bash
npm install
```
Start the Vite development server:

```bash
npm run dev
```
Open the provided localhost link (usually http://localhost:5173) in your browser to view the game.

Deployment Guide
Backend (Render)
The backend is configured to be hosted on Render.

Create a new "Web Service" on Render and connect this repository.

Use the following settings:

Root Directory: ```server```

Environment: ```Node```

Build Command: ```npm install```

Start Command:``` npm start```

Once deployed, copy the Render URL and paste it into the frontend's network.js file:

JavaScript
export const socket = io('[https://your-render-url.onrender.com](https://your-render-url.onrender.com)');
Note: Render's free tier spins down the server after 15 minutes of inactivity. When you open the game after a period of rest, it may take 30-60 seconds for the backend to wake up and connect.

Frontend (GitHub Pages)
The frontend uses the gh-pages npm package to automatically build and deploy the Vite app.

Ensure your remote backend URL is correctly set in client/src/network.js.

Open your terminal and navigate to the client folder:

```bash
cd client
```
Run the deployment script:

```bash
npm run deploy
```
This command will automatically run vite build to compress your game, and then push the optimized /dist folder to the gh-pages branch, updating your live website.
