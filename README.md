# Bitcoin Wallet System - Acent Messenger Backend

A secure, production-ready Bitcoin wallet system built with Express.js, featuring hierarchical deterministic (HD) wallets, encrypted private key storage, and comprehensive transaction management.

## 🚀 Features

### Core Wallet Features
- **HD Wallet Support**: BIP44-compliant hierarchical deterministic wallets
- **Multi-Network**: Support for both Bitcoin mainnet and testnet
- **Secure Storage**: Private keys encrypted with AES-256-GCM
- **Mnemonic Support**: BIP39 mnemonic phrase generation and import
- **Real-time Balance**: Live balance updates from blockchain

### Transaction Management
- **Send/Receive**: Full Bitcoin transaction support
- **Fee Management**: Dynamic fee calculation with priority levels
- **Platform Fees**: Configurable platform fee collection
- **Transaction History**: Complete audit trail with pagination
- **Status Monitoring**: Real-time transaction confirmation tracking

### Security & Compliance
- **Rate Limiting**: Advanced rate limiting for all operations
- **Audit Logging**: Comprehensive logging of all sensitive operations
- **Suspicious Activity Detection**: AI-powered fraud detection
- **2FA Support**: Two-factor authentication for high-value transactions
- **Input Validation**: Strict validation and sanitization
- **Access Control**: User-based wallet isolation

### Developer Features
- **REST API**: Clean RESTful API design
- **Real-time Updates**: WebSocket support for live updates
- **Comprehensive Validation**: Input validation with express-validator
- **Error Handling**: Centralized error handling with detailed logging
- **Documentation**: Full API documentation

## 🛠 Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: MongoDB with Mongoose ODM
- **Blockchain**: bitcoinjs-lib, bip32, bip39
- **Security**: bcryptjs, crypto (Node.js built-in)
- **Validation**: express-validator
- **Rate Limiting**: express-rate-limit
- **Logging**: winston
- **Monitoring**: node-cron for transaction monitoring

## 📋 Prerequisites

- Node.js >= 16.0.0
- MongoDB >= 4.4
- npm or yarn package manager

## 🔧 Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-repo/acent-messenger-backend.git
   cd acent-messenger-backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Setup**
   ```bash
   cp .env.example .env
   ```

4. **Configure Environment Variables**
   Edit `.env` file with your configuration:
   ```env
   # Database
   MONGODB_URI=mongodb://localhost:27017/acent-messenger
   
   # Bitcoin Network (testnet for development, mainnet for production)
   BITCOIN_NETWORK=testnet
   
   # Platform Configuration
   PLATFORM_FEE_PERCENTAGE=0.005  # 0.5%
   ADMIN_WALLET_ADDRESS=your_admin_wallet_address
   
   # Security
   JWT_SECRET=your_super_secure_jwt_secret
   DAILY_TRANSACTION_LIMIT=100000000  # 1 BTC in satoshis
   HIGH_VALUE_2FA_THRESHOLD=20000000  # 0.2 BTC
   ```

5. **Start the Application**
   ```bash
   # Development
   npm run dev
   
   # Production
   npm start
   ```

## 🔐 Security Considerations

### Private Key Security
- Private keys are encrypted using AES-256-GCM with user-provided passwords
- Unique salt generated for each private key
- Keys are never stored in plaintext
- Memory is cleared after decryption operations

### Network Security
- Rate limiting on all endpoints
- IP-based and user-based rate limiting
- CORS configuration for web applications
- Helmet.js for security headers

### Transaction Security
- Multi-layer validation for all transactions
- Daily transaction limits
- Suspicious activity detection
- Optional 2FA for high-value transactions
- Comprehensive audit logging

### Best Practices Implemented
- Input sanitization and validation
- SQL injection prevention (NoSQL injection for MongoDB)
- XSS protection
- CSRF protection
- Secure session management

## 📖 API Documentation

### Authentication
All wallet endpoints require authentication. Include JWT token in Authorization header:
```
Authorization: Bearer <your_jwt_token>
```

### Wallet Endpoints

#### Create Wallet
```http
POST /api/wallet/create
Content-Type: application/json

{
  "password": "SecurePassword123!",
  "label": "My Main Wallet",
  "mnemonic": "optional 12-24 word mnemonic phrase"
}
```

#### Import Wallet
```http
POST /api/wallet/import
Content-Type: application/json

{
  "mnemonic": "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  "password": "SecurePassword123!",
  "label": "Imported Wallet"
}
```

#### Get Wallets
```http
GET /api/wallet/list
```

#### Get Wallet Balance
```http
GET /api/wallet/:walletId/balance
```

#### Send Transaction
```http
POST /api/wallet/send
Content-Type: application/json

{
  "walletId": "wallet_id_here",
  "toAddress": "recipient_bitcoin_address",
  "amount": 100000,
  "password": "wallet_password",
  "priority": "medium",
  "description": "Payment description"
}
```

#### Get Transaction History
```http
GET /api/wallet/:walletId/transactions?page=1&limit=10&type=withdrawal&status=confirmed
```

#### Estimate Transaction Fee
```http
POST /api/wallet/estimate-fee
Content-Type: application/json

{
  "walletId": "wallet_id_here",
  "amount": 100000,
  "priority": "medium"
}
```

