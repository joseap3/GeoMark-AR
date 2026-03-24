import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, Timestamp } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export const signIn = () => signInWithPopup(auth, googleProvider);
export const logOut = () => signOut(auth);

export interface MarkerData {
  id?: string;
  lat: number;
  lng: number;
  type: 'text' | 'photo' | 'video';
  content: string;
  authorUid: string;
  authorName?: string;
  createdAt: Timestamp;
  title?: string;
}

export const addMarker = async (marker: Omit<MarkerData, 'id' | 'createdAt'>) => {
  return addDoc(collection(db, 'markers'), {
    ...marker,
    createdAt: serverTimestamp(),
  });
};

export const subscribeToMarkers = (callback: (markers: MarkerData[]) => void) => {
  const q = query(collection(db, 'markers'), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snapshot) => {
    const markers = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as MarkerData));
    callback(markers);
  }, (error) => {
    console.error("Firestore Error: ", error);
  });
};
