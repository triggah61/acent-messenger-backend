function generateRandomString(length = 16) {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
    if ((i + 1) % 4 === 0 && i + 1 < length) {
      result += "-";
    }
  }
  return result;
}

module.exports = { generateRandomString };
