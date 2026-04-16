import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

// 🔧 Correct configuration
const firebaseConfig = {
  apiKey: "AIzaSyAz6yFO6c-O8xaJrH24XzhxYRQOHC_c0gY",
  authDomain: "food-68656.firebaseapp.com",
  projectId: "food-68656",
  storageBucket: "food-68656.appspot.com",
  messagingSenderId: "577583497069",
  appId: "1:577583497069:web:b185abb4c31dc9f2fba464",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export default app;
