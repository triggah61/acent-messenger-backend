const {
  createWallet,
  sendTransaction,
  walletInformation,
  getTransactionHistory,
  getTransactionDetails,
  estimateTransactionFee,
  getBitcoinPrice,
  validateAddress,
  getWalletStatistics,
} = require("../../../controller/WalletController");
const Authenticated = require("../../../middleware/Authenticated");
const walletRouter = require("express").Router();
require("express-group-routes");
walletRouter.group("/wallet", (wallet) => {
  wallet.use(Authenticated);
  wallet.post("/createWallet", createWallet);
  wallet.get("/walletInformation", walletInformation);
  wallet.post("/sendTransaction", sendTransaction);
  wallet.get("/getTransactionHistory", getTransactionHistory);
  wallet.get("/getTransactionDetails", getTransactionDetails);
  wallet.post("/estimateTransactionFee", estimateTransactionFee);
  wallet.get("/getBitcoinPrice", getBitcoinPrice);
  wallet.get("/validateAddress", validateAddress);
  wallet.get("/getWalletStatistics", getWalletStatistics);
});

module.exports = walletRouter;
