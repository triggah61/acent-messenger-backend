// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBwMNKPGiv78RK_OAROzaaF-mBe4hL1kdI",
  authDomain: "acent-messenger.firebaseapp.com",
  projectId: "acent-messenger",
  storageBucket: "acent-messenger.firebasestorage.app",
  messagingSenderId: "988277005062",
  appId: "1:988277005062:web:ce9ee77a66195228f7dc87",
  measurementId: "G-DQ05GY4NZ6",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

module.exports = app;
