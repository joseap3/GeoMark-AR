import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, Circle } from 'react-leaflet';
import L from 'leaflet';
import { Map as MapIcon, Camera, Plus, LogIn, LogOut, X, Send, Video, Image as ImageIcon, Type, Navigation } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { auth, signIn, logOut, subscribeToMarkers, addMarker, MarkerData } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { getDistance, getBearing } from './utils';

// Fix Leaflet marker icons
const DefaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

// --- Components ---

const MarkerCreator = ({ userPos, onCreated, onCancel }: { userPos: [number, number], onCreated: () => void, onCancel: () => void }) => {
  const [type, setType] = useState<'text' | 'photo' | 'video'>('text');
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content || !auth.currentUser) return;

    setIsSubmitting(true);
    try {
      await addMarker({
        lat: userPos[0],
        lng: userPos[1],
        type,
        content,
        title: title || 'Sem título',
        authorUid: auth.currentUser.uid,
        authorName: auth.currentUser.displayName || 'Anônimo'
      });
      onCreated();
    } catch (err) {
      console.error(err);
      alert('Erro ao criar marcador');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 50 }}
      className="fixed bottom-20 left-4 right-4 bg-white rounded-2xl p-6 shadow-2xl z-50 max-w-md mx-auto"
    >
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">Novo Marcador GPS</h2>
        <button onClick={onCancel} className="p-2 hover:bg-gray-100 rounded-full"><X size={20} /></button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Título</label>
          <input 
            type="text" 
            value={title} 
            onChange={(e) => setTitle(e.target.value)}
            className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
            placeholder="Ex: Minha cápsula do tempo"
          />
        </div>

        <div className="flex gap-2">
          {(['text', 'photo', 'video'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`flex-1 py-2 px-3 rounded-xl flex items-center justify-center gap-2 border transition-all ${
                type === t ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-50 text-gray-600'
              }`}
            >
              {t === 'text' && <Type size={18} />}
              {t === 'photo' && <ImageIcon size={18} />}
              {t === 'video' && <Video size={18} />}
              <span className="capitalize">{t === 'photo' ? 'Foto' : t}</span>
            </button>
          ))}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {type === 'text' ? 'Mensagem' : 'URL do arquivo'}
          </label>
          <textarea 
            value={content} 
            onChange={(e) => setContent(e.target.value)}
            className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-blue-500 outline-none h-24"
            placeholder={type === 'text' ? 'Escreva algo aqui...' : 'Cole o link da foto/vídeo...'}
            required
          />
        </div>

        <button 
          disabled={isSubmitting}
          className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          {isSubmitting ? 'Salvando...' : <><Send size={18} /> Publicar Marcador</>}
        </button>
      </form>
    </motion.div>
  );
};

