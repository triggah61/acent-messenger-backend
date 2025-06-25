const cron = require("node-cron");
const axios = require("axios");
const redisClient = require("../config/redis");
const redisConfig = require("../config/redis");

module.exports = cron.schedule(
  "* * * * *",
  async () => {
    console.log("MarketPriceCronjob");
    const response = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,binancecoin&vs_currencies=usd"
    );
    let data = response.data;

    let formattedData = {
      BTC: {
        USD: data?.bitcoin?.usd ?? 0,
      },
      ETH: {
        USD: data?.ethereum?.usd ?? 0,
      },
      BNB: {
        USD: data?.binancecoin?.usd ?? 0,
      },
    };
    const client = redisConfig.getClient();
    const key = "exchangeData";

    const cachedData = await client.set(key, JSON.stringify(formattedData));
    console.log("exchangeData", cachedData);
  },
  {
    scheduled: false,
    timezone: "UTC",
  }
);
