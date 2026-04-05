
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
  setDoc,
  Timestamp,
  onSnapshot,
  limit,
  arrayUnion,
} from 'firebase/firestore';
import AuthGuard from '@/components/auth/AuthGuard';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
  AlertCircle, 
  RefreshCcw, 
  MessageSquare, 
  Users, 
  Trophy,
  ScreenShare,
  StopCircle,
  Monitor,
  Layout,
  Maximize2
} from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { cn } from "@/lib/utils";
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from '@/components/ui/skeleton';
import { updateDocumentNonBlocking, setDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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
  ],
};

function formatDuration(seconds: number) {
  if (isNaN(seconds) || seconds < 0) return '00:00:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
}

function RemoteStream({ stream, name, isMuted, isVideoOff, isMe, isPresenting }: { stream: MediaStream | null, name: string, isMuted?: boolean, isVideoOff?: boolean, isMe?: boolean, isPresenting?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(e => {});
    }
  }, [stream]);

  return (
    <div className={cn(
      "relative w-full h-full bg-[#1A1A1A] rounded-[2rem] overflow-hidden border border-white/5 shadow-2xl flex items-center justify-center transition-all duration-500",
      isPresenting && "ring-2 ring-primary/50"
    )}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isMe}
        className={cn(
          "w-full h-full transition-all duration-700",
          isPresenting ? "object-contain" : "object-cover",
          (isVideoOff && !isMe && !isPresenting) ? "opacity-0" : "opacity-100"
        )}
      />
      {(isVideoOff && !isMe && !isPresenting) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#121212] z-10">
           <div className="rounded-full bg-[#1E1E1E] flex items-center justify-center w-24 h-24 shadow-2xl border border-white/5 mb-6">
              <UserIcon className="text-zinc-700 h-10 w-10" />
           </div>
           <div className="text-zinc-500 font-black tracking-[0.3em] uppercase text-[10px] opacity-60">Camera Off</div>
        </div>
      )}
      <div className="absolute bottom-6 left-6 flex items-center gap-3 z-20">
        <Badge variant="secondary" className="bg-black/60 text-white backdrop-blur-xl border-white/10 px-4 py-2 font-black text-[11px] uppercase tracking-wider rounded-xl">
          {isPresenting && <Monitor className="h-3 w-3 mr-2 text-primary" />}
          {name} {isMe && "(You)"} {isPresenting && "is presenting"}
        </Badge>
        {isMuted && !isPresenting && <div className="p-2 bg-[#FF4545] rounded-xl shadow-xl border border-white/20"><MicOff className="h-3.5 w-3.5 text-white" /></div>}
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
  const [hasMediaPermission, setHasMediaPermission] = useState<boolean | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());

  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const pcs = useRef<Map<string, RTCPeerConnection>>(new Map());
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
    return query(collection(firestore, 'meetings', meetingId, 'participants'), limit(10));
  }, [firestore, meetingId, user]);

  const { data: participants } = useCollection<Participant>(participantsRef);

  const chatRef = useMemoFirebase(() => {
    if (!firestore || !meetingId || !user) return null;
    return query(collection(firestore, 'meetings', meetingId, 'chat'), orderBy('createdAt', 'desc'), limit(10));
  }, [firestore, meetingId, user]);

  const { data: rawChatMessages } = useCollection<ChatMessage>(chatRef);
  const chatMessages = useMemo(() => rawChatMessages ? [...rawChatMessages].reverse() : [], [rawChatMessages]);

  const activeParticipants = useMemo(() => {
    if (!participants) return [];
    // Prioritize the screen sharer and host in the mesh grid
    return participants
      .filter(p => p.role !== 'left' && p.role !== 'waiting')
      .sort((a, b) => {
        if (a.id === screenSharerId) return -1;
        if (b.id === screenSharerId) return 1;
        if (a.id === hostId) return -1;
        if (b.id === hostId) return 1;
        return 0;
      })
      .slice(0, 3);
  }, [participants, screenSharerId, hostId]);

  const activeParticipantIds = useMemo(() => activeParticipants.map(p => p.id).sort().join(','), [activeParticipants]);

  const featuredParticipant = useMemo(() => {
    if (screenSharerId) {
      return participants?.find(p => p.id === screenSharerId) || null;
    }
    if (!activeParticipants.length) return null;
    return activeParticipants[0];
  }, [activeParticipants, screenSharerId, participants]);

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

  const initMedia = useCallback(async (isMounted: boolean) => {
    if (localStreamRef.current) return;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (!isMounted) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      stream.getTracks().forEach(track => { track.enabled = false; });
      localStreamRef.current = stream;
      setHasMediaPermission(true);
    } catch (error: any) {
      if (isMounted) setHasMediaPermission(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    initMedia(isMounted);
    return () => {
      isMounted = false;
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      pcs.current.forEach(pc => pc.close());
      signalingUnsubs.current.forEach(unsub => unsub());
    };
  }, [initMedia]);

  const handleToggleVideo = async () => {
    if (!localStreamRef.current || isProcessing || !user) return;
    setIsProcessing(true);
    const newState = !isVideoOff;
    
    if (!newState) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        const newTrack = stream.getVideoTracks()[0];
        localStreamRef.current.getVideoTracks().forEach(t => { localStreamRef.current?.removeTrack(t); t.stop(); });
        localStreamRef.current.addTrack(newTrack);
        
        pcs.current.forEach(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video');
          if (sender) sender.replaceTrack(newTrack);
        });
        setIsVideoOff(false);
        syncPresence({ isVideoOff: false });
      } catch (err) {
        toast({ variant: 'destructive', title: 'Camera Error' });
      }
    } else {
      localStreamRef.current.getVideoTracks().forEach(track => { track.enabled = false; track.stop(); });
      setIsVideoOff(true);
      syncPresence({ isVideoOff: true });
    }
    setIsProcessing(false);
  };

  const startScreenShare = async () => {
    if (!user || !firestore || screenSharerId) {
      if (screenSharerId) toast({ title: "Someone is already presenting" });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ 
        video: { cursor: "always" } as any, 
        audio: true 
      });
      
      screenStreamRef.current = stream;
      const screenTrack = stream.getVideoTracks()[0];

      // Replace video tracks for all peers
      pcs.current.forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(screenTrack);
      });

      // Update Firestore state
      await updateDoc(doc(firestore, 'meetings', meetingId), { 
        screenSharerId: user.uid 
      });

      setIsSharingScreen(true);
      
      screenTrack.onended = () => {
        stopScreenShare();
      };

      toast({ title: "You are presenting" });
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Could not share screen' });
    }
  };

  const stopScreenShare = async () => {
    if (!user || !firestore) return;
    
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    setIsSharingScreen(false);

    // Restore camera track if camera was supposed to be on
    if (!isVideoOff && localStreamRef.current) {
      const camTrack = localStreamRef.current.getVideoTracks()[0];
      if (camTrack) {
        pcs.current.forEach(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video');
          if (sender) sender.replaceTrack(camTrack);
        });
      }
    }

    await updateDoc(doc(firestore, 'meetings', meetingId), { 
      screenSharerId: null 
    });
    
    toast({ title: "Presentation ended" });
  };

  const handleToggleAudio = () => {
    if (!localStreamRef.current) return;
    const newState = !isAudioMuted;
    setIsAudioMuted(newState);
    localStreamRef.current.getAudioTracks().forEach(t => t.enabled = !newState);
    syncPresence({ isMuted: newState });
  };

  // WebRTC Signaling Logic
  useEffect(() => {
    if (!user || !firestore || !meetingId || !hasMediaPermission || !activeParticipantIds) return;

    const currentIds = activeParticipantIds.split(',').filter(id => id && id !== user.uid);
    const currentIdSet = new Set(currentIds);

    pcs.current.forEach((pc, id) => {
      if (!currentIdSet.has(id)) {
        signalingUnsubs.current.get(`${id}_channel`)?.();
        signalingUnsubs.current.delete(`${id}_channel`);
        pc.close();
        pcs.current.delete(id);
        setRemoteStreams(prev => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
      }
    });

    currentIds.forEach(async (participantId) => {
      if (pcs.current.has(participantId)) return;

      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcs.current.set(participantId, pc);

      const streamToUse = isSharingScreen ? screenStreamRef.current : localStreamRef.current;
      if (streamToUse) {
        streamToUse.getTracks().forEach(track => pc.addTrack(track, streamToUse));
      }

      pc.ontrack = (event) => {
        setRemoteStreams(prev => {
          const next = new Map(prev);
          next.set(participantId, event.streams[0]);
          return next;
        });
      };

      const channelId = [user.uid, participantId].sort().join('_');
      const channelRef = doc(firestore, 'meetings', meetingId, 'webrtc', channelId);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          updateDocumentNonBlocking(channelRef, { 
            candidates: arrayUnion({ candidate: event.candidate.toJSON(), from: user.uid }) 
          });
        }
      };

      const isImpolite = user.uid < participantId;

      if (isImpolite) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        setDocumentNonBlocking(channelRef, { offer: { type: offer.type, sdp: offer.sdp }, from: user.uid }, { merge: true });

        const unsubChannel = onSnapshot(channelRef, async (snapshot) => {
          const data = snapshot.data();
          if (!data) return;
          if (data.answer && pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer)).catch(() => {});
          }
          if (data.candidates && pc.remoteDescription) {
            data.candidates.forEach((cand: any) => {
              if (cand.from !== user.uid) pc.addIceCandidate(new RTCIceCandidate(cand.candidate)).catch(() => {});
            });
          }
        });
        signalingUnsubs.current.set(`${participantId}_channel`, unsubChannel);
      } else {
        const unsubChannel = onSnapshot(channelRef, async (snapshot) => {
          const data = snapshot.data();
          if (!data || !data.offer) return;
          if (pc.signalingState === 'stable') {
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer)).catch(() => {});
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            updateDocumentNonBlocking(channelRef, { answer: { type: answer.type, sdp: answer.sdp } });
          }
          if (data.candidates && pc.remoteDescription) {
            data.candidates.forEach((cand: any) => {
              if (cand.from !== user.uid) pc.addIceCandidate(new RTCIceCandidate(cand.candidate)).catch(() => {});
            });
          }
        });
        signalingUnsubs.current.set(`${participantId}_channel`, unsubChannel);
      }
    });

    return () => {
      signalingUnsubs.current.forEach(unsub => unsub());
    };
  }, [user?.uid, firestore, meetingId, activeParticipantIds, hasMediaPermission]);

  useEffect(() => {
    if (!meetingData?.createdAt || meetingData.status === 'finished') {
      setElapsedTime('00:00:00');
      return;
    }
    const interval = setInterval(() => {
      const diff = Math.max(0, Date.now() - meetingData.createdAt.seconds * 1000);
      setElapsedTime(formatDuration(diff / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [meetingData?.createdAt, meetingData?.status]);

  if (isMeetingLoading) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-[#F8F9FB] p-8">
        <Skeleton className="h-12 w-3/4 max-w-sm rounded-xl mb-8" />
        <Skeleton className="h-64 w-full max-w-3xl rounded-[3rem]" />
      </div>
    );
  }

  if (!meetingData || meetingData?.status === 'finished') {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-[#F8F9FB] p-6 text-center">
         <Trophy className="h-20 w-20 text-primary mb-6" />
        <h1 className="text-4xl font-black mb-3 text-zinc-900">{meetingData?.status === 'finished' ? 'Session Completed' : 'Meeting Not Found'}</h1>
        <Button onClick={() => router.push('/dashboard')} className="rounded-2xl h-14 px-10">Back to Dashboard</Button>
      </div>
    );
  }

  return (
    <AuthGuard>
      <div className="flex h-screen w-full flex-col overflow-hidden bg-[#F8F9FB]">
        {isSharingScreen && (
          <div className="bg-primary px-8 py-3 flex items-center justify-between text-white animate-in slide-in-from-top duration-300">
             <div className="flex items-center gap-3">
                <div className="bg-white/20 p-2 rounded-lg animate-pulse"><Monitor className="h-4 w-4" /></div>
                <span className="font-black text-[11px] uppercase tracking-widest">You are presenting to everyone</span>
             </div>
             <Button variant="ghost" size="sm" onClick={stopScreenShare} className="text-white hover:bg-white/20 font-black uppercase text-[10px] tracking-widest border border-white/30 rounded-lg">Stop Presenting</Button>
          </div>
        )}

        <header className="flex h-20 items-center justify-between px-10 bg-white border-b z-10 shadow-sm shrink-0">
          <div className="flex items-center gap-8">
            <div className="bg-zinc-900 flex items-center justify-center h-12 w-12 rounded-[1.25rem] text-white font-black text-xl shadow-lg ring-4 ring-zinc-50">CV</div>
            <div className="flex flex-col">
               <h1 className="text-base font-black truncate max-w-[300px] leading-tight tracking-tight text-zinc-900">{meetingData?.name || 'Session'}</h1>
               <p className="text-[10px] text-zinc-400 font-black uppercase tracking-[0.25em] mt-1">{screenSharerId ? 'Presentation Mode' : 'Live Room'}</p>
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
          <div className="flex-1 flex flex-col gap-8 overflow-hidden">
            <div className={cn(
              "flex-1 bg-[#121212] rounded-[3.5rem] relative overflow-hidden shadow-2xl border border-white/5",
              featuredParticipant && "p-8"
            )}>
               <div className="w-full h-full flex items-center justify-center">
                 {featuredParticipant ? (
                   <div className="w-full h-full max-w-[1600px] mx-auto">
                     <RemoteStream 
                       stream={featuredParticipant.id === user?.uid ? (isSharingScreen ? screenStreamRef.current : localStreamRef.current) : remoteStreams.get(featuredParticipant.id) || null} 
                       name={featuredParticipant.name} 
                       isMe={featuredParticipant.id === user?.uid} 
                       isMuted={featuredParticipant.isMuted} 
                       isVideoOff={featuredParticipant.isVideoOff}
                       isPresenting={featuredParticipant.id === screenSharerId}
                     />
                   </div>
                 ) : (
                   <div className="flex flex-col items-center gap-6">
                      <div className="w-24 h-24 rounded-full bg-zinc-800 animate-pulse flex items-center justify-center">
                        <Users className="h-10 w-10 text-zinc-600" />
                      </div>
                      <div className="text-zinc-700 font-black uppercase tracking-[0.5em] text-[10px]">Waiting for others...</div>
                   </div>
                 )}
               </div>

              {/* Floating Presenter Preview (Self) */}
              {isSharingScreen && featuredParticipant?.id !== user?.uid && (
                <div className="absolute bottom-12 right-12 w-80 aspect-video rounded-3xl overflow-hidden border-4 border-white shadow-2xl z-40 bg-zinc-900 group">
                   <RemoteStream 
                     stream={screenStreamRef.current} 
                     name="Your Screen" 
                     isMe={true} 
                     isPresenting={true}
                   />
                   <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button size="icon" variant="destructive" onClick={stopScreenShare} className="h-10 w-10 rounded-xl"><StopCircle className="h-5 w-5" /></Button>
                   </div>
                </div>
              )}

              {hasMediaPermission === false && (
                <div className="absolute inset-0 flex items-center justify-center bg-[#121212]/98 z-50 px-10 text-center">
                  <div className="max-w-md w-full text-white">
                    <AlertCircle className="h-14 w-14 text-[#FF4545] mx-auto mb-6" />
                    <h2 className="text-3xl font-black mb-4 uppercase tracking-tighter">Camera Access Required</h2>
                    <p className="text-zinc-500 font-medium mb-10">Please enable camera and microphone permissions in your browser to participate in the meeting.</p>
                    <Button variant="secondary" className="w-full h-16 rounded-[1.5rem]" onClick={() => window.location.reload()}><RefreshCcw className="mr-4 h-5 w-5" /> Retry Permission</Button>
                  </div>
                </div>
              )}
            </div>

            <div className="h-28 mx-auto w-fit bg-white rounded-[3rem] border border-zinc-100 shadow-xl flex items-center px-10 gap-4 shrink-0 -mt-14 z-20">
               <Button variant={isAudioMuted ? "destructive" : "secondary"} size="icon" onClick={handleToggleAudio} className={cn("rounded-2xl h-16 w-16 shadow-lg transition-all", isAudioMuted ? "bg-[#FF4545] scale-110" : "bg-zinc-100")}>{isAudioMuted ? <MicOff className="h-7 w-7 text-white" /> : <Mic className="h-7 w-7 text-zinc-700" />}</Button>
               <Button variant={isVideoOff ? "destructive" : "secondary"} size="icon" onClick={handleToggleVideo} disabled={isProcessing || isSharingScreen} className={cn("rounded-2xl h-16 w-16 shadow-lg transition-all", isVideoOff ? "bg-[#FF4545] scale-110" : "bg-zinc-100")}>{isVideoOff ? <VideoOff className="h-7 w-7 text-white" /> : <VideoIcon className="h-7 w-7 text-zinc-700" />}</Button>
               <Separator orientation="vertical" className="h-12 mx-2" />
               <Button variant={isSharingScreen ? "default" : "secondary"} size="icon" onClick={isSharingScreen ? stopScreenShare : startScreenShare} className={cn("rounded-2xl h-16 w-16 shadow-lg transition-all", isSharingScreen ? "bg-primary" : "bg-zinc-50")}>{isSharingScreen ? <StopCircle className="h-7 w-7 text-white" /> : <ScreenShare className="h-7 w-7 text-zinc-700" />}</Button>
               <Button variant={hasHandRaised ? "default" : "secondary"} size="icon" onClick={() => { setHasHandRaised(!hasHandRaised); syncPresence({ hasRaisedHand: !hasHandRaised }); }} className={cn("rounded-2xl h-16 w-16 shadow-lg transition-all", hasHandRaised ? "bg-yellow-400 scale-110" : "bg-zinc-50")}><Hand className="h-7 w-7 text-zinc-700" /></Button>
            </div>
          </div>

          <Card className="w-[420px] flex flex-col overflow-hidden border-zinc-100 shadow-xl shrink-0 rounded-[3.5rem] bg-white border-none">
             <Tabs defaultValue="participants" className="flex-1 flex flex-col overflow-hidden">
                <div className="px-8 pt-10 pb-4 border-b">
                   <TabsList className="w-full h-16 grid grid-cols-2 rounded-[1.5rem] bg-zinc-100/80 p-1.5 shadow-inner">
                      <TabsTrigger value="participants" className="rounded-2xl font-black text-[11px] uppercase tracking-widest"><Users className="h-4 w-4 mr-2" /> Members ({participants?.length || 0})</TabsTrigger>
                      <TabsTrigger value="chat" className="rounded-2xl font-black text-[11px] uppercase tracking-widest"><MessageSquare className="h-4 w-4 mr-2" /> Chat</TabsTrigger>
                   </TabsList>
                </div>

                <TabsContent value="participants" className="flex-1 flex flex-col overflow-hidden mt-0">
                   <ScrollArea className="flex-1 p-8">
                      <div className="space-y-6">
                        {participants?.filter(p => p.role !== 'waiting' && p.role !== 'left').map(p => (
                          <div key={p.id} className={cn("flex items-center gap-5 p-5 rounded-[2.5rem] border transition-all", p.id === user?.uid ? "bg-zinc-50 border-zinc-100" : "bg-white border-transparent hover:bg-zinc-50")}>
                             <div className="relative">
                               <Avatar className="h-16 w-16 border-4 border-white shadow-xl">
                                  <AvatarFallback className="bg-zinc-100 text-zinc-900 font-black text-sm">{p.name?.[0] || '?'}</AvatarFallback>
                               </Avatar>
                               {p.id === screenSharerId && <div className="absolute -top-1 -right-1 bg-primary p-1.5 rounded-lg border-2 border-white shadow-lg text-white"><Monitor className="h-3 w-3" /></div>}
                             </div>
                             <div className="flex-1 min-w-0">
                                <div className="text-sm font-black truncate text-zinc-900 tracking-tight">{p.name} {p.id === user?.uid && "(You)"}</div>
                                <div className="flex items-center gap-4 mt-2">
                                   {p.isMuted ? <MicOff className="h-4 w-4 text-[#FF4545]" /> : <Mic className="h-4 w-4 text-green-500" />}
                                   {p.isVideoOff ? <VideoOff className="h-4 w-4 text-zinc-200" /> : <VideoIcon className="h-4 w-4 text-primary opacity-30" />}
                                </div>
                             </div>
                             {p.hasRaisedHand && <Hand className="h-6 w-6 text-yellow-400 animate-bounce" />}
                          </div>
                        ))}
                      </div>
                   </ScrollArea>
                </TabsContent>

                <TabsContent value="chat" className="flex-1 flex flex-col overflow-hidden mt-0">
                   <ScrollArea className="flex-1 p-10">
                      <div className="space-y-8">
                         {chatMessages?.map((msg) => (
                           <div key={msg.id} className={cn("flex flex-col gap-2", msg.senderId === user?.uid ? "items-end" : "items-start")}>
                              <div className="text-[10px] font-black text-zinc-400 px-3 uppercase tracking-widest">{msg.senderName}</div>
                              <div className={cn("max-w-[90%] px-6 py-4 rounded-[1.75rem] text-[13px] font-bold shadow-sm leading-relaxed", msg.senderId === user?.uid ? "bg-zinc-900 text-white" : "bg-zinc-50 text-zinc-800 border border-zinc-100")}>{msg.text}</div>
                           </div>
                         ))}
                      </div>
                   </ScrollArea>
                   <div className="p-8 border-t">
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
                          className="pr-16 rounded-[2rem] h-14 bg-zinc-50 border-zinc-100 focus:bg-white transition-all font-medium" 
                        />
                        <Button size="icon" variant="ghost" className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-xl hover:bg-zinc-200" onClick={() => {
                          if (chatInput.trim() && firestore && user) {
                            addDoc(collection(firestore, 'meetings', meetingId, 'chat'), { 
                              senderId: user.uid, 
                              senderName: user.displayName || user.email?.split('@')[0], 
                              text: chatInput, 
                              createdAt: serverTimestamp() 
                            });
                            setChatInput('');
                          }
                        }}><Send className="h-5 w-5 text-zinc-600" /></Button>
                      </div>
                   </div>
                </TabsContent>
             </Tabs>
          </Card>
        </main>
      </div>
    </AuthGuard>
  );
}
