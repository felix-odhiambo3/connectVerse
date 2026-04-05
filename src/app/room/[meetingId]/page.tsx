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
import { Mic, MicOff, Video as VideoIcon, VideoOff, Timer, Send, Hand, User as UserIcon, AlertCircle, RefreshCcw, MessageSquare, Users, Trophy } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { cn } from "@/lib/utils";
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from '@/components/ui/skeleton';
import { updateDocumentNonBlocking, setDocumentNonBlocking } from '@/firebase/non-blocking-updates';

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

function RemoteStream({ stream, name, isMuted, isVideoOff, isMe, isFeatured }: { stream: MediaStream | null, name: string, isMuted?: boolean, isVideoOff?: boolean, isMe?: boolean, isFeatured?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(e => {});
    }
  }, [stream]);

  return (
    <div className={cn("relative w-full h-full bg-[#1A1A1A] rounded-[2.5rem] overflow-hidden border border-white/5 shadow-2xl flex items-center justify-center transition-all", isFeatured && "ring-1 ring-white/10")}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isMe}
        className={cn("w-full h-full object-cover transition-opacity duration-700", (isVideoOff && !isMe) ? "opacity-0" : "opacity-100")}
      />
      {(isVideoOff && !isMe) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#121212] z-10">
           <div className="rounded-full bg-[#1E1E1E] flex items-center justify-center w-24 h-24 shadow-2xl border border-white/5 mb-6">
              <UserIcon className="text-zinc-700 h-10 w-10" />
           </div>
           <div className="text-zinc-500 font-black tracking-[0.3em] uppercase text-[10px] opacity-60">Camera Off</div>
        </div>
      )}
      <div className="absolute bottom-6 left-6 flex items-center gap-3 z-20">
        <Badge variant="secondary" className="bg-black/60 text-white backdrop-blur-xl border-white/10 px-4 py-2 font-black text-[11px] uppercase tracking-wider rounded-xl">
          {name} {isMe && "(You)"}
        </Badge>
        {isMuted && <div className="p-2 bg-[#FF4545] rounded-xl shadow-xl border border-white/20"><MicOff className="h-3.5 w-3.5 text-white" /></div>}
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
  const [hasHandRaised, setHasHandRaised] = useState(false);
  const [elapsedTime, setElapsedTime] = useState('00:00:00');
  const [chatInput, setChatInput] = useState('');
  const [isProcessingAttendance, setIsProcessingAttendance] = useState(false);
  const [isTogglingVideo, setIsTogglingVideo] = useState(false);
  const [hasMediaPermission, setHasMediaPermission] = useState<boolean | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());

  const localStreamRef = useRef<MediaStream | null>(null);
  const isInitializingRef = useRef(false);
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

  const participantsRef = useMemoFirebase(() => {
    if (!firestore || !meetingId || !user) return null;
    // QUOTA: Limiting real-time list to stay within Spark plan bounds
    return query(collection(firestore, 'meetings', meetingId, 'participants'), limit(3));
  }, [firestore, meetingId, user]);

  const { data: participants } = useCollection<Participant>(participantsRef);

  const chatRef = useMemoFirebase(() => {
    if (!firestore || !meetingId || !user) return null;
    // QUOTA: Extreme limitation for chat history
    return query(collection(firestore, 'meetings', meetingId, 'chat'), orderBy('createdAt', 'desc'), limit(3));
  }, [firestore, meetingId, user]);

  const { data: rawChatMessages } = useCollection<ChatMessage>(chatRef);
  const chatMessages = useMemo(() => rawChatMessages ? [...rawChatMessages].reverse() : [], [rawChatMessages]);

  const activeParticipants = useMemo(() => {
    if (!participants) return [];
    // Only mesh the 2 most active to save massive quota/CPU
    return participants.filter(p => p.role !== 'left' && p.role !== 'waiting').slice(0, 2);
  }, [participants]);

  const activeParticipantIds = useMemo(() => activeParticipants.map(p => p.id).sort().join(','), [activeParticipants]);

  const featuredParticipant = useMemo(() => {
    if (!activeParticipants.length) return null;
    return activeParticipants[0];
  }, [activeParticipants]);

  // Event-driven presence sync (No re-render loops)
  const syncPresence = useCallback((updates: Partial<Participant>, isInitial = false) => {
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

  // One-time initialization of presence
  useEffect(() => {
    if (!user || !meetingId || !firestore || isMeetingLoading || !meetingData || initialPresenceSynced.current) return;
    syncPresence({ isMuted: true, isVideoOff: true, hasRaisedHand: false }, true);
    initialPresenceSynced.current = true;
  }, [user?.uid, meetingId, !!meetingData, isMeetingLoading, syncPresence]);

  const initMedia = useCallback(async (isMounted: boolean) => {
    if (isInitializingRef.current || localStreamRef.current) return;
    isInitializingRef.current = true;
    
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (error: any) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (error2: any) {
        if (isMounted) setHasMediaPermission(false);
        isInitializingRef.current = false;
        return;
      }
    }

    if (!isMounted && stream) {
      stream.getTracks().forEach(t => t.stop());
      isInitializingRef.current = false;
      return;
    }

    if (stream) {
      stream.getAudioTracks().forEach(track => { track.enabled = false; });
      stream.getVideoTracks().forEach(track => { track.enabled = false; track.stop(); });
      localStreamRef.current = stream;
      setHasMediaPermission(true);
    }
    isInitializingRef.current = false;
  }, []);

  useEffect(() => {
    let isMounted = true;
    initMedia(isMounted);
    return () => {
      isMounted = false;
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      pcs.current.forEach(pc => pc.close());
      signalingUnsubs.current.forEach(unsub => unsub());
    };
  }, [initMedia]);

  const handleToggleVideo = async () => {
    if (!localStreamRef.current || isTogglingVideo || !user) return;
    setIsTogglingVideo(true);
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
    setIsTogglingVideo(false);
  };

  const handleToggleAudio = () => {
    if (!localStreamRef.current) return;
    const newState = !isAudioMuted;
    setIsAudioMuted(newState);
    localStreamRef.current.getAudioTracks().forEach(t => t.enabled = !newState);
    syncPresence({ isMuted: newState });
  };

  const handleToggleHand = () => {
    const newState = !hasHandRaised;
    setHasHandRaised(newState);
    syncPresence({ hasRaisedHand: newState });
  };

  // WebRTC Signaling Logic (Robust Glare Handling & Atomic Writes)
  useEffect(() => {
    if (!user || !firestore || !meetingId || !hasMediaPermission || !activeParticipantIds) return;

    const currentIds = activeParticipantIds.split(',').filter(id => id && id !== user.uid);
    const currentIdSet = new Set(currentIds);

    // Cleanup stale peer connections
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

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          pc.addTrack(track, localStreamRef.current!);
        });
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

      // Buffer candidates for atomic transmission
      let iceCandidates: RTCIceCandidateInit[] = [];
      pc.onicecandidate = (event) => {
        if (event.candidate) iceCandidates.push(event.candidate.toJSON());
      };

      const sendCandidates = () => {
        if (iceCandidates.length > 0) {
          updateDocumentNonBlocking(channelRef, { 
            candidates: arrayUnion(...iceCandidates.map(c => ({ candidate: c, from: user.uid }))) 
          });
          iceCandidates = [];
        }
      };

      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') sendCandidates();
      };
      const gatheringTimeout = setTimeout(sendCandidates, 5000);

      // UID-based polite/impolite pattern to resolve glare
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
          if (!data) return;

          if (data.offer && pc.signalingState === 'stable') {
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
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
      
      return () => clearTimeout(gatheringTimeout);
    });

    return () => {
      signalingUnsubs.current.forEach(unsub => unsub());
      signalingUnsubs.current.clear();
      pcs.current.forEach(pc => pc.close());
      pcs.current.clear();
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

  const endMeetingForAll = async () => {
    if (!isHost || !meetingRef || !firestore) return;
    setIsProcessingAttendance(true);
    updateDoc(meetingRef, { status: 'finished', endedAt: serverTimestamp() })
      .finally(() => setIsProcessingAttendance(false));
  };

  if (isMeetingLoading) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-[#F8F9FB] p-8">
        <Skeleton className="h-12 w-3/4 max-w-sm rounded-xl mb-8" />
        <Skeleton className="h-64 w-full max-w-3xl rounded-[3rem]" />
      </div>
    );
  }

  if (!meetingData) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-[#F8F9FB] p-6 text-center">
        <h1 className="text-4xl font-black mb-3 text-zinc-900">Meeting Not Found</h1>
        <Button onClick={() => router.push('/dashboard')}>Back to Dashboard</Button>
      </div>
    );
  }

  if (meetingData?.status === 'finished') {
    return (
      <div className="flex h-screen items-center justify-center bg-[#F8F9FB] p-6">
        <Card className="w-full max-w-md shadow-xl rounded-[3rem] text-center p-12 bg-white">
          <Trophy className="h-20 w-20 mx-auto text-primary mb-6" />
          <h2 className="text-3xl font-black mb-4">Meeting Finished</h2>
          <Button className="w-full h-14 rounded-2xl" onClick={() => router.push('/dashboard')}>Back to Dashboard</Button>
        </Card>
      </div>
    );
  }

  return (
    <AuthGuard>
      <div className="flex h-screen w-full flex-col overflow-hidden bg-[#F8F9FB]">
        <header className="flex h-20 items-center justify-between px-10 bg-white border-b z-10 shadow-sm">
          <div className="flex items-center gap-8">
            <div className="bg-zinc-900 flex items-center justify-center h-12 w-12 rounded-[1.25rem] text-white font-black text-xl shadow-lg ring-4 ring-zinc-50">CV</div>
            <div className="flex flex-col">
               <h1 className="text-base font-black truncate max-w-[300px] leading-tight tracking-tight text-zinc-900">{meetingData?.name || 'Session'}</h1>
               <p className="text-[10px] text-zinc-400 font-black uppercase tracking-[0.25em] mt-1">Live Room</p>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3 bg-zinc-50 border border-zinc-100 rounded-[1.25rem] px-5 py-3 text-xs font-black text-zinc-600 shadow-sm"><Timer className="h-4 w-4 text-primary" /> {elapsedTime}</div>
            {isHost ? (
              <Button onClick={endMeetingForAll} variant="destructive" disabled={isProcessingAttendance} className="rounded-[1.25rem] h-14 px-10 font-black uppercase text-xs tracking-widest shadow-lg bg-[#FF4545] hover:bg-red-600 border-none">
                {isProcessingAttendance ? 'Ending...' : 'End Session'}
              </Button>
            ) : (
              <Button onClick={() => router.push('/dashboard')} variant="outline" className="rounded-[1.25rem] h-14 px-10 font-black uppercase text-xs tracking-widest border-zinc-200">Leave</Button>
            )}
          </div>
        </header>

        <main className="flex-1 flex overflow-hidden p-8 gap-8 relative">
          <div className="flex-1 flex flex-col gap-8 overflow-hidden">
            <div className="flex-1 bg-[#121212] rounded-[3.5rem] relative overflow-hidden shadow-2xl border border-white/5">
               <div className="w-full h-full flex items-center justify-center p-8">
                 {featuredParticipant ? (
                   <div className="w-full h-full max-w-[1400px] mx-auto">
                     <RemoteStream 
                       stream={featuredParticipant.id === user?.uid ? localStreamRef.current : remoteStreams.get(featuredParticipant.id) || null} 
                       name={featuredParticipant.name} 
                       isMe={featuredParticipant.id === user?.uid} 
                       isMuted={featuredParticipant.isMuted} 
                       isVideoOff={featuredParticipant.isVideoOff}
                       isFeatured={true}
                     />
                   </div>
                 ) : (
                   <div className="text-zinc-700 font-black uppercase tracking-[1em] animate-pulse text-[10px]">Connecting...</div>
                 )}
               </div>
              {hasMediaPermission === false && (
                <div className="absolute inset-0 flex items-center justify-center bg-[#121212]/98 z-30 px-10">
                  <div className="max-w-md w-full text-center text-white">
                    <AlertCircle className="h-14 w-14 text-[#FF4545] mx-auto mb-6" />
                    <h2 className="text-3xl font-black mb-4">Access Required</h2>
                    <Button variant="secondary" className="w-full h-16 rounded-[1.5rem]" onClick={() => window.location.reload()}><RefreshCcw className="mr-4 h-5 w-5" /> Retry</Button>
                  </div>
                </div>
              )}
            </div>

            <div className="h-28 mx-auto w-fit bg-white rounded-[3rem] border border-zinc-100 shadow-xl flex items-center px-12 gap-6 shrink-0 -mt-14 z-20">
               <Button variant={isAudioMuted ? "destructive" : "secondary"} size="icon" onClick={handleToggleAudio} className={cn("rounded-2xl h-16 w-16 shadow-lg", isAudioMuted ? "bg-[#FF4545]" : "bg-zinc-100")}>{isAudioMuted ? <MicOff className="h-7 w-7 text-white" /> : <Mic className="h-7 w-7 text-zinc-700" />}</Button>
               <Button variant={isVideoOff ? "destructive" : "secondary"} size="icon" onClick={handleToggleVideo} disabled={isTogglingVideo} className={cn("rounded-2xl h-16 w-16 shadow-lg", isVideoOff ? "bg-[#FF4545]" : "bg-zinc-100")}>{isVideoOff ? <VideoOff className="h-7 w-7 text-white" /> : <VideoIcon className="h-7 w-7 text-zinc-700" />}</Button>
               <Separator orientation="vertical" className="h-12 mx-4" />
               <Button variant={hasHandRaised ? "default" : "secondary"} size="icon" onClick={handleToggleHand} className={cn("rounded-2xl h-16 w-16 shadow-lg", hasHandRaised ? "bg-yellow-400" : "bg-zinc-50")}><Hand className="h-7 w-7" /></Button>
            </div>
          </div>

          <Card className="w-[420px] flex flex-col overflow-hidden border-zinc-100 shadow-xl shrink-0 rounded-[3.5rem] bg-white border-none">
             <Tabs defaultValue="participants" className="flex-1 flex flex-col overflow-hidden">
                <div className="px-8 pt-10 pb-4 border-b">
                   <TabsList className="w-full h-16 grid grid-cols-2 rounded-[1.5rem] bg-zinc-100/80 p-1.5 shadow-inner">
                      <TabsTrigger value="participants" className="rounded-2xl font-black text-[11px] uppercase tracking-widest"><Users className="h-4 w-4 mr-2" /> Members</TabsTrigger>
                      <TabsTrigger value="chat" className="rounded-2xl font-black text-[11px] uppercase tracking-widest"><MessageSquare className="h-4 w-4 mr-2" /> Chat</TabsTrigger>
                   </TabsList>
                </div>

                <TabsContent value="participants" className="flex-1 flex flex-col overflow-hidden mt-0">
                   <ScrollArea className="flex-1 p-8">
                      <div className="space-y-6">
                        {participants?.filter(p => p.role !== 'waiting' && p.role !== 'left').map(p => (
                          <div key={p.id} className="flex items-center gap-5 p-4 rounded-[2rem] hover:bg-zinc-50">
                             <Avatar className="h-16 w-16 border-4 border-white shadow-xl">
                                <AvatarFallback className="bg-zinc-100 text-zinc-900 font-black text-sm">{p.name?.[0] || '?'}</AvatarFallback>
                             </Avatar>
                             <div className="flex-1 min-w-0">
                                <div className="text-sm font-black truncate text-zinc-900 tracking-tight">{p.name}</div>
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
                      <div className="space-y-6">
                         {chatMessages?.map((msg) => (
                           <div key={msg.id} className={cn("flex flex-col gap-2", msg.senderId === user?.uid ? "items-end" : "items-start")}>
                              <div className="text-[10px] font-black text-zinc-400 px-3 uppercase">{msg.senderName}</div>
                              <div className={cn("max-w-[90%] px-6 py-4 rounded-[1.5rem] text-[13px] font-bold shadow-sm", msg.senderId === user?.uid ? "bg-zinc-900 text-white" : "bg-zinc-50 text-zinc-800 border")}>{msg.text}</div>
                           </div>
                         ))}
                      </div>
                   </ScrollArea>
                   <div className="p-8 border-t">
                      <div className="relative flex items-center">
                        <Input placeholder="Message..." value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => {
                          if (e.key === 'Enter' && chatInput.trim() && firestore && user) {
                            addDoc(collection(firestore, 'meetings', meetingId, 'chat'), { 
                              senderId: user.uid, 
                              senderName: user.displayName || user.email?.split('@')[0], 
                              text: chatInput, 
                              createdAt: serverTimestamp() 
                            });
                            setChatInput('');
                          }
                        }} className="pr-16 rounded-[2rem] h-14 bg-zinc-50 border-zinc-100" />
                        <Button size="icon" variant="ghost" className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => {
                          if (chatInput.trim() && firestore && user) {
                            addDoc(collection(firestore, 'meetings', meetingId, 'chat'), { 
                              senderId: user.uid, 
                              senderName: user.displayName || user.email?.split('@')[0], 
                              text: chatInput, 
                              createdAt: serverTimestamp() 
                            });
                            setChatInput('');
                          }
                        }}><Send className="h-5 w-5" /></Button>
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