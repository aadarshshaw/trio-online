# Trio Online

A browser-based, private-room multiplayer implementation of **Trio**, built with React, Vite, Node.js and Socket.IO. This is a fan-made implementation and is not affiliated with the publisher.

## Features

- Private rooms with six-character invite codes
- 3–6 players in individual play
- Simple mode: collect any three trios, or the three 7s
- Spicy mode: collect two connected trios (numbers add to 7 or differ by 7), or the three 7s
- Team Simple and Team Spicy for exactly 4 or 6 players
- Server-authoritative dealing, reveals, turn order, trio collection and win checks
- Private hands: each browser receives only its own hand
- Responsive desktop/mobile layout

## Run locally

Requirements: Node.js 18+ and npm.

```bash
npm run install:all
npm run dev
```

Open http://localhost:5173 in multiple browser windows/devices. The game server listens on http://localhost:3001.

## Production

```bash
npm run install:all
npm run build
npm start
```

The frontend build is written to `client/dist`. Deploy the frontend and Socket.IO server separately. Set `VITE_SERVER_URL` in the frontend build environment to the public Socket.IO server URL. The server listens on `PORT` (defaults to 3001).

### Hosting layout

- **Frontend:** Vercel, with project root directory `client`, framework Vite, build command `npm run build`, output directory `dist`.
- **Multiplayer server:** a persistent Node.js host such as Render or Railway, using `server` as its root directory and `npm start` as its start command.

Set the server's allowed CORS origin to your deployed frontend domain before public use. Room state is currently held in memory, so restarting the server ends active games. This is suitable for casual private games, not durable tournament hosting.

## Rules

The deck has three copies of each number 1–12. On a turn, reveal cards from the middle or reveal only the lowest/highest remaining card in any player's hand. Continue while revealed values match; a mismatch ends the turn and returns the revealed cards. Three matching cards are collected as a trio.
