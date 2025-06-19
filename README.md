# Acent Messenger Backend - Community Edition

A comprehensive Node.js backend application for a modern messaging platform with integrated Bitcoin wallet functionality, real-time communication, and social features.

## 🚀 Project Overview

Acent Messenger Backend is a robust, scalable messaging platform built with Node.js and Express.js. It provides a complete backend solution for real-time messaging, Bitcoin wallet integration, user management, and social networking features.

### 🎯 Key Features

#### 🔐 Authentication & User Management
- JWT-based authentication
- OTP verification via SMS (Twilio integration)
- Email verification system
- User profile management with photo uploads
- Contact management system
- User status tracking (pending, activated, blocked, deleted)

#### 💬 Real-time Messaging
- Socket.io for real-time communication
- One-on-one and group chat sessions
- Message reactions (like, love, laugh, sad, angry, wow, cry)
- File attachments (images, videos, audio, documents, stickers, GIFs)
- Message status tracking (sent, delivered, seen, deleted)
- Reply to messages functionality
- Message deletion for specific users

#### 🪙 Bitcoin Wallet Integration
- Bitcoin wallet creation and management
- Transaction sending and receiving
- Transaction history tracking
- Bitcoin price fetching
- Address validation
- Transaction fee estimation
- UTXO management
- Wallet statistics

#### 📱 Social Features
- User posts with images/videos
- Story functionality
- Contact requests and management
- User blocking/unblocking
- Notification system

#### 🛠 Technical Features
- MongoDB database with Mongoose ODM
- Redis caching for improved performance
- AWS S3 integration for file storage
- Cron jobs for background tasks
- Winston logging system
- Rate limiting
- Email notifications (Nodemailer)
- Input validation and sanitization

## 🏗 Architecture

```
src/
├── config/          # Configuration files
│   ├── db.js       # MongoDB connection
│   ├── redis.js    # Redis configuration
│   ├── email.js    # Email service setup
│   ├── sms.js      # Twilio SMS integration
│   ├── socket.js   # Socket.io configuration
│   └── file.js     # AWS S3 file upload
├── controller/      # Route controllers
│   ├── admin/      # Admin-specific controllers
│   └── user/       # User-specific controllers
├── model/          # MongoDB schemas
├── routes/         # API route definitions
├── middleware/     # Custom middleware
├── services/       # Business logic services
├── validator/      # Input validation
├── exception/      # Error handling
├── cronJob/        # Scheduled tasks
├── events/         # Event handlers
├── utils/          # Utility functions
└── view/           # Email templates
```

## 📦 Dependencies

### Core Dependencies
- **express**: Web framework
- **mongoose**: MongoDB ODM
- **socket.io**: Real-time communication
- **redis**: Caching layer
- **jsonwebtoken**: JWT authentication
- **bcryptjs**: Password hashing

### Bitcoin Integration
- **bitcoinjs-lib**: Bitcoin operations
- **bip32**: HD wallet support
- **bip39**: Mnemonic phrase generation
- **ecpair**: Elliptic curve cryptography

### External Services
- **aws-sdk**: Amazon S3 integration
- **twilio**: SMS services
- **nodemailer**: Email services

### Utilities
- **multer**: File upload handling
- **moment**: Date manipulation
- **winston**: Logging
- **express-rate-limit**: Rate limiting
- **express-validator**: Input validation

## 🚀 Installation & Setup

### Prerequisites
- Node.js (v16 or higher)
- MongoDB (v4.4 or higher)
- Redis (v6 or higher)
- AWS S3 account (for file storage)
- Twilio account (for SMS)

### 1. Clone the Repository
```bash
git clone https://github.com/triggah61/acent-messenger-backend.git
cd acent-messenger-backend
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Configuration
Create a `.env` file in the root directory:

```env
# Application Configuration
APP_NAME=Acent Messenger
APP_URL=https://your-app-domain.com
NODE_ENV=dev
PORT=6000

# Database Configuration
MONGODB_URL=mongodb://localhost:27017/acent_messenger

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# JWT Configuration
JWT_SECRET=your_super_secret_jwt_key_minimum_32_characters_long
JWT_EXPIRES_IN=7d

# AWS S3 Configuration
AWS_S3_BUCKET=your-bucket-name
AWS_S3_ACCESS_KEY_ID=your-access-key
AWS_S3_SECRET_ACCESS_KEY=your-secret-key
AWS_S3_REGION=us-east-1
AWS_S3_PARENT_FOLDER=acent-messenger

# Twilio SMS Configuration
TWILIO_ACCOUNT_SID=your-twilio-account-sid
TWILIO_AUTH_TOKEN=your-twilio-auth-token
TWILIO_PHONE_NUMBER=your-twilio-phone-number

