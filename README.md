# Messaging CRM MVP

Runnable WhatsApp-focused messaging CRM MVP with a React dashboard, Express API, MongoDB, Redis/BullMQ workers, Socket.IO updates, dev RBAC, audit logs, campaigns, and a mock WhatsApp adapter.

## Run locally

```bash
npm install --ignore-scripts
npm run dev
```

The app uses local defaults:

- Web: `http://localhost:5173`
- API: `http://localhost:4000`
- MongoDB: `mongodb://127.0.0.1:27017/messaging-crm`
- Redis: `redis://127.0.0.1:6379`

Seeded dev users are available in the dashboard switcher:

- `admin@local.crm`
- `manager@local.crm`
- `agent@local.crm`

## Mock webhook

```bash
curl -X POST http://localhost:4000/webhook/whatsapp \
  -H 'content-type: application/json' \
  -d '{
    "waMessageId": "wa-demo-001",
    "phone": "15551234567",
    "name": "Demo Lead",
    "text": "Hi, I am interested in pricing"
  }'
```

This creates or updates a lead, stores the inbound message, emits realtime dashboard events, and triggers the welcome automation through BullMQ.

## Checks

```bash
npm test
npm run lint --workspaces
npm run build
```

