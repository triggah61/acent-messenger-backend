const catchAsync = require("../exception/catchAsync");
/**
 * Require the Setting model from the '../model/Setting' module.
 * This model is used to interact with the database for setting configuration data.
 */
const Setting = require("../model/Setting");
const SimpleValidator = require("../validator/simpleValidator");

exports.getConfig = catchAsync(async (req, res) => {
  let data = {};

  let globalSettings = await Setting.find({}).select("name value -_id").lean();

  for (const setting of globalSettings) {
    data[setting.name] = setting.value;
  }

  // Add supported languages configuration
  data.supportedLanguages = [
    { code: 'en', name: 'English', nativeName: 'English' },
    { code: 'es', name: 'Spanish', nativeName: 'Español' },
    { code: 'fr', name: 'French', nativeName: 'Français' },
    { code: 'de', name: 'German', nativeName: 'Deutsch' },
    { code: 'it', name: 'Italian', nativeName: 'Italiano' },
    { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
    { code: 'ru', name: 'Russian', nativeName: 'Русский' },
    { code: 'zh', name: 'Chinese', nativeName: '中文' },
    { code: 'ja', name: 'Japanese', nativeName: '日本語' },
    { code: 'ko', name: 'Korean', nativeName: '한국어' },
    { code: 'bn', name: 'Bengali', nativeName: 'বাংলা' },
    { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
    { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
    { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu' }
  ];

  // Add TTS configuration
  data.ttsProvider = 'elevenlabs';
  data.elevenlabsApiKey = process.env.ELEVENLABS_API_KEY || '';
  data.elevenlabsBaseUrl = process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io/v1';
  data.ttsSettings = {
    defaultSpeed: 1.0,
    defaultPitch: 1.0,
    defaultStability: 0.5,
    defaultSimilarityBoost: 0.75,
  };

  // Add Google Speech-to-Text configuration for speaker diarization
  data.googleSttApiKey = process.env.GOOGLE_STT_API_KEY || '';
  data.googleSttEnabled = !!process.env.GOOGLE_STT_API_KEY;

  // Add AssemblyAI configuration for real-time transcription
  data.assemblyaiApiKey = process.env.ASSEMBLYAI_API_KEY || '';
  data.assemblyaiEnabled = !!process.env.ASSEMBLYAI_API_KEY;

  res.json({
    message: "Config fetched successfully",
    data,
  });
});

exports.setConfig = catchAsync(async (req, res) => {
  // Extract the records from the request body, default to an empty array if not provided
  const { records = [] } = req.body;

  // Validate that 'records' is provided and is an array
  SimpleValidator(req.body, { records: "required|array" });

  // Filter out records that do not have both 'variable' and 'value'
  const validRecords = records.filter((record) => record.name && record.value);

  // Update or insert each valid record in the database
  await Promise.all(
    validRecords.map(async ({ name, value }) => {
      await Setting.findOneAndUpdate(
        { name: name }, // Match the record by 'name'
        { name: name, value }, // Update 'name' and 'value'
        { upsert: true } // Insert a new record if no match is found
      );
    })
  );

  // Send a success response
  res.json({
    status: "success",
    message: "Setting value updated successfully!",
  });
});