const ARView = ({ markers, userPos, heading }: { markers: MarkerData[], userPos: [number, number], heading: number }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [nearbyMarkers, setNearbyMarkers] = useState<(MarkerData & { distance: number, bearing: number })[]>([]);

  useEffect(() => {
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (err) {
        console.error("Erro ao acessar câmera:", err);
      }
    };
    startCamera();
    return () => {
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    const filtered = markers
      .map(m => ({
        ...m,
        distance: getDistance(userPos[0], userPos[1], m.lat, m.lng),
        bearing: getBearing(userPos[0], userPos[1], m.lat, m.lng)
      }))
      .filter(m => m.distance < 50) // Only show markers within 50 meters
      .sort((a, b) => a.distance - b.distance);
    setNearbyMarkers(filtered);
  }, [markers, userPos]);

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover opacity-60" />
      
      <div className="ar-overlay">
        {nearbyMarkers.map((m) => {
          // Calculate relative bearing to user's heading
          let relativeBearing = (m.bearing - heading + 360) % 360;
          if (relativeBearing > 180) relativeBearing -= 360;

          // If marker is within FOV (approx 60 degrees)
          const isVisible = Math.abs(relativeBearing) < 30;
          if (!isVisible) return null;

          // Calculate screen position
          const x = 50 + (relativeBearing / 30) * 50; // 0 to 100%
          const scale = Math.max(0.5, 1 - m.distance / 50);

          return (
            <motion.div
              key={m.id}
              className="ar-marker bg-white/90 backdrop-blur p-3 rounded-xl shadow-lg border-2 border-blue-500"
              style={{ left: `${x}%`, top: '50%', transform: `translate(-50%, -50%) scale(${scale})` }}
            >
              <div className="text-xs font-bold text-blue-600 uppercase tracking-tighter mb-1">
                {m.type} • {Math.round(m.distance)}m
              </div>
              <div className="font-bold text-sm">{m.title}</div>
              <div className="text-xs text-gray-500">{m.authorName}</div>
              
              {m.type === 'text' && <p className="mt-2 text-xs italic">"{m.content}"</p>}
              {m.type === 'photo' && <img src={m.content} className="mt-2 w-24 h-24 object-cover rounded" referrerPolicy="no-referrer" />}
            </motion.div>
          );
        })}
      </div>

      {nearbyMarkers.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-white text-center p-8 bg-black/40">
          <p className="text-lg font-medium">Nenhum marcador por perto.<br/><span className="text-sm opacity-70">Aproxime-se de um marcador no mapa para vê-lo aqui.</span></p>
        </div>
      )}

      <div className="absolute top-4 left-4 bg-black/50 text-white px-3 py-1 rounded-full text-xs font-mono">
        Heading: {Math.round(heading)}°
      </div>
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<'map' | 'ar'>('map');
  const [markers, setMarkers] = useState<MarkerData[]>([]);
  const [userPos, setUserPos] = useState<[number, number] | null>(null);
  const [heading, setHeading] = useState(0);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = subscribeToMarkers(setMarkers);
    return unsub;
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setUserPos([pos.coords.latitude, pos.coords.longitude]),
      (err) => console.error(err),
      { enableHighAccuracy: true }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  useEffect(() => {
    const handleOrientation = (e: DeviceOrientationEvent) => {
      // Use webkitCompassHeading for iOS if available
      const h = (e as any).webkitCompassHeading || (360 - (e.alpha || 0));
      setHeading(h);
    };

    if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      // iOS 13+ requires permission
      // We'll trigger this on a user interaction
    } else {
      window.addEventListener('deviceorientation', handleOrientation);
    }
    return () => window.removeEventListener('deviceorientation', handleOrientation);
  }, []);

  const requestOrientation = async () => {
    if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      try {
        const permission = await (DeviceOrientationEvent as any).requestPermission();
        if (permission === 'granted') {
          window.addEventListener('deviceorientation', (e) => {
            const h = (e as any).webkitCompassHeading || (360 - (e.alpha || 0));
            setHeading(h);
          });
        }
      } catch (err) {
        console.error(err);
      }
    }
  };

  if (!user) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-slate-50 p-6">
        <div className="w-20 h-20 bg-blue-600 rounded-3xl flex items-center justify-center text-white mb-6 shadow-xl">
          <Navigation size={40} />
        </div>
        <h1 className="text-3xl font-bold text-slate-900 mb-2">GeoMark AR</h1>
        <p className="text-slate-500 text-center mb-8 max-w-xs">
          Explore o mundo real e deixe sua marca digital em qualquer lugar.
        </p>
        <button 
          onClick={signIn}
          className="flex items-center gap-3 bg-white border border-slate-200 px-8 py-4 rounded-2xl font-bold shadow-sm hover:shadow-md transition-all active:scale-95"
        >
          <LogIn size={20} /> Entrar com Google
        </button>
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex flex-col relative bg-slate-900 overflow-hidden">
      {/* Header */}
      <div className="absolute top-4 left-4 right-4 flex justify-between items-center z-[1000]">
        <div className="bg-white/90 backdrop-blur px-4 py-2 rounded-2xl shadow-lg flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white">
            <Navigation size={16} />
          </div>
          <span className="font-bold text-slate-800">GeoMark AR</span>
        </div>
        <button 
          onClick={logOut}
          className="bg-white/90 backdrop-blur p-2 rounded-2xl shadow-lg text-slate-600 hover:text-red-500"
        >
          <LogOut size={20} />
        </button>
      </div>

      {/* Main View */}
      <div className="flex-1 w-full relative">
        {view === 'map' ? (
          userPos ? (
            <MapContainer center={userPos} zoom={18} scrollWheelZoom={true} className="z-0">
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              />
              <Marker position={userPos}>
                <Popup>Você está aqui</Popup>
              </Marker>
              <Circle center={userPos} radius={50} pathOptions={{ color: 'blue', fillColor: 'blue', fillOpacity: 0.1 }} />
              
              {markers.map(m => (
                <Marker key={m.id} position={[m.lat, m.lng]}>
                  <Popup>
                    <div className="p-1">
                      <div className="font-bold text-blue-600 uppercase text-[10px] mb-1">{m.type}</div>
                      <div className="font-bold text-sm mb-1">{m.title}</div>
                      <div className="text-xs text-gray-500 mb-2">Por {m.authorName}</div>
                      {m.type === 'text' && <p className="text-xs italic">"{m.content}"</p>}
                      {m.type === 'photo' && <img src={m.content} className="w-full h-24 object-cover rounded" referrerPolicy="no-referrer" />}
                    </div>
                  </Popup>
                </Marker>
              ))}
              <MapUpdater center={userPos} />
            </MapContainer>
          ) : (
            <div className="h-full w-full flex items-center justify-center text-white bg-slate-800">
              <div className="text-center">
                <div className="animate-spin mb-4 inline-block"><Navigation size={32} /></div>
                <p>Obtendo sua localização...</p>
              </div>
            </div>
          )
        ) : (
          userPos && <ARView markers={markers} userPos={userPos} heading={heading} />
        )}
      </div>

      {/* Controls */}
      <div className="absolute bottom-6 left-0 right-0 flex justify-center items-center gap-4 z-[1000]">
        <button 
          onClick={() => setView('map')}
          className={`p-4 rounded-2xl shadow-xl transition-all ${view === 'map' ? 'bg-blue-600 text-white scale-110' : 'bg-white text-slate-600'}`}
        >
          <MapIcon size={24} />
        </button>

        <button 
          onClick={() => {
            setIsCreating(true);
            requestOrientation();
          }}
          className="p-5 bg-white text-blue-600 rounded-full shadow-2xl hover:scale-110 active:scale-95 transition-all border-4 border-blue-600"
        >
          <Plus size={32} />
        </button>

        <button 
          onClick={() => {
            setView('ar');
            requestOrientation();
          }}
          className={`p-4 rounded-2xl shadow-xl transition-all ${view === 'ar' ? 'bg-blue-600 text-white scale-110' : 'bg-white text-slate-600'}`}
        >
          <Camera size={24} />
        </button>
      </div>

      {/* Overlays */}
      <AnimatePresence>
        {isCreating && userPos && (
          <MarkerCreator 
            userPos={userPos} 
            onCreated={() => setIsCreating(false)} 
            onCancel={() => setIsCreating(false)} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function MapUpdater({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center);
  }, [center, map]);
  return null;
}
