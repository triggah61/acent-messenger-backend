/**
 * @fileoverview Translation service using Azure Translator API
 * 
 * This service handles message translation between different languages
 * using Microsoft Azure Translator Text API (v3.0).
 * 
 * @module services/TranslationService
 */

const axios = require('axios');

class TranslationService {
  constructor() {
    // Azure Translator API configuration
    this.apiKey = process.env.AZURE_TRANSLATOR_API_KEY;
    this.endpoint = process.env.AZURE_TRANSLATOR_ENDPOINT || 'https://api.cognitive.microsofttranslator.com';
    this.location = process.env.AZURE_TRANSLATOR_LOCATION || 'global';
    this.apiVersion = '3.0';
    
    // Validate API key
    if (!this.apiKey) {
      console.warn('⚠️ Azure Translator API key not found. Translation service will fail.');
    }
    
    // Language code mapping (Azure Translator uses ISO 639-1 codes)
    this.languageMap = {
      'en': 'en',      // English
      'bn': 'bn',      // Bengali
      'hi': 'hi',      // Hindi
      'es': 'es',      // Spanish
      'fr': 'fr',      // French
      'de': 'de',      // German
      'it': 'it',      // Italian
      'pt': 'pt',      // Portuguese
      'ru': 'ru',      // Russian
      'ja': 'ja',      // Japanese
      'ko': 'ko',      // Korean
      'zh': 'zh-Hans', // Chinese (Simplified)
      'ar': 'ar',      // Arabic
      'th': 'th',      // Thai
      'vi': 'vi',      // Vietnamese
      'tr': 'tr',      // Turkish
      'pl': 'pl',      // Polish
      'nl': 'nl',      // Dutch
      'sv': 'sv',      // Swedish
      'da': 'da',      // Danish
      'no': 'no',      // Norwegian
      'fi': 'fi',      // Finnish
      'cs': 'cs',      // Czech
      'hu': 'hu',      // Hungarian
      'ro': 'ro',      // Romanian
      'bg': 'bg',      // Bulgarian
      'hr': 'hr',      // Croatian
      'sk': 'sk',      // Slovak
      'sl': 'sl',      // Slovenian
      'et': 'et',      // Estonian
      'lv': 'lv',      // Latvian
      'lt': 'lt',      // Lithuanian
      'el': 'el',      // Greek
      'he': 'he',      // Hebrew
      'uk': 'uk',      // Ukrainian
      'ur': 'ur',      // Urdu
      'ms': 'ms',      // Malay
      'ta': 'ta',      // Tamil
      'te': 'te',      // Telugu
      'gu': 'gu',      // Gujarati
      'mr': 'mr',      // Marathi
      'kn': 'kn',      // Kannada
      'ka': 'ka',      // Georgian
      'be': 'be',      // Belarusian
    };
  }

  /**
   * Test if the Azure Translator service is available and working
   * @returns {Promise<boolean>} True if service is working
   */
  async testModel() {
    try {
      if (!this.apiKey) {
        console.error('Azure Translator API key not configured');
        return false;
      }

      const testResult = await this.translateText('Hello', 'en', 'es');
      return testResult && testResult !== 'Hello' && testResult.length > 0;
    } catch (error) {
      console.error('Azure Translator test failed:', error.message);
      return false;
    }
  }

  /**
   * Translate text from source language to target language using Azure Translator API
   * @param {string} text - Text to translate
   * @param {string} sourceLang - Source language code (e.g., 'en', 'bn')
   * @param {string} targetLang - Target language code (e.g., 'en', 'bn')
   * @returns {Promise<string>} Translated text
   */
  async translateText(text, sourceLang, targetLang) {
    try {
      // Validate input
      if (!text || !text.trim()) {
        return text;
      }

      // If source and target languages are the same, return original text
      if (sourceLang === targetLang) {
        return text;
      }

      // Validate API key
      if (!this.apiKey) {
        console.error('Azure Translator API key not configured');
        throw new Error('Azure Translator API key not configured');
      }

      // Get Azure language codes (fallback to provided codes if not mapped)
      const sourceLangCode = this.languageMap[sourceLang.toLowerCase()] || sourceLang.toLowerCase();
      const targetLangCode = this.languageMap[targetLang.toLowerCase()] || targetLang.toLowerCase();

      // Azure Translator API endpoint
      const translateUrl = `${this.endpoint}/translate`;

      // Prepare request
      const params = {
        'api-version': this.apiVersion,
        'from': sourceLangCode,
        'to': targetLangCode,
      };

      const headers = {
        'Ocp-Apim-Subscription-Key': this.apiKey,
        'Ocp-Apim-Subscription-Region': this.location,
        'Content-Type': 'application/json',
      };

      const body = [{
        text: text
      }];

      // Make API request
      const response = await axios.post(translateUrl, body, {
        params,
        headers,
        timeout: 10000, // 10 second timeout
      });

      // Extract translated text from response
      if (response.data && response.data[0] && response.data[0].translations && response.data[0].translations[0]) {
        const translatedText = response.data[0].translations[0].text;
        
        console.log(`Azure Translation: ${sourceLang} -> ${targetLang}: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}" -> "${translatedText.substring(0, 50)}${translatedText.length > 50 ? '...' : ''}"`);
        
        return translatedText;
      } else {
        throw new Error('Invalid response format from Azure Translator API');
      }
    } catch (error) {
      console.error('Azure Translation error:', error.message);
      console.error('Error details:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        statusText: error.response?.statusText,
        sourceLang,
        targetLang,
        text: text.substring(0, 100) + '...'
      });
      
      // Return original text if translation fails
      return text;
    }
  }

  /**
   * Detect the language of the given text using Azure Translator API
   * @param {string} text - Text to detect language for
   * @returns {Promise<string>} Language code (e.g., 'en', 'bn')
   */
  async detectLanguage(text) {
    try {
      if (!text || !text.trim()) {
        return 'en';
      }

      // Validate API key
      if (!this.apiKey) {
        console.error('Azure Translator API key not configured');
        return 'en';
      }

      // Azure Translator Detect API endpoint
      const detectUrl = `${this.endpoint}/detect`;

      const params = {
        'api-version': this.apiVersion,
      };

      const headers = {
        'Ocp-Apim-Subscription-Key': this.apiKey,
        'Ocp-Apim-Subscription-Region': this.location,
        'Content-Type': 'application/json',
      };

      const body = [{
        text: text
      }];

      // Make API request
      const response = await axios.post(detectUrl, body, {
        params,
        headers,
        timeout: 10000, // 10 second timeout
      });

      // Extract detected language from response
      if (response.data && response.data[0] && response.data[0].language) {
        const detectedLang = response.data[0].language.toLowerCase();
        
        // Map Azure language codes back to our internal codes
        const reverseLanguageMap = {};
        Object.keys(this.languageMap).forEach(key => {
          reverseLanguageMap[this.languageMap[key]] = key;
        });
        
        const mappedLang = reverseLanguageMap[detectedLang] || detectedLang;
        
        console.log(`Azure Language Detection: "${text.substring(0, 50)}..." -> ${mappedLang}`);
        
        return mappedLang;
      } else {
        throw new Error('Invalid response format from Azure Translator Detect API');
      }
    } catch (error) {
      console.error('Azure Language Detection error:', error.message);
      console.error('Error details:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });
      // Default to English if detection fails
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
