const crypto = require("crypto");
const axios = require("axios");

class FacebookConversionsService {
  constructor() {
    this.pixelId = process.env.FACEBOOK_PIXEL_ID;
    this.accessToken = process.env.FACEBOOK_ACCESS_TOKEN;
    this.apiVersion = process.env.FACEBOOK_API_VERSION || "v18.0";
    this.testEventCode = process.env.FACEBOOK_TEST_EVENT_CODE || null;
    this.enabled = process.env.FACEBOOK_ENABLE_CONVERSIONS_API === "true";
  }

  /**
   * Hash data with SHA256
   */
  hashData(data) {
    if (!data) return null;
    return crypto
      .createHash("sha256")
      .update(data.toString().toLowerCase().trim())
      .digest("hex");
  }

  /**
   * Normalize phone number to E.164 format
   */
  normalizePhone(phone, dialCode) {
    if (!phone) return null;
    let normalized = phone.replace(/\D/g, ""); // Remove non-digits
    if (dialCode && !normalized.startsWith(dialCode.replace("+", ""))) {
      normalized = dialCode.replace("+", "") + normalized;
    }
    return normalized ? `+${normalized}` : null;
  }

  /**
   * Check if user has Facebook attribution
   */
  hasFacebookAttribution(user) {
    const attribution = user.facebookAttribution;
    return (
      attribution &&
      (attribution.fbclid || attribution.fbc || attribution.fbp)
    );
  }

  /**
   * Send purchase event to Facebook Conversions API
   * ONLY if user has Facebook attribution
   */
  async sendPurchaseEvent({
    user,
    eventName = "Purchase",
    value,
    currency = "USD",
    contentIds = [],
    contentType = "product",
    contentName,
    orderId,
    purchaseToken,
  }) {
    // Check if Conversions API is enabled
    if (!this.enabled) {
      console.log("ℹ️ Facebook Conversions API is disabled");
      return { success: false, reason: "disabled" };
    }

    // Check if user has Facebook attribution
    if (!this.hasFacebookAttribution(user)) {
      console.log(
        "ℹ️ Skipping Facebook conversion - user has no Facebook attribution"
      );
      return { success: false, reason: "no_attribution" };
    }

    try {
      // Prepare user data
      const userData = {
        em: user.email ? [this.hashData(user.email)] : null,
        ph: user.phone
          ? [this.hashData(this.normalizePhone(user.phone, user.dialCode))]
          : null,
        fn: user.firstName ? [this.hashData(user.firstName)] : null,
        ln: user.lastName ? [this.hashData(user.lastName)] : null,
        external_id: user._id.toString(),
      };

      // Remove null values
      Object.keys(userData).forEach(
        (key) => userData[key] === null && delete userData[key]
      );

      // Add Facebook attribution data
      const attribution = user.facebookAttribution;
      if (attribution.fbc) {
        userData.fbc = attribution.fbc;
      }
      if (attribution.fbp) {
        userData.fbp = attribution.fbp;
      }

      // Prepare event data
      const eventData = {
        event_name: eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: `${eventName.toLowerCase()}_${orderId || purchaseToken}_${Date.now()}`,
        event_source_url: "https://app.acentmessenger.com",
        action_source: "app",
        user_data: userData,
        custom_data: {
          value: value,
          currency: currency,
          content_ids: contentIds,
          content_type: contentType,
          content_name: contentName,
          num_items: 1,
        },
      };

      // Prepare request payload
      const payload = {
        data: [eventData],
      };

      // Add test event code if in testing mode
      if (this.testEventCode) {
        payload.test_event_code = this.testEventCode;
      }

      // Send to Facebook Conversions API
      const url = `https://graph.facebook.com/${this.apiVersion}/${this.pixelId}/events`;
      const response = await axios.post(url, payload, {
        headers: {
          "Content-Type": "application/json",
        },
        params: {
          access_token: this.accessToken,
        },
      });

      console.log("✅ Facebook Conversions API: Event sent successfully");
      console.log("   Response:", JSON.stringify(response.data, null, 2));

      return {
        success: true,
        eventsReceived: response.data.events_received,
        messages: response.data.messages || [],
      };
    } catch (error) {
      console.error("❌ Facebook Conversions API Error:", error.response?.data || error.message);
      
      // Don't throw error - purchase should still succeed
      return {
        success: false,
        error: error.response?.data || error.message,
      };
    }
  }
}

module.exports = new FacebookConversionsService();

