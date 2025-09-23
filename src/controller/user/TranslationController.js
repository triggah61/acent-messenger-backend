const AppError = require("../../exception/AppError");
const catchAsync = require("../../exception/catchAsync");
const CallService = require("../../services/CallService");
const TranslationService = require("../../services/TranslationService");
const SimpleValidator = require("../../validator/simpleValidator");

exports.translate = catchAsync(async (req, res) => {
  const { user } = req;
  const { sourceLanguage, targetLanguage, content } = req.body;
  console.log('Translation request:', req.body);

  SimpleValidator(req.body, {
    sourceLanguage: "required|string",
    targetLanguage: "required|string",
    content: "required|string",
  });

  let translatedContent = await TranslationService.translateText(
    content,
    sourceLanguage,
    targetLanguage
  );

  return res.status(200).json({
    message: "Translated successfully",
    data: translatedContent,
  });
});
