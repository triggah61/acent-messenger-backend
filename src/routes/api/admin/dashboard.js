const multerMiddleware = require("../../../config/multer");
const Authenticated = require("../../../middleware/Authenticated");
const DashboardController = require("../../../controller/admin/dashboard/DashboardController");

const dashboardRouter = require("express").Router();
require("express-group-routes");
dashboardRouter.group("/dashboard", (dashboard) => {
  dashboard.use(Authenticated);
  dashboard.get("/", DashboardController.getDashboard);
  dashboard.get("/latest-subscriptions", DashboardController.getLatestSubscriptions);
  dashboard.get("/monthly-earnings", DashboardController.getMonthlyEarnings);
});

module.exports = dashboardRouter;
