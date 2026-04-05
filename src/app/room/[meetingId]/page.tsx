
'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useCollection, useUser, useFirestore, useMemoFirebase, useDoc } from '@/firebase';
import {
  doc,
  collection,
  serverTimestamp,
  addDoc,
  query,
  orderBy,
  updateDoc,
  Timestamp,
  onSnapshot,
  limit,
  setDoc,
  where,
  deleteDoc,
} from 'firebase/firestore';
import AuthGuard from '@/components/auth/AuthGuard';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { 
  Mic, 
  MicOff, 
  Video as VideoIcon, 
  VideoOff, 
  Timer, 
  Send, 
  Hand, 
  User as UserIcon, 
  MessageSquare, 
  Users, 
  Trophy,
  ScreenShare,
  StopCircle,
  Monitor,
  MoreVertical,
  Link as LinkIcon,
  Smile,
  Captions,
} from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { cn } from "@/lib/utils";
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from '@/components/ui/skeleton';
import { setDocumentNonBlocking, addDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface Participant {
  id: string;
  name: string;
  joinedAt: Timestamp | null;
  role: 'host' | 'co-host' | 'participant' | 'waiting' | 'left';
  hasRaisedHand?: boolean;
  isMuted?: boolean;
  isVideoOff?: boolean;
}

interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: Timestamp;
}

interface Reaction {
  id: string;
  type: string;
  senderId: string;
  senderName: string;
  createdAt: Timestamp;
}

interface Caption {
  id: string;
  text: string;
  updatedAt: Timestamp;
  username: string;
}

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const EMOJIS = ["👍", "👏", "❤️", "😂", "😮", "👎"];

function formatDuration(seconds: number) {
  if (isNaN(seconds) || seconds < 0) return '00:00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
}

function FloatingReaction({ reaction, onComplete }: { reaction: Reaction, onComplete: (id: string) => void }) {
  useEffect(() => {
    const timer = setTimeout(() => onComplete(reaction.id), 5000);
    return () => clearTimeout(timer);
  }, [reaction.id, onComplete]);

  const left = useMemo(() => 20 + Math.random() * 60, []); 
  const duration = useMemo(() => 4 + Math.random() * 2, []); 
  const delay = useMemo(() => Math.random() * 0.5, []);

  return (
    <div 
      className="absolute bottom-0 pointer-events-none z-50 animate-float-up flex flex-col items-center gap-1"
      style={{ 
        left: `${left}%`,
        animationDuration: `${duration}s`,
        animationDelay: `${delay}s`
      }}
    >
      <div className="text-5xl drop-shadow-2xl filter saturate-150">{reaction.type}</div>
      <div className="bg-black/40 backdrop-blur-md px-3 py-1 rounded-full text-[9px] text-white font-black uppercase tracking-widest whitespace-nowrap border border-white/10 shadow-lg">
        {reaction.senderName}
      </div>
    </div>
  );
}

function StreamView({ stream, name, isMuted, isVideoOff, isMe, isPresenting, className }: { 
  stream: MediaStream | null, 
  name: string, 
  isMuted?: boolean, 
  isVideoOff?: boolean, 
  isMe?: boolean, 
  isPresenting?: boolean,
  className?: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className={cn(
      "relative w-full h-full bg-[#1A1A1A] rounded-[2rem] overflow-hidden border border-white/5 shadow-2xl flex items-center justify-center transition-all duration-500",
      className
    )}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isMe}
        className={cn(
          "w-full h-full transition-all duration-700",
          isPresenting ? "object-contain" : "object-cover",
          (isVideoOff && !isPresenting) ? "opacity-0" : "opacity-100"
        )}
      />
      {(isVideoOff && !isPresenting) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#121212] z-10">
           <div className="rounded-full bg-[#1E1E1E] flex items-center justify-center w-24 h-24 shadow-2xl border border-white/5 mb-4">
              <UserIcon className="text-zinc-700 h-10 w-10" />
           </div>
           <div className="text-zinc-500 font-black tracking-[0.4em] uppercase text-[10px] opacity-60">Camera Off</div>
        </div>
      )}
      <div className="absolute bottom-6 left-6 flex items-center gap-3 z-20">
        <Badge variant="secondary" className="bg-black/60 text-white backdrop-blur-2xl border-white/10 px-4 py-2 font-black text-[11px] uppercase tracking-widest rounded-xl shadow-xl">
          {isPresenting && <Monitor className="h-3.5 w-3.5 mr-2.5 text-primary" />}
          {name} {isMe && "(You)"}
        </Badge>
        {isMuted && !isPresenting && <div className="p-2 bg-[#FF4545] rounded-xl shadow-2xl border border-white/20"><MicOff className="h-4 w-4 text-white" /></div>}
      </div>
    </div>
  );
}

