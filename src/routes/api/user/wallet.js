const {
  createWallet,
  sendTransaction,
  walletInformation,
} = require("../../../controller/WalletController");
const Authenticated = require("../../../middleware/Authenticated");
const walletRouter = require("express").Router();
require("express-group-routes");
walletRouter.group("/wallet", (wallet) => {
  wallet.use(Authenticated);
  wallet.post("/createWallet", createWallet);
  wallet.get("/walletInformation", walletInformation);
  wallet.post("/sendTransaction", sendTransaction);
});

module.exports = walletRouter;
