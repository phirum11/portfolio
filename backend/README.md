# Portfolio Backend

A simple Node.js/Express backend for the portfolio website.

## Features

- Serves static portfolio files
- Contact form API with JSON file storage
- Message management endpoints
- CORS enabled for development

## Setup

```bash
cd backend
npm install
```

## Run

```bash
# Production
npm start

# Development (with auto-reload)
npm run dev
```

Server runs at **http://localhost:3000**

## API Endpoints

### Contact Form

**POST** `/api/contact`

Submit a contact message.

```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "subject": "Hello",
  "message": "Your message here..."
}
```

**Response:**

```json
{
  "success": true,
  "message": "Thank you! Your message has been received."
}
```

### Messages (Admin)

| Method | Endpoint            | Description        |
| ------ | ------------------- | ------------------ |
| GET    | `/api/messages`     | List all messages  |
| GET    | `/api/messages/:id` | Get single message |
| DELETE | `/api/messages/:id` | Delete a message   |

### Health Check

**GET** `/api/health`

Returns server status.

## Example Usage

```bash
# Submit a contact message
curl -X POST http://localhost:3000/api/contact \
  -H "Content-Type: application/json" \
  -d '{"name":"Jane","email":"jane@test.com","message":"Hi there!"}'

# List all messages
curl http://localhost:3000/api/messages
```

## File Structure

```
backend/
├── server.js        # Main server file
├── package.json     # Dependencies
├── README.md        # This file
└── data/
    └── messages.json  # Stored messages
```
