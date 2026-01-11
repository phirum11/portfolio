"""
Portfolio Contact Form Backend Server
Captures IP, Device, Country, and ISP information
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from user_agents import parse
import requests
import re
import os
import json
from datetime import datetime
from functools import lru_cache

app = Flask(__name__)
CORS(app, origins=['*'])

# Rate limiting
limiter = Limiter(
    key_func=get_remote_address,
    app=app,
    default_limits=["100 per 15 minutes"]
)

# Telegram config
TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '8596370334:AAHAw4a1Z8oyt8wxuANmasmpA8eaJsT4hlM')
TELEGRAM_CHAT_ID = os.getenv('TELEGRAM_CHAT_ID', '1926080459')

# Store messages locally
MESSAGES_FILE = 'data/messages.json'
os.makedirs('data', exist_ok=True)
if not os.path.exists(MESSAGES_FILE):
    with open(MESSAGES_FILE, 'w') as f:
        json.dump([], f)

# ======================
# IP Geolocation
# ======================

@lru_cache(maxsize=100)
def get_ip_info(ip: str) -> dict:
    """Get country, city, and ISP from IP address using free API"""
    try:
        # Use ip-api.com (free, no API key needed, 45 requests/minute)
        response = requests.get(
            f'http://ip-api.com/json/{ip}?fields=status,country,countryCode,regionName,city,isp,org,as,query',
            timeout=5
        )
        data = response.json()
        
        if data.get('status') == 'success':
            return {
                'ip': data.get('query', ip),
                'country': data.get('country', 'Unknown'),
                'country_code': data.get('countryCode', '??'),
                'region': data.get('regionName', 'Unknown'),
                'city': data.get('city', 'Unknown'),
                'isp': data.get('isp', 'Unknown'),
                'org': data.get('org', 'Unknown'),
                'as': data.get('as', 'Unknown')
            }
    except Exception as e:
        print(f"IP lookup error: {e}")
    
    return {
        'ip': ip,
        'country': 'Unknown',
        'country_code': '??',
        'region': 'Unknown',
        'city': 'Unknown',
        'isp': 'Unknown',
        'org': 'Unknown',
        'as': 'Unknown'
    }

def get_device_info(user_agent_string: str) -> dict:
    """Parse user agent to get device information"""
    try:
        ua = parse(user_agent_string)
        return {
            'browser': f"{ua.browser.family} {ua.browser.version_string}",
            'os': f"{ua.os.family} {ua.os.version_string}",
            'device': ua.device.family,
            'is_mobile': ua.is_mobile,
            'is_tablet': ua.is_tablet,
            'is_pc': ua.is_pc,
            'is_bot': ua.is_bot
        }
    except:
        return {
            'browser': 'Unknown',
            'os': 'Unknown',
            'device': 'Unknown',
            'is_mobile': False,
            'is_tablet': False,
            'is_pc': True,
            'is_bot': False
        }

def get_client_ip():
    """Get real client IP (handles proxies)"""
    # Check various headers for real IP
    headers_to_check = [
        'CF-Connecting-IP',      # Cloudflare
        'X-Real-IP',             # Nginx
        'X-Forwarded-For',       # Standard proxy
        'True-Client-IP',        # Akamai
    ]
    
    for header in headers_to_check:
        ip = request.headers.get(header)
        if ip:
            # X-Forwarded-For can contain multiple IPs, get the first one
            return ip.split(',')[0].strip()
    
    return request.remote_addr or '127.0.0.1'

# ======================
# Input Sanitization
# ======================

def sanitize_input(text: str, max_length: int = 1000) -> str:
    """Sanitize input to prevent XSS and injection"""
    if not text:
        return ''
    
    text = str(text).strip()[:max_length]
    
    # Remove HTML tags
    text = re.sub(r'<[^>]*>', '', text)
    
    # Remove dangerous characters
    text = re.sub(r'[<>\"\'`;(){}]', '', text)
    
    # Remove javascript: and data: protocols
    text = re.sub(r'javascript:', '', text, flags=re.IGNORECASE)
    text = re.sub(r'data:', '', text, flags=re.IGNORECASE)
    text = re.sub(r'on\w+=', '', text, flags=re.IGNORECASE)
    
    return text

def is_valid_email(email: str) -> bool:
    """Validate email format"""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email)) and len(email) <= 254

def is_spam(text: str) -> bool:
    """Check for spam patterns"""
    spam_patterns = [
        r'\b(viagra|casino|lottery|winner|prize|click here|buy now)\b',
        r'(http[s]?://){2,}',  # Multiple URLs
        r'(.)\1{10,}',  # Repeated characters
    ]
    for pattern in spam_patterns:
        if re.search(pattern, text, re.IGNORECASE):
            return True
    return False

# ======================
# Telegram Integration
# ======================

def send_to_telegram(message_data: dict, ip_info: dict, device_info: dict) -> bool:
    """Send contact message to Telegram with full details"""
    
    # Country flag emoji
    country_code = ip_info.get('country_code', '').upper()
    flag = ''.join(chr(0x1F1E6 + ord(c) - ord('A')) for c in country_code) if len(country_code) == 2 else '🌍'
    
    # Device emoji
    if device_info.get('is_mobile'):
        device_emoji = '📱'
    elif device_info.get('is_tablet'):
        device_emoji = '📲'
    else:
        device_emoji = '💻'
    
    text = f"""📬 *New Contact Message*

