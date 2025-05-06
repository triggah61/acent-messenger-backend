/**
 * @fileoverview Authentication Service
 * 
 * This module provides authentication-related services, specifically
 * the generation of JSON Web Tokens (JWT) for user authentication.
 * 
 * @module AuthService
 * @requires jsonwebtoken
 */

const jwt = require("jsonwebtoken");

/**
 * Generates a JSON Web Token (JWT) for a given user
 * 
 * This function creates a signed JWT containing the user's ID and role.
 * The token is signed using the JWT_SECRET from the environment variables.
 * 
 * @async
 * @function generateWebToken
 * @param {Object} user - The user object for which to generate the token
 * @param {string} user._id - The unique identifier of the user
 * @param {string} user.roleType - The role type of the user
 * @returns {Promise<string>} A promise that resolves to the generated JWT
 * 
 * @example
 * const user = { _id: '123456', roleType: 'admin' };
 * const token = await generateWebToken(user);
 * 
 * @todo Consider adding an expiration time to the token for enhanced security
 */
exports.generateWebToken = async (user) => {
  const token = await jwt.sign(
    { id: user._id, role: user.roleType },
    process.env.JWT_SECRET,
    // { expiresIn: "1d" }
  );

  return token;
};
