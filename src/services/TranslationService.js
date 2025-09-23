/**
 * @fileoverview Translation service using Gemini AI
 * 
 * This service handles message translation between different languages
 * using Google's Gemini AI API.
 * 
 * @module services/TranslationService
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

class TranslationService {
  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
  }

  /**
   * Translate text from source language to target language
   * @param {string} text - Text to translate
   * @param {string} sourceLang - Source language code (e.g., 'en', 'bn')
   * @param {string} targetLang - Target language code (e.g., 'bn', 'en')
   * @returns {Promise<string>} Translated text
   */
  async translateText(text, sourceLang, targetLang) {
    try {
      if (!text || !text.trim()) {
        return text;
      }

      // If source and target languages are the same, return original text
      if (sourceLang === targetLang) {
        return text;
      }

      const languageMap = {
        'en': 'English',
        'bn': 'Bengali',
        'hi': 'Hindi',
        'es': 'Spanish',
        'fr': 'French',
        'de': 'German',
        'it': 'Italian',
        'pt': 'Portuguese',
        'ru': 'Russian',
        'ja': 'Japanese',
        'ko': 'Korean',
        'zh': 'Chinese',
        'ar': 'Arabic'
      };

      const sourceLanguage = languageMap[sourceLang] || sourceLang;
      const targetLanguage = languageMap[targetLang] || targetLang;

      const prompt = `Translate the following text from ${sourceLanguage} to ${targetLanguage}. 
      Only provide the translated text without any additional explanations or formatting:
      
      "${text}"`;

      const result = await this.model.generateContent(prompt);
      const translatedText = result.response.text().trim();

      console.log(`Translation: ${sourceLang} -> ${targetLang}: "${text}" -> "${translatedText}"`);
      
      return translatedText;
    } catch (error) {
      console.error('Translation error:', error);
      // Return original text if translation fails
      return text;
    }
  }

  /**
   * Detect the language of the given text
   * @param {string} text - Text to detect language for
   * @returns {Promise<string>} Language code (e.g., 'en', 'bn')
   */
  async detectLanguage(text) {
    try {
      if (!text || !text.trim()) {
        return 'en';
      }

      const prompt = `Detect the language of the following text and respond with only the ISO 639-1 language code (e.g., 'en' for English, 'bn' for Bengali, 'hi' for Hindi, 'es' for Spanish, 'fr' for French, 'de' for German, 'it' for Italian, 'pt' for Portuguese, 'ru' for Russian, 'ja' for Japanese, 'ko' for Korean, 'zh' for Chinese, 'ar' for Arabic):
      
      "${text}"`;

      const result = await this.model.generateContent(prompt);
      const detectedLang = result.response.text().trim().toLowerCase();

      // Validate the detected language
      const validLanguages = ['en', 'bn', 'hi', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh', 'ar'];
      
      if (validLanguages.includes(detectedLang)) {
        return detectedLang;
      }

      // Default to English if detection fails
      return 'en';
    } catch (error) {
      console.error('Language detection error:', error);
      return 'en';
    }
  }

  /**
   * Translate message for all participants in a conversation
   * @param {string} content - Original message content
   * @param {string} senderLanguage - Sender's language
   * @param {Array} participants - Array of participant objects with language
   * @returns {Promise<Object>} Translation results
   */
  async translateMessageForParticipants(content, senderLanguage, participants) {
    try {
      const translations = {};
      const detectedLanguage = await this.detectLanguage(content);

      for (const participant of participants) {
        const participantLanguage = participant.language || 'en';
        
        // Skip if sender and participant have same language
        if (detectedLanguage === participantLanguage) {
          translations[participant.userId] = {
            content: content,
            translatedContent: null,
            originalLanguage: detectedLanguage,
            translatedLanguage: null
          };
          continue;
        }

        // Translate for this participant
        const translatedContent = await this.translateText(
          content, 
          detectedLanguage, 
          participantLanguage
        );

        translations[participant.userId] = {
          content: content,
          translatedContent: translatedContent,
          originalLanguage: detectedLanguage,
          translatedLanguage: participantLanguage
        };
      }

      return translations;
    } catch (error) {
      console.error('Error translating message for participants:', error);
      throw error;
    }
  }
}

module.exports = new TranslationService();