# Email Configuration (SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM_EMAIL=your-email@gmail.com

# Scheduler Configuration
RUN_SCHEDULER=yes


BITCOIN_NETWORK=testnet #testnet,mainnet
ADMIN_WALLET_ADDRESS=
PLATFORM_FEE_PERCENTAGE=0.01 #1%
WALLET_ENCRYPTION_KEY=

# QuickNode Bitcoin Endpoints
QUICKNODE_BITCOIN_MAINNET_ENDPOINT=https://your-mainnet-endpoint.btc.quiknode.pro/YOUR_API_KEY/
QUICKNODE_BITCOIN_TESTNET_ENDPOINT=your-testnet-endpoint.btc.quiknode.pro/07ceddd37b4cea3946fc8622d4b2d617719a3e56/
```

### 4. Database Setup
Ensure MongoDB is running:
```bash
# On macOS with Homebrew
brew services start mongodb-community

# On Ubuntu/Debian
sudo systemctl start mongod

# On Windows
net start MongoDB
```

### 5. Redis Setup

#### On macOS (Homebrew)
```bash
brew install redis
brew services start redis
```

#### On Ubuntu/Debian
```bash
sudo apt update
sudo apt install redis-server
sudo systemctl start redis-server
sudo systemctl enable redis-server
```

#### On CentOS/RHEL
```bash
sudo yum install epel-release
sudo yum install redis
sudo systemctl start redis
sudo systemctl enable redis
```

#### On Windows
1. Download Redis from https://redis.io/download
2. Install and start the Redis service

#### Verify Redis Installation
```bash
redis-cli ping
# Should return: PONG
```

### 6. Start the Application

#### Development Mode
```bash
npm run dev
```

#### Production Mode
```bash
npm start
```

The server will start on `http://localhost:6000`


## 🚀 Production Deployment

### Using PM2 (Recommended)

#### 1. Install PM2
```bash
npm install -g pm2
```

#### 2. Create PM2 Ecosystem File
Create `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'acent-messenger',
    script: 'server.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 6000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
};
```

#### 3. Start with PM2
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### Nginx Reverse Proxy
Create `/etc/nginx/sites-available/acent-messenger`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:6000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /socket.io/ {
        proxy_pass http://localhost:6000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/acent-messenger /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## 🔧 Configuration

### MongoDB Configuration
- Default connection: `mongodb://localhost:27017/acent_messenger`
- Supports MongoDB Atlas for cloud deployment
- Automatic index creation for optimal performance

### Redis Configuration
- Used for caching user sessions and temporary data
- Improves application performance significantly
- Fallback mechanism if Redis is unavailable

### File Storage (AWS S3)
- All uploaded files stored in AWS S3
- Configurable bucket and folder structure
- Public read access for media files

### Bitcoin Network
- Testnet support for development
- Mainnet support for production
- Configurable via environment variables

## 📊 Monitoring & Logging

### Winston Logging
- Error logs written to `error.log`
- Console logging in development
- Structured JSON logging format

### Health Monitoring
- Database connection monitoring
- Redis connection status
- Bitcoin network connectivity

## 🔒 Security Features

- JWT token authentication
- Password hashing with bcrypt
- Rate limiting on API endpoints
- Input validation and sanitization
- CORS configuration
- Environment variable protection

## 🧪 Development

### Running Tests
```bash
npm test
```

### Code Linting
```bash
npm run lint
```

### Development with Nodemon
```bash
npm run dev
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the ISC License - see the [LICENSE](LICENSE) file for details.

## 🆘 Troubleshooting

### Common Issues

#### MongoDB Connection Issues
```bash
# Check MongoDB status
sudo systemctl status mongod

# Restart MongoDB
sudo systemctl restart mongod
```

#### Redis Connection Issues
```bash
# Check Redis status
redis-cli ping

# Restart Redis
sudo systemctl restart redis
```

#### Bitcoin Wallet Issues
- Ensure proper Bitcoin library versions
- Check network connectivity
- Verify API endpoints

#### File Upload Issues
- Verify AWS S3 credentials
- Check bucket permissions
- Ensure proper CORS configuration

### Logs Location
- Application logs: `error.log`
- PM2 logs: `~/.pm2/logs/`
- System logs: `/var/log/`

## 📞 Support

For support and questions:
- Create an issue on GitHub
- Check the [documentation](https://github.com/your-repo/acent-messenger-backend-community/wiki)
- Join our community discussions

## 🔮 Future Roadmap

- [ ] End-to-end encryption
- [ ] Multi-currency wallet support
- [ ] Voice and video calling
- [ ] Advanced analytics dashboard
- [ ] API documentation with Swagger
- [ ] Comprehensive test suite
- [ ] Performance optimization

---

**Built with ❤️ by the Acent Team**