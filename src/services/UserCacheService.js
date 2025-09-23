const redisConfig = require('../config/redis');

class UserCacheService {
  constructor() {
    this.keyPrefix = 'user:';
    this.defaultTTL = 1800; // 30 minutes in seconds
  }

  // Generate Redis key for user
  getUserKey(userId) {
    return `${this.keyPrefix}${userId}`;
  }

  // Cache user data
  async cacheUser(userId, userData) {
    try {
      if (!redisConfig.isClientConnected()) {
        console.warn('Redis not connected, skipping cache operation');
        return false;
      }

      const client = redisConfig.getClient();
      const key = this.getUserKey(userId);
      
      // Remove sensitive data before caching
      const cacheData = {
        _id: userData._id,
        firstName: userData.firstName,
        lastName: userData.lastName,
        username: userData.username,
        email: userData.email,
        phone: userData.phone,
        dialCode: userData.dialCode,
        photo: userData.photo,
        status: userData.status,
        gender: userData.gender,
        dob: userData.dob,
        language: userData.language,
        updatedAt: userData.updatedAt || new Date()
      };

      await client.setEx(key, this.defaultTTL, JSON.stringify(cacheData));
      console.log(`User ${userId} cached successfully`);
      return true;
    } catch (error) {
      console.error('Error caching user:', error);
      return false;
    }
  }

  // Get user from cache
  async getCachedUser(userId) {
    try {
      if (!redisConfig.isClientConnected()) {
        console.warn('Redis not connected, skipping cache lookup');
        return null;
      }

      const client = redisConfig.getClient();
      const key = this.getUserKey(userId);
      
      const cachedData = await client.get(key);
      if (cachedData) {
        const userData = JSON.parse(cachedData);
        console.log(`User ${userId} found in cache`);
        return userData;
      }
      
      console.log(`User ${userId} not found in cache`);
      return null;
    } catch (error) {
      console.error('Error getting cached user:', error);
      return null;
    }
  }

  // Delete user from cache
  async deleteCachedUser(userId) {
    try {
      if (!redisConfig.isClientConnected()) {
        console.warn('Redis not connected, skipping cache deletion');
        return false;
      }

      const client = redisConfig.getClient();
      const key = this.getUserKey(userId);
      
      await client.del(key);
      console.log(`User ${userId} removed from cache`);
      return true;
    } catch (error) {
      console.error('Error deleting cached user:', error);
      return false;
    }
  }

  // Refresh user cache (delete and re-cache)
  async refreshUserCache(userId, userData) {
    try {
      await this.deleteCachedUser(userId);
      return await this.cacheUser(userId, userData);
    } catch (error) {
      console.error('Error refreshing user cache:', error);
      return false;
    }
  }

  // Get cache TTL for a user
  async getUserCacheTTL(userId) {
    try {
      if (!redisConfig.isClientConnected()) {
        return -1;
      }

      const client = redisConfig.getClient();
      const key = this.getUserKey(userId);
      
      return await client.ttl(key);
    } catch (error) {
      console.error('Error getting user cache TTL:', error);
      return -1;
    }
  }
}

module.exports = new UserCacheService(); 