const redisConfig = require("../config/redis");

class CurrencyConverter {
  constructor() {}

  async getExchangeData() {
    const client = redisConfig.getClient();
    const key = "exchangeData";
    const cachedData = await client.get(key);
    return cachedData ? JSON.parse(cachedData) : {};
  }

  async getExchangeRate(currency) {
    const exchangeData = await this.getExchangeData();
    return exchangeData[currency.toUpperCase()]?.USD ?? 0;
  }

  async convertToUsd(amount, from) {
    const exchangeRate = await this.getExchangeRate(from);
    return amount * exchangeRate;
  }
}

module.exports = new CurrencyConverter();
