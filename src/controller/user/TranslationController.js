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

/**
 * Get Soniox configuration (API key)
 * Returns the Soniox API key from environment variables
 */
exports.getSonioxConfig = catchAsync(async (req, res) => {
  console.log('TranslationController: Soniox config request received');
  
  const sonioxApiKey = process.env.SONIOX_API_KEY;
  
  if (!sonioxApiKey) {
    console.error('TranslationController: ❌ SONIOX_API_KEY not configured in environment');
    throw new AppError("Soniox API key not configured on server", 500);
  }
  
  console.log('TranslationController: ✅ Soniox API key found');
  
  return res.status(200).json({
    message: "Soniox configuration retrieved successfully",
    data: {
      apiKey: sonioxApiKey,
    },
  });
});
