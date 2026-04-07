import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const getFirebaseConfig = () => {
  if (typeof __firebase_config !== 'undefined') {
    return JSON.parse(__firebase_config);
  }
  // Trage hier deine lokalen Firebase-Daten direkt ein
  return {
    apiKey: "AIzaSyCwRv6ZYW_EioY36FAfiqveGlB4u6TUIe8",
    authDomain: "party-box-45d2b.firebaseapp.com",
    projectId: "party-box-45d2b",
    storageBucket: "party-box-45d2b.firebasestorage.app",
    messagingSenderId: "694553735373",
    appId: "1:694553735373:web:eb4d50f4fc244bd0de7984"
  };
};

export const app = initializeApp(getFirebaseConfig());
export const auth = getAuth(app);
export const db = getFirestore(app);