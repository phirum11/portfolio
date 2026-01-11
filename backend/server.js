const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const hpp = require('hpp');

const app = express();
const PORT = process.env.PORT || 3000;

// =====================
// Security Configuration
// =====================

// Helmet - Secure HTTP headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://fonts.googleapis.com',
          'https://cdn.jsdelivr.net'
        ],
        fontSrc: [
          "'self'",
          'https://fonts.gstatic.com',
          'https://cdn.jsdelivr.net'
        ],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'https://telegram-proxy.ponphirum.workers.dev']
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

// Rate limiting - Prevent DDoS and brute force
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: {
    success: false,
    error: 'Too many requests. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 contact submissions per hour
  message: {
    success: false,
    error: 'Too many messages sent. Please try again in an hour.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Apply general rate limit to all requests
app.use(generalLimiter);

// Prevent HTTP Parameter Pollution
app.use(hpp());

// =====================
// Input Sanitization
// =====================

// Sanitize input to prevent XSS and injection
function sanitizeInput(str) {
  if (!str) return '';
  return str
    .toString()
    .trim()
    .slice(0, 1000) // Limit length
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/[<>\"\'`;(){}]/g, '') // Remove dangerous characters
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, '') // Remove event handlers like onclick=
    .replace(/data:/gi, ''); // Remove data: protocol
}

// Validate email format
function isValidEmail(email) {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email) && email.length <= 254;
}

// Check for spam patterns
function isSpam(data) {
  const spamPatterns = [
    /\b(viagra|casino|lottery|winner|prize|click here|buy now)\b/i,
    /(http[s]?:\/\/){2,}/i, // Multiple URLs
    /(.)\1{10,}/i // Repeated characters
  ];

  const content = `${data.name} ${data.subject} ${data.message}`;
  return spamPatterns.some((pattern) => pattern.test(content));
}

// =====================
// Telegram Bot Config
// =====================
// Set your Telegram bot token and chat ID here or via environment variables
const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || 'YOUR_CHAT_ID_HERE';
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

// Send message to Telegram with retry on network error
async function sendToTelegram(messageData, retries = 3) {
  const text =
    `📬 *New Contact Message*\n\n` +
    `👤 *Name:* ${escapeMarkdown(messageData.name)}\n` +
    `📧 *Email:* ${escapeMarkdown(messageData.email)}\n` +
    `📝 *Subject:* ${escapeMarkdown(messageData.subject)}\n\n` +
    `💬 *Message:*\n${escapeMarkdown(messageData.message)}\n\n` +
    `🕐 *Time:* ${messageData.timestamp}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(TELEGRAM_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: text,
          parse_mode: 'Markdown'
        }),
        signal: AbortSignal.timeout(10000) // 10 second timeout
      });

      const result = await response.json();

      if (result.ok) {
        console.log(`✅ Telegram notification sent successfully`);
        return { success: true };
      } else {
        console.error(`❌ Telegram API error: ${result.description}`);
        return { success: false, error: result.description };
      }
    } catch (error) {
      const isNetworkError =
        error.name === 'TypeError' ||
        error.name === 'AbortError' ||
        error.code === 'ENOTFOUND' ||
        error.code === 'ECONNREFUSED' ||
        error.code === 'ETIMEDOUT';

      console.error(
        `⚠️ Telegram attempt ${attempt}/${retries} failed:`,
        error.message
      );

      if (isNetworkError && attempt < retries) {
        // Wait before retry (exponential backoff: 1s, 2s, 4s...)
        const delay = Math.pow(2, attempt - 1) * 1000;
        console.log(`🔄 Retrying in ${delay / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else if (attempt === retries) {
        console.error(`❌ All ${retries} Telegram attempts failed`);
        return {
          success: false,
          error: `Network error after ${retries} attempts: ${error.message}`,
          isNetworkError: true
        };
      }
    }
  }
  return { success: false, error: 'Unknown error' };
}