### Response Format
All API responses follow this format:
```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": {
    // Response data here
  }
}
```

### Error Format
```json
{
  "success": false,
  "message": "Error description",
  "code": "ERROR_CODE",
  "details": {
    // Additional error details
  }
}
```

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `PORT` | Server port | `3000` | No |
| `NODE_ENV` | Environment mode | `development` | No |
| `JWT_SECRET` | JWT signing secret | | Yes |
| `JWT_EXPIRE` | JWT expiration time | `7d` | No |
| `MONGODB_URI` | MongoDB connection string | | Yes |
| `BITCOIN_NETWORK` | Bitcoin network (mainnet/testnet) | `testnet` | Yes |
| `QUICKNODE_BITCOIN_MAINNET_ENDPOINT` | QuickNode Bitcoin mainnet endpoint | | Yes |
| `QUICKNODE_BITCOIN_TESTNET_ENDPOINT` | QuickNode Bitcoin testnet endpoint | | Yes |
| `WALLET_ENCRYPTION_KEY` | Wallet encryption key | | Yes |
| `ADMIN_WALLET_ADDRESS` | Admin wallet for fee collection | | No |
| `PLATFORM_FEE_PERCENTAGE` | Platform fee (%) | `0.5` | No |
| `CUSTOM_FEE_RATE` | Custom fee rate (sat/byte) | `5` | No |

### Fee Configuration
- **Low Priority**: 1 satoshi/byte (~60-120 minutes)
- **Medium Priority**: 5 satoshis/byte (~10-30 minutes)
- **High Priority**: 10 satoshis/byte (~5-15 minutes)
- **Platform Fee**: 0.5% of transaction amount (configurable)

## 🚀 Deployment

### Docker Deployment
```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

### Production Checklist
- [ ] Set `BITCOIN_NETWORK=mainnet` for production
- [ ] Configure secure `JWT_SECRET`
- [ ] Set up MongoDB replica set
- [ ] Configure admin wallet address
- [ ] Set up monitoring and alerting
- [ ] Configure backup strategies
- [ ] Set up SSL/TLS certificates
- [ ] Configure firewall rules
- [ ] Set up log rotation

## 🔍 Monitoring

### Transaction Monitoring
The system includes automatic transaction monitoring:
- Runs every 2 minutes via cron job
- Checks pending transactions for confirmations
- Updates transaction status automatically
- Logs all monitoring activities

### Health Checks
Monitor these endpoints for system health:
- `/api/wallet/bitcoin-price` - Blockchain connectivity
- Database connection status
- Memory and CPU usage
- Transaction processing queue

## 🛡 Security Auditing

### Regular Security Tasks
1. **Update Dependencies**: Regular security updates
2. **Key Rotation**: Periodic JWT secret rotation
3. **Access Review**: Regular access control review
4. **Log Analysis**: Monitor for suspicious activities
5. **Backup Testing**: Regular backup and recovery testing

### Compliance Features
- Comprehensive audit logging
- Transaction traceability
- KYC/AML hooks (configurable)
- Regulatory reporting capabilities

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request

### Development Guidelines
- Follow ESLint configuration
- Write comprehensive tests
- Update documentation
- Follow security best practices
- Add proper error handling

## 📝 License

This project is licensed under the ISC License - see the LICENSE file for details.

## ⚠️ Disclaimer

This software is provided "as is" without warranty. Use at your own risk. Always test thoroughly on testnet before using with real Bitcoin. The developers are not responsible for any loss of funds.

## 🆘 Support

For support and questions:
- Create an issue in the GitHub repository
- Check the documentation
- Review the FAQ section

## 📚 Additional Resources

- [Bitcoin Developer Guide](https://developer.bitcoin.org/)
- [BIP39 Specification](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki)
- [BIP44 Specification](https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki)
- [BitcoinJS Library Documentation](https://github.com/bitcoinjs/bitcoinjs-lib)

### QuickNode Configuration

1. **Create QuickNode Account**: Sign up at [QuickNode](https://www.quicknode.com)
2. **Create Bitcoin Endpoints**: 
   - Create a Bitcoin **Mainnet** endpoint
   - Create a Bitcoin **Testnet** endpoint
   - **No add-ons required** - basic Bitcoin RPC is sufficient for transaction broadcasting
3. **Copy Endpoint URLs**: Save your endpoint URLs to environment variables:
   ```bash
   QUICKNODE_BITCOIN_MAINNET_ENDPOINT=https://your-mainnet-endpoint.btc.quiknode.pro/YOUR_API_KEY/
   QUICKNODE_BITCOIN_TESTNET_ENDPOINT=https://your-testnet-endpoint.btc-testnet.quiknode.pro/YOUR_API_KEY/
   ```

### Hybrid Architecture

This wallet service uses a **hybrid approach** for optimal cost and reliability:

- **QuickNode**: Used only for **transaction broadcasting** (`sendrawtransaction`)
- **Blockstream.info API**: Used for **balance queries** and **UTXO fetching** (free and reliable)
- **No expensive add-ons required**: Saves costs while maintaining full functionality

> **Cost Savings**: By using free blockchain explorer APIs for queries and QuickNode only for broadcasting, you avoid the expensive BTC Blockbook JSON-RPC add-on (typically $20-50/month extra).

---

**Built with ❤️ for secure Bitcoin transactions**