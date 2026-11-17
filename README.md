# SAnalysis

SAnalysis is a web-based market analysis and trading dashboard for Indian equities. It combines a React client, an Express API with a local SQLite database, and Python services for market data and technical analysis. Flattrade integration is optional; the application can also use its fallback market-data providers.

## Features

- Track symbols and view market quotes in the Dashboard.
- Run technical analysis and market scans with the Python service.
- Review positions and orders in Demo or Flattrade Live mode.
- Configure integrations and automated trading controls in the app.

## Project Structure

- `client/` — React 19 and Vite frontend.
- `server/` — Express API, Socket.IO live feed, and SQLite persistence.
- `pythonAPI/` — Python market-data, analysis, and Flattrade integration.

## Requirements

- Node.js and npm.
- Python 3 and pip.
- Flattrade credentials only if you intend to use its data or broker integration.

## Setup

Install the Node dependencies:

```bash
cd server
npm install
cd ../client
npm install
```

Install Python dependencies in a virtual environment:

```bash
cd ../pythonAPI
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

The server invokes `python3` from its environment. Activate this virtual environment in the terminal used to start the server so it can find the installed Python packages.

For Flattrade, create `pythonAPI/.env` from the template and fill in the required credentials:

```bash
cp .env.example .env
```

Run that command from `pythonAPI/`. See [the token setup guide](pythonAPI/token_generator/setup.md) for Flattrade authentication details. Keep credentials, session tokens, and TOTP secrets private; never commit them or paste them into support requests.

## Run Locally

Start the API server from one terminal. Activate the Python virtual environment first if you installed Python dependencies there:

```bash
cd server
npm run dev
```

Start the frontend from another terminal:

```bash
cd client
npm run dev
```

Open <http://localhost:5173>. The Vite development server proxies API and WebSocket requests to the server at `http://127.0.0.1:8090`. The SQLite database is initialized automatically by the server.

For a production-style local run, build the client with `cd client && npm run build`, then start the server with `cd server && npm start`. The server serves the built client from `client/dist`.

## Trading Safety

Demo mode uses simulated orders. Flattrade Live mode can submit real orders to a brokerage account. Confirm the selected mode and account before enabling or arming live execution. Live order endpoints also require the server's public IP to match the IP configured for the account.