👤 *Name:* {message_data['name']}
📧 *Email:* {message_data['email']}
📝 *Subject:* {message_data['subject']}

💬 *Message:*
{message_data['message']}

━━━━━━━━━━━━━━━━━━━━
🌐 *Visitor Information*
━━━━━━━━━━━━━━━━━━━━

🔢 *IP:* `{ip_info['ip']}`
{flag} *Location:* {ip_info['city']}, {ip_info['region']}, {ip_info['country']}
🏢 *ISP:* {ip_info['isp']}
🏛 *Organization:* {ip_info['org']}

{device_emoji} *Device:* {device_info['device']}
🖥 *OS:* {device_info['os']}
🌐 *Browser:* {device_info['browser']}

🕐 *Time:* {message_data['timestamp']}"""

    try:
        response = requests.post(
            f'https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage',
            json={
                'chat_id': TELEGRAM_CHAT_ID,
                'text': text,
                'parse_mode': 'Markdown'
            },
            timeout=10
        )
        result = response.json()
        return result.get('ok', False)
    except Exception as e:
        print(f"Telegram error: {e}")
        return False

# ======================
# API Routes
# ======================

@app.route('/api/contact', methods=['POST', 'OPTIONS'])
@limiter.limit("5 per hour")
def contact():
    """Handle contact form submission"""
    
    # Handle CORS preflight
    if request.method == 'OPTIONS':
        return '', 204
    
    try:
        # Get form data (support both JSON and form-data)
        if request.is_json:
            data = request.get_json()
        else:
            data = request.form.to_dict()
        
        # Sanitize inputs
        name = sanitize_input(data.get('name', ''), 100)
        email = sanitize_input(data.get('email', ''), 254)
        subject = sanitize_input(data.get('subject', ''), 200)
        message = sanitize_input(data.get('message', ''), 1000)
        
        # Validation
        if not name or len(name) < 2:
            return jsonify({'success': False, 'error': 'Name is required (min 2 chars)'}), 400
        
        if not is_valid_email(email):
            return jsonify({'success': False, 'error': 'Valid email is required'}), 400
        
        if not message or len(message) < 10:
            return jsonify({'success': False, 'error': 'Message is required (min 10 chars)'}), 400
        
        # Spam check
        if is_spam(f"{name} {subject} {message}"):
            print(f"🚫 Spam detected from {email}")
            # Return success to not reveal detection
            return jsonify({'success': True, 'message': 'Message received'})
        
        # Get client information
        client_ip = get_client_ip()
        user_agent = request.headers.get('User-Agent', '')
        
        ip_info = get_ip_info(client_ip)
        device_info = get_device_info(user_agent)
        
        # Create message record
        message_data = {
            'id': int(datetime.now().timestamp() * 1000),
            'name': name,
            'email': email,
            'subject': subject or '(No subject)',
            'message': message,
            'timestamp': datetime.now().isoformat(),
            'ip_info': ip_info,
            'device_info': device_info
        }
        
        # Save to local storage
        try:
            with open(MESSAGES_FILE, 'r') as f:
                messages = json.load(f)
            messages.append(message_data)
            with open(MESSAGES_FILE, 'w') as f:
                json.dump(messages, f, indent=2)
        except Exception as e:
            print(f"Storage error: {e}")
        
        # Send to Telegram
        telegram_sent = send_to_telegram(message_data, ip_info, device_info)
        
        print(f"✅ New message from {name} <{email}> [{ip_info['country']}] via {device_info['browser']}")
        
        return jsonify({
            'success': True,
            'message': 'Thank you! Your message has been received.',
            'telegram_sent': telegram_sent
        }), 201
        
    except Exception as e:
        print(f"❌ Error: {e}")
        return jsonify({'success': False, 'error': 'An error occurred'}), 500

@app.route('/api/messages', methods=['GET'])
def get_messages():
    """Get all messages (admin endpoint)"""
    try:
        with open(MESSAGES_FILE, 'r') as f:
            messages = json.load(f)
        return jsonify({
            'success': True,
            'count': len(messages),
            'messages': list(reversed(messages))
        })
    except:
        return jsonify({'success': True, 'count': 0, 'messages': []})

@app.route('/api/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({'status': 'ok', 'timestamp': datetime.now().isoformat()})

@app.route('/api/ip-info', methods=['GET'])
def ip_info():
    """Get current visitor's IP information"""
    client_ip = get_client_ip()
    ip_data = get_ip_info(client_ip)
    device_data = get_device_info(request.headers.get('User-Agent', ''))
    
    return jsonify({
        'ip': ip_data,
        'device': device_data
    })

# ======================
# Run Server
# ======================

if __name__ == '__main__':
    print("""
    ╔════════════════════════════════════════════╗
    ║   Portfolio Backend (Python) Running       ║
    ╠════════════════════════════════════════════╣
    ║   Local:  http://localhost:5000            ║
    ║   API:    http://localhost:5000/api        ║
    ╚════════════════════════════════════════════╝
    """)
    app.run(host='0.0.0.0', port=5000, debug=True)
