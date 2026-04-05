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
} from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { cn } from "@/lib/utils";
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from '@/components/ui/skeleton';
import { setDocumentNonBlocking } from '@/firebase/non-blocking-updates';

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

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

function formatDuration(seconds: number) {
  if (isNaN(seconds) || seconds < 0) return '00:00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
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
           <div className="rounded-full bg-[#1E1E1E] flex items-center justify-center w-20 h-20 shadow-2xl border border-white/5 mb-4">
              <UserIcon className="text-zinc-700 h-8 w-8" />
           </div>
           <div className="text-zinc-500 font-black tracking-[0.3em] uppercase text-[9px] opacity-60">Camera Off</div>
        </div>
      )}
      <div className="absolute bottom-4 left-4 flex items-center gap-2 z-20">
        <Badge variant="secondary" className="bg-black/60 text-white backdrop-blur-xl border-white/10 px-3 py-1 font-black text-[10px] uppercase tracking-wider rounded-lg">
          {isPresenting && <Monitor className="h-3 w-3 mr-2 text-primary" />}
          {name} {isMe && "(You)"}
        </Badge>
        {isMuted && !isPresenting && <div className="p-1.5 bg-[#FF4545] rounded-lg shadow-xl border border-white/20"><MicOff className="h-3 w-3 text-white" /></div>}
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
  const [elapsedTime, setElapsedTime] = useState('00:00:00');
  const [chatInput, setChatInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

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

  const updateTracksForPeers = (stream: MediaStream | null, type: 'camera' | 'screen') => {
    pcs.current.forEach((pc, id) => {
      const existingSenders = type === 'camera' ? cameraSenders.current.get(id) : screenSenders.current.get(id);
      
      // Remove old tracks
      if (existingSenders) {
        existingSenders.forEach(s => pc.removeTrack(s));
      }

      // Add new tracks
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
        // Need to start video
        const constraints = { video: true, audio: true };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // Ensure audio track follows current mute state
        stream.getAudioTracks().forEach(t => t.enabled = !isAudioMuted);
        
        // Stop old tracks if we had an audio-only stream
        localCameraStream.current?.getTracks().forEach(t => t.stop());
        
        localCameraStream.current = stream;
        updateTracksForPeers(stream, 'camera');
        setIsVideoOff(false);
        syncPresence({ isVideoOff: false });
      } else {
        // Turning video off. If mic is on, we should keep audio stream alive
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
      toast({ variant: 'destructive', title: 'Camera Access Denied', description: 'Please check browser permissions.' });
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
        // User is unmuting but we have no stream yet
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
      toast({ variant: 'destructive', title: 'Mic Access Denied', description: 'Please check browser permissions.' });
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

  const copyInviteLink = () => {
    const link = window.location.href;
    navigator.clipboard.writeText(link);
    toast({ title: "Link copied!", description: "Meeting invitation link is ready to share." });
  };

  // WebRTC Perfect Negotiation (Polite/Impolite Peer pattern)
  useEffect(() => {
    if (!user || !firestore || !meetingId || !activeParticipantIds) return;
    const currentIds = activeParticipantIds.split(',').filter(id => id && id !== user.uid);
    const currentIdSet = new Set(currentIds);

    // Cleanup disconnected peers
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
      
      // Add existing tracks
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
        // If this stream is from the current sharer, it's a screen share
        if (participantId === screenSharerId) {
          setRemoteScreenStreams(prev => new Map(prev).set(participantId, stream));
        } else {
          setRemoteCameraStreams(prev => new Map(prev).set(participantId, stream));
        }
      };

      const channelId = [user.uid, participantId].sort().join('_');
      const channelRef = doc(firestore, 'meetings', meetingId, 'webrtc', channelId);
      const isPolite = user.uid > participantId; // Lower UID is impolite (starts negotiation)

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
        } catch (err) {
          console.error("Negotiation error:", err);
        } finally {
          makingOffer = false;
        }
      };

      pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
          setDoc(channelRef, {
            [`candidates_${user.uid}`]: candidate.toJSON()
          }, { merge: true });
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
                await setDoc(channelRef, { 
                  [user.uid]: { type: answer.type, sdp: answer.sdp, timestamp: serverTimestamp() } 
                }, { merge: true });
              }
            }
          }
          if (remoteCandidate) {
            await pc.addIceCandidate(new RTCIceCandidate(remoteCandidate));
          }
        } catch (err) {
          if (!ignoreOffer) console.error("Signaling error:", err);
        }
      });
      signalingUnsubs.current.set(`${participantId}_channel`, unsubChannel);
    });

    return () => {
       // Cleanup handled by the dependency array and effect logic
    };
  }, [user?.uid, firestore, meetingId, activeParticipantIds, screenSharerId]);

  useEffect(() => {
    if (!meetingData?.createdAt || meetingData.status === 'finished') return;
    const interval = setInterval(() => {
      const diff = Math.max(0, Date.now() - meetingData.createdAt.seconds * 1000);
      setElapsedTime(formatDuration(diff / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [meetingData?.createdAt, meetingData?.status]);

  if (isMeetingLoading) return <div className="h-screen flex items-center justify-center"><Skeleton className="h-12 w-48 rounded-xl" /></div>;

  if (!meetingData || meetingData?.status === 'finished') {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-[#F8F9FB] p-6 text-center">
        <Trophy className="h-20 w-20 text-primary mb-6" />
        <h1 className="text-4xl font-black mb-3 text-zinc-900">Session Completed</h1>
        <Button onClick={() => router.push('/dashboard')} className="rounded-2xl h-14 px-10">Back to Dashboard</Button>
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
          <div className="bg-primary px-8 py-3 flex items-center justify-between text-white animate-in slide-in-from-top duration-300 z-50">
             <div className="flex items-center gap-3">
                <Monitor className="h-4 w-4" />
                <span className="font-black text-[11px] uppercase tracking-widest">You are presenting to everyone</span>
             </div>
             <Button variant="ghost" size="sm" onClick={stopScreenShare} className="text-white hover:bg-white/20 font-black uppercase text-[10px] tracking-widest border border-white/30 rounded-lg">Stop Presenting</Button>
          </div>
        )}

        <header className="flex h-20 items-center justify-between px-10 bg-white border-b z-10 shrink-0">
          <div className="flex items-center gap-8">
            <div className="bg-zinc-900 flex items-center justify-center h-12 w-12 rounded-[1.25rem] text-white font-black text-xl shadow-lg ring-4 ring-zinc-50">CV</div>
            <div className="flex flex-col">
               <div className="flex items-center gap-3">
                 <h1 className="text-base font-black truncate max-w-[300px] leading-tight tracking-tight text-zinc-900">{meetingData?.name || 'Session'}</h1>
                 <Button variant="ghost" size="icon" onClick={copyInviteLink} className="h-8 w-8 rounded-lg text-zinc-400 hover:text-primary hover:bg-primary/5"><LinkIcon className="h-4 w-4" /></Button>
               </div>
               <p className="text-[10px] text-zinc-400 font-black uppercase tracking-[0.25em] mt-1">{screenSharerId ? 'Presentation Active' : 'Live Room'}</p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3 bg-zinc-50 border border-zinc-100 rounded-[1.25rem] px-5 py-3 text-xs font-black text-zinc-600 shadow-sm"><Timer className="h-4 w-4 text-primary" /> {elapsedTime}</div>
            {isHost ? (
              <Button onClick={() => updateDoc(meetingRef!, { status: 'finished', endedAt: serverTimestamp() })} variant="destructive" className="rounded-[1.25rem] h-14 px-10 font-black uppercase text-xs tracking-widest shadow-lg bg-[#FF4545] border-none">End Session</Button>
            ) : (
              <Button onClick={() => router.push('/dashboard')} variant="outline" className="rounded-[1.25rem] h-14 px-10 font-black uppercase text-xs tracking-widest border-zinc-200">Leave</Button>
            )}
          </div>
        </header>

        <main className="flex-1 flex overflow-hidden p-8 gap-8 relative">
          <div className="flex-1 flex flex-col gap-8 overflow-hidden relative">
            <div className="flex-1 bg-[#121212] rounded-[3.5rem] relative overflow-hidden shadow-2xl border border-white/5 p-4">
               <div className="w-full h-full flex items-center justify-center">
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

              {(screenSharerId || !isVideoOff) && (
                <div className="absolute bottom-12 right-12 w-64 aspect-video rounded-3xl overflow-hidden border-4 border-white shadow-2xl z-40 bg-zinc-900 ring-1 ring-black/10 transition-all duration-500 hover:scale-110">
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

            <div className="h-28 mx-auto w-fit bg-white rounded-[3rem] border border-zinc-100 shadow-xl flex items-center px-10 gap-4 shrink-0 -mt-14 z-20">
               <Button variant={isAudioMuted ? "destructive" : "secondary"} size="icon" onClick={handleToggleAudio} className={cn("rounded-2xl h-16 w-16 shadow-lg transition-all", isAudioMuted ? "bg-[#FF4545] scale-110" : "bg-zinc-100")}>{isAudioMuted ? <MicOff className="h-7 w-7 text-white" /> : <Mic className="h-7 w-7 text-zinc-700" />}</Button>
               <Button variant={isVideoOff ? "destructive" : "secondary"} size="icon" onClick={handleToggleVideo} disabled={isProcessing} className={cn("rounded-2xl h-16 w-16 shadow-lg transition-all", isVideoOff ? "bg-[#FF4545] scale-110" : "bg-zinc-100")}>{isVideoOff ? <VideoOff className="h-7 w-7 text-white" /> : <VideoIcon className="h-7 w-7 text-zinc-700" />}</Button>
               <Separator orientation="vertical" className="h-12 mx-2" />
               <Button variant={isSharingScreen ? "default" : "secondary"} size="icon" onClick={isSharingScreen ? stopScreenShare : startScreenShare} className={cn("rounded-2xl h-16 w-16 shadow-lg transition-all", isSharingScreen ? "bg-primary" : "bg-zinc-50")}>{isSharingScreen ? <StopCircle className="h-7 w-7 text-white" /> : <ScreenShare className="h-7 w-7 text-zinc-700" />}</Button>
               <Button variant={hasHandRaised ? "default" : "secondary"} size="icon" onClick={() => { setHasHandRaised(!hasHandRaised); syncPresence({ hasRaisedHand: !hasHandRaised }); }} className={cn("rounded-2xl h-16 w-16 shadow-lg transition-all", hasHandRaised ? "bg-yellow-400 scale-110" : "bg-zinc-50")}><Hand className="h-7 w-7 text-zinc-700" /></Button>
               <Button variant="secondary" size="icon" className="rounded-2xl h-16 w-16 bg-zinc-50"><MoreVertical className="h-7 w-7 text-zinc-700" /></Button>
            </div>
          </div>

          <Card className="w-[400px] flex flex-col overflow-hidden border-zinc-100 shadow-xl shrink-0 rounded-[3.5rem] bg-white border-none">
             <Tabs defaultValue="chat" className="flex-1 flex flex-col overflow-hidden">
                <div className="px-8 pt-10 pb-4 border-b">
                   <TabsList className="w-full h-14 grid grid-cols-2 rounded-2xl bg-zinc-100/80 p-1">
                      <TabsTrigger value="chat" className="rounded-xl font-black text-[10px] uppercase tracking-widest"><MessageSquare className="h-4 w-4 mr-2" /> Chat</TabsTrigger>
                      <TabsTrigger value="participants" className="rounded-xl font-black text-[10px] uppercase tracking-widest"><Users className="h-4 w-4 mr-2" /> People</TabsTrigger>
                   </TabsList>
                </div>

                <TabsContent value="chat" className="flex-1 flex flex-col overflow-hidden mt-0">
                   <ScrollArea className="flex-1 p-8">
                      <div className="space-y-6">
                         {chatMessages?.map((msg) => (
                           <div key={msg.id} className={cn("flex flex-col gap-1.5", msg.senderId === user?.uid ? "items-end" : "items-start")}>
                              <div className="text-[9px] font-black text-zinc-400 px-2 uppercase tracking-widest">{msg.senderName}</div>
                              <div className={cn("max-w-[85%] px-5 py-3.5 rounded-2xl text-[12px] font-bold shadow-sm", msg.senderId === user?.uid ? "bg-zinc-900 text-white" : "bg-zinc-50 text-zinc-800")}>{msg.text}</div>
                           </div>
                         ))}
                      </div>
                   </ScrollArea>
                   <div className="p-6 border-t">
                      <div className="relative flex items-center">
                        <Input 
                          placeholder="Type message..." 
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
                          className="pr-12 rounded-2xl h-12 bg-zinc-50 border-none font-medium text-sm" 
                        />
                        <Button size="icon" variant="ghost" className="absolute right-1 top-1/2 -translate-y-1/2 h-10 w-10 rounded-xl" onClick={() => {
                          if (chatInput.trim() && firestore && user) {
                            addDoc(collection(firestore, 'meetings', meetingId, 'chat'), { 
                              senderId: user.uid, 
                              senderName: user.displayName || user.email?.split('@')[0], 
                              text: chatInput, 
                              createdAt: serverTimestamp() 
                            });
                            setChatInput('');
                          }
                        }}><Send className="h-4 w-4 text-zinc-400" /></Button>
                      </div>
                   </div>
                </TabsContent>

                <TabsContent value="participants" className="flex-1 flex flex-col overflow-hidden mt-0">
                   <ScrollArea className="flex-1 p-6">
                      <div className="space-y-3">
                        {activeParticipants.map(p => (
                          <div key={p.id} className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                             <div className="flex items-center gap-3">
                                <div className="h-8 w-8 rounded-full bg-zinc-200 flex items-center justify-center text-[10px] font-black uppercase">
                                  {p.name.substring(0, 2)}
                                </div>
                                <span className="text-xs font-black text-zinc-900">{p.name} {p.id === user?.uid && "(You)"}</span>
                             </div>
                             <div className="flex gap-2">
                                {p.isMuted && <MicOff className="h-3 w-3 text-destructive" />}
                                {p.isVideoOff && <VideoOff className="h-3 w-3 text-destructive" />}
                                {p.hasRaisedHand && <Hand className="h-3 w-3 text-yellow-500 animate-bounce" />}
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