export default function RoomPage() {
  const params = useParams();
  const meetingId = params.meetingId as string;
  const { user } = useUser();
  const firestore = useFirestore();
  const router = useRouter();
  const { toast } = useToast();

  const [isAudioMuted, setIsAudioMuted] = useState(true);
  const [isVideoOff, setIsVideoOff] = useState(true);
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [hasHandRaised, setHasHandRaised] = useState(false);
  const [isCaptionsEnabled, setIsCaptionsEnabled] = useState(false);
  const [elapsedTime, setElapsedTime] = useState('00:00:00');
  const [chatInput, setChatInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeReactions, setActiveReactions] = useState<Reaction[]>([]);
  
  const recognitionRef = useRef<any>(null);
  const lastCaptionRef = useRef<string>('');
  
  const localCameraStream = useRef<MediaStream | null>(null);
  const localScreenStream = useRef<MediaStream | null>(null);
  
  const [remoteCameraStreams, setRemoteCameraStreams] = useState<Map<string, MediaStream>>(new Map());
  const [remoteScreenStreams, setRemoteScreenStreams] = useState<Map<string, MediaStream>>(new Map());

  const pcs = useRef<Map<string, RTCPeerConnection>>(new Map());
  const cameraSenders = useRef<Map<string, RTCRtpSender[]>>(new Map());
  const screenSenders = useRef<Map<string, RTCRtpSender[]>>(new Map());
  const signalingUnsubs = useRef<Map<string, () => void>>(new Map());
  const initialPresenceSynced = useRef(false);
  
  const meetingRef = useMemoFirebase(() => {
    if (!firestore || !meetingId || !user) return null;
    return doc(firestore, 'meetings', meetingId);
  }, [firestore, meetingId, user]);

  const { data: meetingData, isLoading: isMeetingLoading } = useDoc<any>(meetingRef);

  const isHost = user?.uid === meetingData?.hostId;
  const hostId = meetingData?.hostId;
  const screenSharerId = meetingData?.screenSharerId;

  const participantsRef = useMemoFirebase(() => {
    if (!firestore || !meetingId || !user) return null;
    return query(collection(firestore, 'meetings', meetingId, 'participants'), limit(20));
  }, [firestore, meetingId, user]);

  const { data: participants } = useCollection<Participant>(participantsRef);

  const chatRef = useMemoFirebase(() => {
    if (!firestore || !meetingId || !user) return null;
    return query(collection(firestore, 'meetings', meetingId, 'chat'), orderBy('createdAt', 'desc'), limit(50));
  }, [firestore, meetingId, user]);

  const { data: rawChatMessages } = useCollection<ChatMessage>(chatRef);
  const chatMessages = useMemo(() => rawChatMessages ? [...rawChatMessages].reverse() : [], [rawChatMessages]);

  const startTime = useRef(Timestamp.now());
  const reactionsRef = useMemoFirebase(() => {
    if (!firestore || !meetingId || !user) return null;
    return query(
      collection(firestore, 'meetings', meetingId, 'reactions'), 
      where('createdAt', '>', startTime.current),
      limit(10)
    );
  }, [firestore, meetingId, user]);

  const { data: remoteReactions } = useCollection<Reaction>(reactionsRef);

  const captionsRef = useMemoFirebase(() => {
    if (!firestore || !meetingId || !user) return null;
    return query(collection(firestore, 'meetings', meetingId, 'captions'));
  }, [firestore, meetingId, user]);

  const { data: remoteCaptions } = useCollection<Caption>(captionsRef);

  useEffect(() => {
    if (!remoteReactions) return;
    setActiveReactions(prev => {
      const existingIds = new Set(prev.map(r => r.id));
      const newReactions = remoteReactions.filter(r => !existingIds.has(r.id));
      if (newReactions.length === 0) return prev;
      return [...prev, ...newReactions];
    });
  }, [remoteReactions]);

  const activeParticipants = useMemo(() => {
    if (!participants) return [];
    return participants.filter(p => p.role !== 'left' && p.role !== 'waiting');
  }, [participants]);

  const activeParticipantIds = useMemo(() => activeParticipants.map(p => p.id).sort().join(','), [activeParticipants]);

  const syncPresence = useCallback((updates: Partial<any>, isInitial = false) => {
    if (!user?.uid || !firestore || !meetingId || isMeetingLoading || !hostId) return;
    const pRef = doc(firestore, 'meetings', meetingId, 'participants', user.uid);
    const data: any = {
      ...updates,
      id: user.uid,
      name: user.displayName || user.email?.split('@')[0],
      role: user.uid === hostId ? 'host' : 'participant',
    };
    if (isInitial) {
      data.joinedAt = serverTimestamp();
    }
    setDocumentNonBlocking(pRef, data, { merge: true });
  }, [user?.uid, user?.displayName, user?.email, firestore, meetingId, hostId, isMeetingLoading]);

  useEffect(() => {
    if (!user || !meetingId || !firestore || isMeetingLoading || !meetingData || initialPresenceSynced.current) return;
    syncPresence({ isMuted: true, isVideoOff: true, hasRaisedHand: false }, true);
    initialPresenceSynced.current = true;
  }, [user?.uid, meetingId, !!meetingData, isMeetingLoading, syncPresence]);

  // Captions Logic
  useEffect(() => {
    if (!isCaptionsEnabled) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      if (user && firestore) {
        deleteDoc(doc(firestore, 'meetings', meetingId, 'captions', user.uid));
      }
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast({ variant: 'destructive', title: 'Captions Not Supported', description: 'Your browser does not support Web Speech API.' });
      setIsCaptionsEnabled(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }
      
      const currentTranscript = event.results[event.results.length - 1][0].transcript;
      if (currentTranscript !== lastCaptionRef.current && user && firestore) {
        lastCaptionRef.current = currentTranscript;
        setDocumentNonBlocking(doc(firestore, 'meetings', meetingId, 'captions', user.uid), {
          text: currentTranscript,
          updatedAt: serverTimestamp(),
          username: user.displayName || user.email?.split('@')[0],
        }, { merge: true });
      }
    };

    recognition.onend = () => {
      if (isCaptionsEnabled) recognition.start();
    };

    recognition.start();
    recognitionRef.current = recognition;

    return () => {
      if (recognitionRef.current) recognitionRef.current.stop();
    };
  }, [isCaptionsEnabled, user, firestore, meetingId]);

  const updateTracksForPeers = (stream: MediaStream | null, type: 'camera' | 'screen') => {
    pcs.current.forEach((pc, id) => {
      const existingSenders = type === 'camera' ? cameraSenders.current.get(id) : screenSenders.current.get(id);
      if (existingSenders) {
        existingSenders.forEach(s => pc.removeTrack(s));
      }
      if (stream) {
        const senders = stream.getTracks().map(t => pc.addTrack(t, stream));
        if (type === 'camera') cameraSenders.current.set(id, senders);
        else screenSenders.current.set(id, senders);
      } else {
        if (type === 'camera') cameraSenders.current.delete(id);
        else screenSenders.current.delete(id);
      }
    });
  };

  const handleToggleVideo = async () => {
    if (isProcessing || !user) return;
    setIsProcessing(true);
    try {
      if (isVideoOff) {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        stream.getAudioTracks().forEach(t => t.enabled = !isAudioMuted);
        localCameraStream.current?.getTracks().forEach(t => t.stop());
        localCameraStream.current = stream;
        updateTracksForPeers(stream, 'camera');
        setIsVideoOff(false);
        syncPresence({ isVideoOff: false });
      } else {
        if (!isAudioMuted) {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          localCameraStream.current?.getTracks().forEach(t => t.stop());
          localCameraStream.current = stream;
          updateTracksForPeers(stream, 'camera');
        } else {
          localCameraStream.current?.getTracks().forEach(t => t.stop());
          localCameraStream.current = null;
          updateTracksForPeers(null, 'camera');
        }
        setIsVideoOff(true);
        syncPresence({ isVideoOff: true });
      }
    } catch (err) {
      toast({ variant: 'destructive', title: 'Camera Access Denied' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleToggleAudio = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      const newState = !isAudioMuted;
      if (!newState && !localCameraStream.current) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: !isVideoOff });
        localCameraStream.current = stream;
        updateTracksForPeers(stream, 'camera');
      }
      if (localCameraStream.current) {
        localCameraStream.current.getAudioTracks().forEach(t => t.enabled = !newState);
      }
      setIsAudioMuted(newState);
      syncPresence({ isMuted: newState });
    } catch (err) {
      toast({ variant: 'destructive', title: 'Mic Access Denied' });
    } finally {
      setIsProcessing(false);
    }
  };

  const startScreenShare = async () => {
    if (!user || !firestore || screenSharerId) {
      if (screenSharerId) toast({ title: "Someone is already presenting" });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      localScreenStream.current = stream;
      updateTracksForPeers(stream, 'screen');
      await updateDoc(doc(firestore, 'meetings', meetingId), { screenSharerId: user.uid });
      setIsSharingScreen(true);
      stream.getVideoTracks()[0].onended = stopScreenShare;
    } catch (err) {
      toast({ variant: 'destructive', title: 'Presentation Cancelled' });
    }
  };

  const stopScreenShare = async () => {
    if (!user || !firestore) return;
    localScreenStream.current?.getTracks().forEach(t => t.stop());
    localScreenStream.current = null;
    updateTracksForPeers(null, 'screen');
    await updateDoc(doc(firestore, 'meetings', meetingId), { screenSharerId: null });
    setIsSharingScreen(false);
  };

  const sendReaction = useCallback((emoji: string) => {
    if (!user || !firestore || !meetingId) return;
    const reactionRef = collection(firestore, 'meetings', meetingId, 'reactions');
    addDocumentNonBlocking(reactionRef, {
      type: emoji,
      senderId: user.uid,
      senderName: user.displayName || user.email?.split('@')[0],
      createdAt: serverTimestamp(),
    });
  }, [user, firestore, meetingId]);

  const copyInviteLink = () => {
    const link = window.location.href;
    navigator.clipboard.writeText(link);
    toast({ title: "Link copied!" });
  };

  useEffect(() => {
    if (!user || !firestore || !meetingId || !activeParticipantIds) return;
    const currentIds = activeParticipantIds.split(',').filter(id => id && id !== user.uid);
    const currentIdSet = new Set(currentIds);

    pcs.current.forEach((pc, id) => {
      if (!currentIdSet.has(id)) {
        signalingUnsubs.current.get(`${id}_channel`)?.();
        signalingUnsubs.current.delete(`${id}_channel`);
        pc.close();
        pcs.current.delete(id);
        cameraSenders.current.delete(id);
        screenSenders.current.delete(id);
        setRemoteCameraStreams(prev => { const n = new Map(prev); n.delete(id); return n; });
        setRemoteScreenStreams(prev => { const n = new Map(prev); n.delete(id); return n; });
      }
    });

    currentIds.forEach(async (participantId) => {
      if (pcs.current.has(participantId)) return;
      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcs.current.set(participantId, pc);
      if (localCameraStream.current) {
        const senders = localCameraStream.current.getTracks().map(t => pc.addTrack(t, localCameraStream.current!));
        cameraSenders.current.set(participantId, senders);
      }
      if (localScreenStream.current) {
        const senders = localScreenStream.current.getTracks().map(t => pc.addTrack(t, localScreenStream.current!));
        screenSenders.current.set(participantId, senders);
      }
      pc.ontrack = (event) => {
        const stream = event.streams[0];
        if (participantId === screenSharerId) {
          setRemoteScreenStreams(prev => new Map(prev).set(participantId, stream));
        } else {
          setRemoteCameraStreams(prev => new Map(prev).set(participantId, stream));
        }
      };
      const channelId = [user.uid, participantId].sort().join('_');
      const channelRef = doc(firestore, 'meetings', meetingId, 'webrtc', channelId);
      const isPolite = user.uid > participantId;
      let makingOffer = false;
      let ignoreOffer = false;

      pc.onnegotiationneeded = async () => {
        try {
          makingOffer = true;
          await pc.setLocalDescription();
          const offer = pc.localDescription;
          if (offer) {
             await setDoc(channelRef, { 
               [user.uid]: { type: offer.type, sdp: offer.sdp, timestamp: serverTimestamp() } 
             }, { merge: true });
          }
        } catch (err) {} finally { makingOffer = false; }
      };

      pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
          setDoc(channelRef, { [`candidates_${user.uid}`]: candidate.toJSON() }, { merge: true });
        }
      };

      const unsubChannel = onSnapshot(channelRef, async (snapshot) => {
        const data = snapshot.data();
        if (!data) return;
        const remoteData = data[participantId];
        const remoteCandidate = data[`candidates_${participantId}`];
        try {
          if (remoteData) {
            const offerCollision = remoteData.type === 'offer' && (makingOffer || pc.signalingState !== 'stable');
            ignoreOffer = !isPolite && offerCollision;
            if (ignoreOffer) return;
            await pc.setRemoteDescription(remoteData);
            if (remoteData.type === 'offer') {
              await pc.setLocalDescription();
              const answer = pc.localDescription;
              if (answer) {
                await setDoc(channelRef, { [user.uid]: { type: answer.type, sdp: answer.sdp, timestamp: serverTimestamp() } }, { merge: true });
              }
            }
          }
          if (remoteCandidate) await pc.addIceCandidate(new RTCIceCandidate(remoteCandidate));
        } catch (err) {}
      });
      signalingUnsubs.current.set(`${participantId}_channel`, unsubChannel);
    });
  }, [user?.uid, firestore, meetingId, activeParticipantIds, screenSharerId]);

  useEffect(() => {
    if (!meetingData?.createdAt || meetingData.status === 'finished') return;
    const interval = setInterval(() => {
      const diff = Math.max(0, Date.now() - meetingData.createdAt.seconds * 1000);
      setElapsedTime(formatDuration(diff / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [meetingData?.createdAt, meetingData?.status]);

  if (isMeetingLoading) return <div className="h-screen flex items-center justify-center bg-[#F8F9FB]"><Skeleton className="h-16 w-64 rounded-3xl" /></div>;

  if (!meetingData || meetingData?.status === 'finished') {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-[#F8F9FB] p-6 text-center">
        <div className="bg-zinc-900 p-8 rounded-[3rem] shadow-2xl mb-12 animate-in zoom-in duration-500">
          <Trophy className="h-24 w-24 text-white" />
        </div>
        <h1 className="text-5xl font-black mb-4 text-zinc-900 tracking-tighter">Session Completed</h1>
        <p className="text-zinc-500 font-bold uppercase tracking-[0.2em] mb-12 text-xs">Thank you for connecting with ConnectVerse</p>
        <Button onClick={() => router.push('/dashboard')} className="rounded-[2rem] h-16 px-12 font-black uppercase text-xs tracking-[0.2em] shadow-xl hover:scale-105 transition-all">Back to Dashboard</Button>
      </div>
    );
  }

  const spotlightParticipantId = activeParticipants.find(p => p.id !== user?.uid)?.id || user?.uid;
  const isSpotlightMe = spotlightParticipantId === user?.uid;
  const spotlightParticipant = activeParticipants.find(p => p.id === spotlightParticipantId);

  return (
    <AuthGuard>
      <div className="flex h-screen w-full flex-col overflow-hidden bg-[#F8F9FB]">
        {isSharingScreen && (
          <div className="bg-zinc-900 px-10 py-4 flex items-center justify-between text-white animate-in slide-in-from-top duration-500 z-50 shadow-2xl">
             <div className="flex items-center gap-4">
                <div className="p-2 bg-primary/20 rounded-lg animate-pulse">
                  <Monitor className="h-5 w-5 text-primary" />
                </div>
                <span className="font-black text-[11px] uppercase tracking-[0.25em]">You are presenting to everyone</span>
             </div>
             <Button variant="ghost" size="sm" onClick={stopScreenShare} className="text-white hover:bg-white/10 font-black uppercase text-[10px] tracking-[0.2em] border border-white/20 rounded-xl px-6 h-10">Stop Presenting</Button>
          </div>
        )}

        <header className="flex h-24 items-center justify-between px-12 bg-white border-b z-10 shrink-0 shadow-sm">
          <div className="flex items-center gap-10">
            <div className="bg-zinc-900 flex items-center justify-center h-14 w-14 rounded-[1.5rem] text-white font-black text-2xl shadow-2xl ring-4 ring-zinc-50 transition-transform hover:rotate-6">CV</div>
            <div className="flex flex-col">
               <div className="flex items-center gap-4">
                 <h1 className="text-xl font-black truncate max-w-[400px] leading-tight tracking-tight text-zinc-900">{meetingData?.name || 'Live Session'}</h1>
                 <Button variant="secondary" size="icon" onClick={copyInviteLink} className="h-10 w-10 rounded-xl text-zinc-400 hover:text-primary hover:bg-primary/5 bg-zinc-50 shadow-sm"><LinkIcon className="h-4 w-4" /></Button>
               </div>
               <p className="text-[10px] text-zinc-400 font-black uppercase tracking-[0.3em] mt-1.5 flex items-center gap-2">
                 <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse"></span>
                 {screenSharerId ? 'Presentation Active' : 'Live Meeting Room'}
               </p>
            </div>
          </div>
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-4 bg-zinc-50 border border-zinc-100 rounded-[1.5rem] px-6 py-4 text-xs font-black text-zinc-600 shadow-inner"><Timer className="h-4 w-4 text-primary" /> {elapsedTime}</div>
            {isHost ? (
              <Button onClick={() => updateDoc(meetingRef!, { status: 'finished', endedAt: serverTimestamp() })} variant="destructive" className="rounded-[1.5rem] h-16 px-12 font-black uppercase text-xs tracking-[0.2em] shadow-2xl bg-[#FF4545] border-none hover:scale-105 transition-all">End Session</Button>
            ) : (
              <Button onClick={() => router.push('/dashboard')} variant="outline" className="rounded-[1.5rem] h-16 px-12 font-black uppercase text-xs tracking-[0.2em] border-zinc-200 shadow-sm hover:bg-zinc-50">Leave Room</Button>
            )}
          </div>
        </header>

        <main className="flex-1 flex overflow-hidden p-10 gap-10 relative">
          <div className="flex-1 flex flex-col gap-10 overflow-hidden relative">
            <div className="flex-1 bg-[#0F0F0F] rounded-[4rem] relative overflow-hidden shadow-[0_40px_100px_-20px_rgba(0,0,0,0.3)] border border-white/5 p-6">
               <div className="w-full h-full flex items-center justify-center transition-all duration-700">
                 {screenSharerId ? (
                   <StreamView 
                     stream={screenSharerId === user?.uid ? localScreenStream.current : remoteScreenStreams.get(screenSharerId) || null}
                     name={participants?.find(p => p.id === screenSharerId)?.name || 'Presentation'}
                     isPresenting={true}
                     isMe={screenSharerId === user?.uid}
                   />
                 ) : (
                   <StreamView 
                     stream={isSpotlightMe ? localCameraStream.current : remoteCameraStreams.get(spotlightParticipantId!) || null}
                     name={isSpotlightMe ? 'You' : spotlightParticipant?.name || 'Participant'}
                     isVideoOff={isSpotlightMe ? isVideoOff : spotlightParticipant?.isVideoOff}
                     isMuted={isSpotlightMe ? isAudioMuted : spotlightParticipant?.isMuted}
                     isMe={isSpotlightMe}
                   />
                 )}
               </div>

              <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-[4rem]">
                {activeReactions.map(reaction => (
                  <FloatingReaction 
                    key={reaction.id} 
                    reaction={reaction} 
                    onComplete={(id) => setActiveReactions(prev => prev.filter(r => r.id !== id))} 
                  />
                ))}
              </div>

              {/* Captions Overlay */}
              {isCaptionsEnabled && (
                <div className="absolute bottom-32 left-0 right-0 flex justify-center pointer-events-none z-50">
                  <div className="bg-black/80 backdrop-blur-xl px-10 py-6 rounded-[2.5rem] border border-white/10 max-w-[80%] shadow-2xl animate-in slide-in-from-bottom duration-500">
                    <div className="space-y-4 max-h-[120px] overflow-hidden">
                      {remoteCaptions && remoteCaptions.length > 0 ? (
                        remoteCaptions.map((caption) => (
                          <div key={caption.id} className="flex gap-4 items-start">
                            <span className="font-black text-[10px] uppercase tracking-widest text-primary shrink-0 mt-1">{caption.username}:</span>
                            <p className="text-white text-lg font-bold leading-tight">{caption.text}</p>
                          </div>
                        ))
                      ) : (
                        <p className="text-zinc-500 font-black uppercase text-xs tracking-widest animate-pulse">Captions active • Listening...</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {(screenSharerId || !isVideoOff) && (
                <div className={cn(
                  "absolute bottom-16 right-16 w-80 aspect-video rounded-[2.5rem] overflow-hidden border-[6px] border-white/10 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] z-40 bg-zinc-900 backdrop-blur-3xl transition-all duration-700 hover:scale-105",
                  !screenSharerId && "opacity-0 scale-90 pointer-events-none"
                )}>
                   <StreamView 
                     stream={localCameraStream.current} 
                     name="You" 
                     isMe={true} 
                     isVideoOff={isVideoOff}
                     isMuted={isAudioMuted}
                   />
                </div>
              )}
            </div>

            <div className="h-32 mx-auto w-fit bg-white/90 backdrop-blur-3xl rounded-[3.5rem] border border-white shadow-[0_20px_50px_rgba(0,0,0,0.1)] flex items-center px-12 gap-6 shrink-0 -mt-16 z-20 ring-1 ring-zinc-100">
               <Button variant={isAudioMuted ? "destructive" : "secondary"} size="icon" onClick={handleToggleAudio} className={cn("rounded-2xl h-16 w-16 shadow-2xl transition-all hover:scale-110", isAudioMuted ? "bg-[#FF4545] text-white" : "bg-zinc-100 text-zinc-700")}>{isAudioMuted ? <MicOff className="h-8 w-8" /> : <Mic className="h-8 w-8" />}</Button>
               <Button variant={isVideoOff ? "destructive" : "secondary"} size="icon" onClick={handleToggleVideo} disabled={isProcessing} className={cn("rounded-2xl h-16 w-16 shadow-2xl transition-all hover:scale-110", isVideoOff ? "bg-[#FF4545] text-white" : "bg-zinc-100 text-zinc-700")}>{isVideoOff ? <VideoOff className="h-8 w-8" /> : <VideoIcon className="h-8 w-8" />}</Button>
               <Separator orientation="vertical" className="h-14 mx-2 bg-zinc-100" />
               
               <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="secondary" size="icon" className="rounded-2xl h-16 w-16 bg-zinc-50 hover:bg-zinc-100 transition-all shadow-xl hover:scale-110">
                      <Smile className="h-8 w-8 text-zinc-700" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent side="top" align="center" className="w-fit p-4 bg-white/80 backdrop-blur-2xl border-white rounded-[2.5rem] shadow-[0_32px_64px_-16px_rgba(0,0,0,0.3)] mb-8 animate-in fade-in zoom-in slide-in-from-bottom-4 duration-300">
                    <div className="flex gap-4">
                      {EMOJIS.map((emoji) => (
                        <button 
                          key={emoji}
                          onClick={() => sendReaction(emoji)}
                          className="text-4xl hover:scale-125 transition-transform p-3 rounded-2xl hover:bg-zinc-100/50 active:scale-90"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
               </Popover>

               <Button variant={isCaptionsEnabled ? "default" : "secondary"} size="icon" onClick={() => setIsCaptionsEnabled(!isCaptionsEnabled)} className={cn("rounded-2xl h-16 w-16 shadow-2xl transition-all hover:scale-110", isCaptionsEnabled ? "bg-primary text-white" : "bg-zinc-50 text-zinc-700")}><Captions className="h-8 w-8" /></Button>

               <Button variant={isSharingScreen ? "default" : "secondary"} size="icon" onClick={isSharingScreen ? stopScreenShare : startScreenShare} className={cn("rounded-2xl h-16 w-16 shadow-2xl transition-all hover:scale-110", isSharingScreen ? "bg-primary text-white" : "bg-zinc-50 text-zinc-700")}>{isSharingScreen ? <StopCircle className="h-8 w-8" /> : <ScreenShare className="h-8 w-8" />}</Button>
               <Button variant={hasHandRaised ? "default" : "secondary"} size="icon" onClick={() => { setHasHandRaised(!hasHandRaised); syncPresence({ hasRaisedHand: !hasHandRaised }); }} className={cn("rounded-2xl h-16 w-16 shadow-2xl transition-all hover:scale-110", hasHandRaised ? "bg-yellow-400 text-white" : "bg-zinc-50 text-zinc-700")}><Hand className="h-8 w-8" /></Button>
               <Button variant="secondary" size="icon" className="rounded-2xl h-16 w-16 bg-zinc-50 hover:bg-zinc-100 shadow-xl transition-all hover:scale-110"><MoreVertical className="h-8 w-8 text-zinc-700" /></Button>
            </div>
          </div>

          <Card className="w-[450px] flex flex-col overflow-hidden border-none shadow-[0_40px_80px_-20px_rgba(0,0,0,0.1)] shrink-0 rounded-[4rem] bg-white">
             <Tabs defaultValue="chat" className="flex-1 flex flex-col overflow-hidden">
                <div className="px-10 pt-12 pb-6 border-b">
                   <TabsList className="w-full h-16 grid grid-cols-2 rounded-2xl bg-zinc-100/80 p-1.5 ring-1 ring-zinc-50">
                      <TabsTrigger value="chat" className="rounded-xl font-black text-[11px] uppercase tracking-widest data-[state=active]:shadow-lg"><MessageSquare className="h-4 w-4 mr-3" /> Chat</TabsTrigger>
                      <TabsTrigger value="participants" className="rounded-xl font-black text-[11px] uppercase tracking-widest data-[state=active]:shadow-lg"><Users className="h-4 w-4 mr-3" /> People</TabsTrigger>
                   </TabsList>
                </div>

                <TabsContent value="chat" className="flex-1 flex flex-col overflow-hidden mt-0">
                   <ScrollArea className="flex-1 p-10">
                      <div className="space-y-8">
                         {chatMessages?.map((msg) => (
                           <div key={msg.id} className={cn("flex flex-col gap-2.5", msg.senderId === user?.uid ? "items-end" : "items-start")}>
                              <div className="text-[10px] font-black text-zinc-400 px-3 uppercase tracking-widest">{msg.senderName}</div>
                              <div className={cn("max-w-[85%] px-6 py-4 rounded-[1.75rem] text-[13px] font-bold shadow-sm leading-relaxed", msg.senderId === user?.uid ? "bg-zinc-900 text-white rounded-tr-none" : "bg-zinc-50 text-zinc-800 rounded-tl-none")}>{msg.text}</div>
                           </div>
                         ))}
                      </div>
                   </ScrollArea>
                   <div className="p-8 border-t bg-zinc-50/50">
                      <div className="relative flex items-center">
                        <Input 
                          placeholder="Type a message..." 
                          value={chatInput} 
                          onChange={(e) => setChatInput(e.target.value)} 
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && chatInput.trim() && firestore && user) {
                              addDoc(collection(firestore, 'meetings', meetingId, 'chat'), { 
                                senderId: user.uid, 
                                senderName: user.displayName || user.email?.split('@')[0], 
                                text: chatInput, 
                                createdAt: serverTimestamp() 
                              });
                              setChatInput('');
                            }
                          }} 
                          className="pr-14 rounded-2xl h-14 bg-white border-zinc-100 shadow-sm font-bold text-sm" 
                        />
                        <Button size="icon" variant="ghost" className="absolute right-1.5 top-1/2 -translate-y-1/2 h-11 w-11 rounded-xl hover:bg-zinc-50" onClick={() => {
                          if (chatInput.trim() && firestore && user) {
                            addDoc(collection(firestore, 'meetings', meetingId, 'chat'), { 
                              senderId: user.uid, 
                              senderName: user.displayName || user.email?.split('@')[0], 
                              text: chatInput, 
                              createdAt: serverTimestamp() 
                            });
                            setChatInput('');
                          }
                        }}><Send className="h-5 w-5 text-zinc-400" /></Button>
                      </div>
                   </div>
                </TabsContent>

                <TabsContent value="participants" className="flex-1 flex flex-col overflow-hidden mt-0">
                   <ScrollArea className="flex-1 p-8">
                      <div className="space-y-4">
                        {activeParticipants.map(p => (
                          <div key={p.id} className="flex items-center justify-between p-5 bg-zinc-50 rounded-3xl border border-zinc-100 shadow-sm transition-all hover:bg-zinc-100/50">
                             <div className="flex items-center gap-4">
                                <div className="h-10 w-10 rounded-2xl bg-white shadow-sm flex items-center justify-center text-[11px] font-black uppercase text-zinc-400 ring-1 ring-zinc-100">
                                  {p.name.substring(0, 2)}
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-xs font-black text-zinc-900">{p.name} {p.id === user?.uid && "(You)"}</span>
                                  <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">{p.role}</span>
                                </div>
                             </div>
                             <div className="flex gap-3">
                                {p.isMuted && <MicOff className="h-4 w-4 text-destructive opacity-40" />}
                                {p.isVideoOff && <VideoOff className="h-4 w-4 text-destructive opacity-40" />}
                                {p.hasRaisedHand && <Hand className="h-4 w-4 text-yellow-500 animate-bounce" />}
                             </div>
                          </div>
                        ))}
                      </div>
                   </ScrollArea>
                </TabsContent>
             </Tabs>
          </Card>
        </main>
      </div>
    </AuthGuard>
  );
}