// Escape special Markdown characters for Telegram
function escapeMarkdown(text) {
  if (!text) return '';
  return text.toString().replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

// Middleware
app.use(
  cors({
    origin: [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:5500',
      'http://127.0.0.1:5500'
    ],
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type']
  })
);
app.use(express.json({ limit: '10kb' })); // Limit body size
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Serve static files from portfolio root (parent directory)
app.use(express.static(path.join(__dirname, '..')));

// Path to store contact messages
const messagesFile = path.join(__dirname, 'data', 'messages.json');

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize messages file if it doesn't exist
if (!fs.existsSync(messagesFile)) {
  fs.writeFileSync(messagesFile, JSON.stringify([], null, 2));
}

// Helper to read messages
function readMessages() {
  try {
    const data = fs.readFileSync(messagesFile, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

// Helper to save messages
function saveMessages(messages) {
  fs.writeFileSync(messagesFile, JSON.stringify(messages, null, 2));
}

// =====================
// API Routes
// =====================

// POST /api/contact - Submit a contact form message (with rate limiting)
app.post('/api/contact', contactLimiter, async (req, res) => {
  try {
    // Sanitize all inputs
    const name = sanitizeInput(req.body.name);
    const email = sanitizeInput(req.body.email);
    const subject = sanitizeInput(req.body.subject);
    const message = sanitizeInput(req.body.message);

    // Basic validation
    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        error: 'Name, email, and message are required.'
      });
    }

    // Length validation
    if (name.length < 2 || name.length > 100) {
      return res.status(400).json({
        success: false,
        error: 'Name must be between 2 and 100 characters.'
      });
    }

    if (message.length < 10 || message.length > 1000) {
      return res.status(400).json({
        success: false,
        error: 'Message must be between 10 and 1000 characters.'
      });
    }

    // Email validation
    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a valid email address.'
      });
    }

    // Spam detection
    if (isSpam({ name, subject, message })) {
      console.log(`🚫 Spam detected from ${email}`);
      // Return success to not reveal detection (honeypot)
      return res.status(201).json({
        success: true,
        message: 'Thank you! Your message has been received.'
      });
    }

    const newMessage = {
      id: Date.now(),
      name,
      email,
      subject: subject || '(No subject)',
      message,
      timestamp: new Date().toISOString(),
      ip: req.ip || req.connection.remoteAddress,
      read: false,
      telegramSent: false
    };

    // Save message to local storage first (always works)
    const messages = readMessages();
    messages.push(newMessage);
    saveMessages(messages);

    console.log(`✅ New contact message from ${name} <${email}> [${req.ip}]`);

    // Try to send to Telegram (non-blocking for user response)
    let telegramResult = { success: false, error: 'Not configured' };

    if (
      TELEGRAM_BOT_TOKEN !== 'YOUR_BOT_TOKEN_HERE' &&
      TELEGRAM_CHAT_ID !== 'YOUR_CHAT_ID_HERE'
    ) {
      telegramResult = await sendToTelegram(newMessage);

      // Update message with telegram status
      const updatedMessages = readMessages();
      const msgIndex = updatedMessages.findIndex((m) => m.id === newMessage.id);
      if (msgIndex !== -1) {
        updatedMessages[msgIndex].telegramSent = telegramResult.success;
        updatedMessages[msgIndex].telegramError = telegramResult.error || null;
        saveMessages(updatedMessages);
      }
    }

    // Always respond success to user (message is saved locally)
    res.status(201).json({
      success: true,
      message: 'Thank you! Your message has been received.',
      telegramNotified: telegramResult.success
    });
  } catch (error) {
    console.error('❌ Contact form error:', error);
    res.status(500).json({
      success: false,
      error: 'An error occurred. Please try again.'
    });
  }
});

// GET /api/messages - List all messages (for admin/dev use)
app.get('/api/messages', (req, res) => {
  const messages = readMessages();
  res.json({
    success: true,
    count: messages.length,
    messages: messages.reverse() // newest first
  });
});

// POST /api/messages/:id/resend-telegram - Retry sending to Telegram
app.post('/api/messages/:id/resend-telegram', async (req, res) => {
  const messages = readMessages();
  const msgIndex = messages.findIndex((m) => m.id === parseInt(req.params.id));

  if (msgIndex === -1) {
    return res.status(404).json({
      success: false,
      error: 'Message not found'
    });
  }

  const message = messages[msgIndex];

  if (
    TELEGRAM_BOT_TOKEN === 'YOUR_BOT_TOKEN_HERE' ||
    TELEGRAM_CHAT_ID === 'YOUR_CHAT_ID_HERE'
  ) {
    return res.status(400).json({
      success: false,
      error: 'Telegram bot not configured'
    });
  }

  const telegramResult = await sendToTelegram(message);

  // Update message status
  messages[msgIndex].telegramSent = telegramResult.success;
  messages[msgIndex].telegramError = telegramResult.error || null;
  messages[msgIndex].telegramRetryAt = new Date().toISOString();
  saveMessages(messages);

  res.json({
    success: telegramResult.success,
    message: telegramResult.success
      ? 'Message sent to Telegram successfully'
      : `Failed to send: ${telegramResult.error}`
  });
});

// GET /api/messages/:id - Get a single message
app.get('/api/messages/:id', (req, res) => {
  const messages = readMessages();
  const message = messages.find((m) => m.id === parseInt(req.params.id));

  if (!message) {
    return res.status(404).json({
      success: false,
      error: 'Message not found'
    });
  }

  res.json({ success: true, message });
});

// DELETE /api/messages/:id - Delete a message
app.delete('/api/messages/:id', (req, res) => {
  let messages = readMessages();
  const index = messages.findIndex((m) => m.id === parseInt(req.params.id));

  if (index === -1) {
    return res.status(404).json({
      success: false,
      error: 'Message not found'
    });
  }

  messages.splice(index, 1);
  saveMessages(messages);

  res.json({ success: true, message: 'Message deleted' });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve index.html for root and any unmatched routes (SPA support)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`
  ╔════════════════════════════════════════════╗
  ║   Portfolio Backend Server Running         ║
  ╠════════════════════════════════════════════╣
  ║   Local:  http://localhost:${PORT}         ║
  ║   API:    http://localhost:${PORT}/api     ║
  ╚════════════════════════════════════════════╝
  `);
});
