
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
  increment,
  writeBatch,
  setDoc,
  Timestamp,
  onSnapshot,
  limit,
} from 'firebase/firestore';
import { format } from 'date-fns';
import AuthGuard from '@/components/auth/AuthGuard';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { Mic, MicOff, Video as VideoIcon, VideoOff, ScreenShare, ScreenShareOff, Timer, Send, Hand, Share2, Shield, User as UserIcon, Smile, BarChart3, Trophy, Frown, AlertCircle, RefreshCcw, Lock, Unlock, MessageSquare, Users, BookOpen, Download, UserMinus, Star } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Participant {
  id: string;
  name: string;
  joinedAt: Timestamp | null;
  activeSegmentStart?: Timestamp | null;
  totalDuration?: number;
  role: 'host' | 'co-host' | 'participant' | 'waiting' | 'left';
  hasRaisedHand?: boolean;
  isMuted?: boolean;
  isVideoOff?: boolean;
  lastReaction?: string;
  lastReactionAt?: Timestamp;
  remoteMuteRequestAt?: Timestamp;
  remoteUnmuteRequestAt?: Timestamp;
}

interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: Timestamp;
}

interface CumulativeStats {
  attendedHours: number;
  sessionsAttended: number;
}

interface FloatingReaction {
  id: string;
  emoji: string;
  userName: string;
  left: number;
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

function RemoteStream({ stream, name, isMuted, isVideoOff, isMe, isFeatured }: { stream: MediaStream | null, name: string, isMuted?: boolean, isVideoOff?: boolean, isMe?: boolean, isFeatured?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(e => {});
    }
  }, [stream]);

  return (
    <div className={cn("relative w-full h-full bg-[#1A1A1A] rounded-[2.5rem] overflow-hidden group border border-white/5 shadow-2xl flex items-center justify-center transition-all", isFeatured && "ring-1 ring-white/10")}>
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
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [hasHandRaised, setHasHandRaised] = useState(false);
  const [elapsedTime, setElapsedTime] = useState('00:00:00');
  const [chatInput, setChatInput] = useState('');
  const [showSummary, setShowSummary] = useState(false);
  const [isProcessingAttendance, setIsProcessingAttendance] = useState(false);
  const [isTogglingVideo, setIsTogglingVideo] = useState(false);
  const [currentTime, setCurrentTime] = useState(Date.now() / 1000);
  const [floatingReaction, setFloatingReaction] = useState<FloatingReaction | null>(null);
  const [isReactionOpen, setIsReactionOpen] = useState(false);
  const [hasMediaPermission, setHasMediaPermission] = useState<boolean | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());

  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const isInitializingRef = useRef(false);
  const lastProcessedRemoteMuteAt = useRef<number>(0);
  const pcs = useRef<Map<string, RTCPeerConnection>>(new Map());
  const signalingUnsubs = useRef<Map<string, () => void>>(new Map());

  const meetingRef = useMemoFirebase(() => {
    if (!firestore || !meetingId || !user) return null;
    return doc(firestore, 'meetings', meetingId);
  }, [firestore, meetingId, user]);

  const { data: meetingData } = useDoc<any>(meetingRef);

  const participantsRef = useMemoFirebase(() => {
    if (!firestore || !meetingId || !user) return null;
    return query(collection(firestore, 'meetings', meetingId, 'participants'), orderBy('joinedAt', 'asc'), limit(50));
  }, [firestore, meetingId, user]);

  const { data: participants } = useCollection<Participant>(participantsRef);

  const chatRef = useMemoFirebase(() => {
    if (!firestore || !meetingId || !user) return null;
    return query(collection(firestore, 'meetings', meetingId, 'chat'), orderBy('createdAt', 'desc'), limit(20));
  }, [firestore, meetingId, user]);

  const { data: rawChatMessages } = useCollection<ChatMessage>(chatRef);
  const chatMessages = useMemo(() => rawChatMessages ? [...rawChatMessages].reverse() : [], [rawChatMessages]);

  const currentUserParticipant = participants?.find(p => p.id === user?.uid);
  const isHost = user?.uid === meetingData?.hostId;
  const isCoHost = currentUserParticipant?.role === 'co-host';
  const hasAdminPrivileges = isHost || isCoHost;
  
  const activeParticipants = useMemo(() => {
    if (!participants) return [];
    return participants.filter(p => p.role !== 'left' && p.role !== 'waiting');
  }, [participants]);

  const activeParticipantIds = useMemo(() => activeParticipants.map(p => p.id).join(','), [activeParticipants]);

  const sortedParticipants = useMemo(() => {
    const rolePriority = { host: 0, 'co-host': 1, participant: 2 };
    return [...activeParticipants].sort((a, b) => (rolePriority[a.role as keyof typeof rolePriority] || 2) - (rolePriority[b.role as keyof typeof rolePriority] || 2));
  }, [activeParticipants]);

  const featuredParticipant = useMemo(() => {
    if (!activeParticipants.length) return null;
    if (meetingData?.screenSharerId) {
      const sharer = activeParticipants.find(p => p.id === meetingData.screenSharerId);
      if (sharer) return sharer;
    }
    return sortedParticipants[0];
  }, [activeParticipants, sortedParticipants, meetingData?.screenSharerId]);

  const waitingParticipants = participants?.filter(p => p.role === 'waiting') || [];

  const seriesAttendanceRef = useMemoFirebase(() => {
    if (!firestore || !meetingData?.seriesId || !user) return null;
    return doc(firestore, 'seriesAttendance', meetingData.seriesId, 'users', user.uid);
  }, [firestore, meetingData?.seriesId, user]);

  const { data: myCumulativeStats } = useDoc<CumulativeStats>(seriesAttendanceRef);

  useEffect(() => {
    if (participants) {
      const sorted = [...participants]
        .filter(p => p.lastReaction && p.lastReactionAt)
        .sort((a, b) => (b.lastReactionAt?.seconds || 0) - (a.lastReactionAt?.seconds || 0));
      const latest = sorted[0];
      if (latest) {
        const ts = latest.lastReactionAt?.seconds || 0;
        const reactionId = `${latest.id}-${ts}`;
        if (floatingReaction?.id !== reactionId) {
          setFloatingReaction({
            id: reactionId,
            emoji: latest.lastReaction!,
            userName: latest.name,
            left: Math.random() * 80 + 10,
          });
          setTimeout(() => setFloatingReaction(null), 4000);
        }
      }
    }
  }, [participants, floatingReaction?.id]);

  useEffect(() => {
    if (!currentUserParticipant) return;
    if (currentUserParticipant.role === 'left' && !isHost) {
      router.push('/dashboard');
      return;
    }
    if (currentUserParticipant.remoteMuteRequestAt) {
      const ts = currentUserParticipant.remoteMuteRequestAt.seconds;
      if (ts > lastProcessedRemoteMuteAt.current) {
        lastProcessedRemoteMuteAt.current = ts;
        if (!isAudioMuted && localStreamRef.current) {
          setIsAudioMuted(true);
          localStreamRef.current.getAudioTracks().forEach(t => t.enabled = false);
          updateDoc(doc(firestore!, 'meetings', meetingId, 'participants', user!.uid), { isMuted: true });
          toast({ title: 'Muted by host' });
        }
      }
    }
  }, [currentUserParticipant, isAudioMuted, isHost, firestore, meetingId, user?.uid]);

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
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        } catch (error3: any) {
          if (isMounted) setHasMediaPermission(false);
          isInitializingRef.current = false;
          return;
        }
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
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      pcs.current.forEach(pc => pc.close());
      signalingUnsubs.current.forEach(unsub => unsub());
    };
  }, [initMedia]);

  const handleToggleVideo = async () => {
    if (!localStreamRef.current || isTogglingVideo || !user || !firestore || !meetingId) return;
    setIsTogglingVideo(true);
    const pRef = doc(firestore, 'meetings', meetingId, 'participants', user.uid);
    
    if (isVideoOff) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        const newTrack = stream.getVideoTracks()[0];
        localStreamRef.current.getVideoTracks().forEach(t => { localStreamRef.current?.removeTrack(t); t.stop(); });
        localStreamRef.current.addTrack(newTrack);
        
        pcs.current.forEach(pc => {
          if (pc.signalingState === 'closed') return;
          const sender = pc.getSenders().find(s => s.track?.kind === 'video');
          if (sender) sender.replaceTrack(newTrack);
        });
        setIsVideoOff(false);
        updateDoc(pRef, { isVideoOff: false });
      } catch (err) {
        toast({ variant: 'destructive', title: 'Camera Error' });
      }
    } else {
      localStreamRef.current.getVideoTracks().forEach(track => { track.enabled = false; track.stop(); });
      setIsVideoOff(true);
      updateDoc(pRef, { isVideoOff: true });
    }
    setIsTogglingVideo(false);
  };

  const handleToggleAudio = () => {
    if (!localStreamRef.current || !user || !firestore || !meetingId) return;
    const newState = !isAudioMuted;
    setIsAudioMuted(newState);
    localStreamRef.current.getAudioTracks().forEach(t => t.enabled = !newState);
    updateDoc(doc(firestore, 'meetings', meetingId, 'participants', user.uid), { isMuted: newState });
  };

  useEffect(() => {
    if (!user || !firestore || !meetingId || !hasMediaPermission || !activeParticipants.length) return;

    const currentIds = activeParticipants.map(p => p.id).filter(id => id !== user.uid);
    const currentIdSet = new Set(currentIds);

    pcs.current.forEach((pc, id) => {
      if (!currentIdSet.has(id)) {
        signalingUnsubs.current.get(`${id}_channel`)?.();
        signalingUnsubs.current.get(`${id}_candidates`)?.();
        signalingUnsubs.current.delete(`${id}_channel`);
        signalingUnsubs.current.delete(`${id}_candidates`);
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

      pc.addTransceiver('audio', { direction: 'sendrecv', streams: [localStreamRef.current!] });
      pc.addTransceiver('video', { direction: 'sendrecv', streams: [localStreamRef.current!] });

      pc.ontrack = (event) => {
        if (pc.signalingState === 'closed') return;
        setRemoteStreams(prev => {
          const next = new Map(prev);
          const existingStream = next.get(participantId) || new MediaStream();
          if (!existingStream.getTracks().find(t => t.id === event.track.id)) {
            existingStream.addTrack(event.track);
          }
          next.set(participantId, new MediaStream(existingStream.getTracks()));
          return next;
        });
      };

      const channelId = [user.uid, participantId].sort().join('_');
      const channelRef = doc(firestore, 'meetings', meetingId, 'webrtc', channelId);

      pc.onicecandidate = (event) => {
        if (event.candidate && pc.signalingState !== 'closed') {
          addDoc(collection(channelRef, 'candidates'), { candidate: event.candidate.toJSON(), from: user.uid });
        }
      };

      if (user.uid < participantId) {
        try {
          const offer = await pc.createOffer();
          if (pc.signalingState !== 'stable') return;
          await pc.setLocalDescription(offer);
          await setDoc(channelRef, { offer: { type: offer.type, sdp: offer.sdp }, from: user.uid }, { merge: true });

          const unsubChannel = onSnapshot(channelRef, async (snapshot) => {
            const data = snapshot.data();
            if (pc.signalingState === 'closed') return;
            if (data?.answer && pc.signalingState === 'have-local-offer') {
              try {
                await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
              } catch (e) {}
            }
          });
          signalingUnsubs.current.set(`${participantId}_channel`, unsubChannel);
        } catch (err) {}
      } else {
        const unsubChannel = onSnapshot(channelRef, async (snapshot) => {
          if (pc.signalingState === 'closed') return;
          const data = snapshot.data();
          if (data?.offer && pc.signalingState === 'stable') {
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
              const answer = await pc.createAnswer();
              if (pc.signalingState === 'have-remote-offer') {
                await pc.setLocalDescription(answer);
                await updateDoc(channelRef, { answer: { type: answer.type, sdp: answer.sdp } });
              }
            } catch (err) {}
          }
        });
        signalingUnsubs.current.set(`${participantId}_channel`, unsubChannel);
      }

      const unsubCandidates = onSnapshot(query(collection(channelRef, 'candidates'), limit(50)), (snapshot) => {
        if (pc.signalingState === 'closed') return;
        snapshot.docChanges().forEach(async (change) => {
          if (change.type === 'added') {
            const data = change.doc.data();
            if (data.from !== user.uid && pc.signalingState !== 'closed' && pc.remoteDescription) {
              try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (e) {}
            }
          }
        });
      });
      signalingUnsubs.current.set(`${participantId}_candidates`, unsubCandidates);
    });
  }, [user?.uid, firestore, meetingId, activeParticipantIds, hasMediaPermission]);

  useEffect(() => {
    if (!user || !meetingId || !firestore || !meetingData || meetingData.status === 'finished') return;
    const pRef = doc(firestore, 'meetings', meetingId, 'participants', user.uid);
    
    const syncPresence = async () => {
      let initialRole = 'participant';
      if (user.uid === meetingData.hostId) initialRole = 'host';
      else if (meetingData.isLocked && !currentUserParticipant) initialRole = 'waiting';
      else if (currentUserParticipant?.role) initialRole = currentUserParticipant.role;

      const shouldWrite = !currentUserParticipant || 
        currentUserParticipant.role !== initialRole || 
        currentUserParticipant.isMuted !== isAudioMuted || 
        currentUserParticipant.isVideoOff !== isVideoOff || 
        currentUserParticipant.hasRaisedHand !== hasHandRaised;

      if (shouldWrite) {
        await setDoc(pRef, {
          id: user.uid,
          name: user.displayName || user.email?.split('@')[0] || 'Unknown User',
          joinedAt: currentUserParticipant?.joinedAt || serverTimestamp(),
          activeSegmentStart: currentUserParticipant?.activeSegmentStart || serverTimestamp(),
          role: initialRole,
          isMuted: isAudioMuted,
          isVideoOff: isVideoOff,
          hasRaisedHand: hasHandRaised,
          totalDuration: currentUserParticipant?.totalDuration || 0
        }, { merge: true });
      }
    };

    syncPresence();
  }, [user?.uid, meetingId, firestore, meetingData?.status, meetingData?.isLocked, isAudioMuted, isVideoOff, hasHandRaised, meetingData?.hostId]);

  const durationRef = useRef(0);
  const segmentStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (currentUserParticipant) {
      durationRef.current = currentUserParticipant.totalDuration || 0;
      segmentStartRef.current = currentUserParticipant.activeSegmentStart?.seconds || Date.now() / 1000;
    }
  }, [currentUserParticipant?.id]);

  useEffect(() => {
    if (!user || !meetingId || !firestore || !meetingData || meetingData.status === 'finished') return;
    const pRef = doc(firestore, 'meetings', meetingId, 'participants', user.uid);

    // Frugal heartbeat: 5 minutes to preserve quota
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible' && currentUserParticipant?.role !== 'waiting' && currentUserParticipant?.role !== 'left') {
        const now = Date.now() / 1000;
        const lastStart = segmentStartRef.current || now;
        const currentDuration = durationRef.current + (now - lastStart);
        
        durationRef.current = currentDuration;
        segmentStartRef.current = now;

        updateDoc(pRef, { totalDuration: Math.max(0, currentDuration) });
      }
    }, 300000); 
    return () => clearInterval(interval);
  }, [user?.uid, meetingId, firestore, meetingData?.status, currentUserParticipant?.role]);

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(Date.now() / 1000), 1000);
    return () => clearInterval(interval);
  }, []);

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

  const admitParticipant = (pId: string) => {
    if (!hasAdminPrivileges || !firestore) return;
    updateDoc(doc(firestore, 'meetings', meetingId, 'participants', pId), { role: 'participant', joinedAt: serverTimestamp(), activeSegmentStart: serverTimestamp() });
  };

  const removeParticipant = (pId: string) => {
    if (!hasAdminPrivileges || !firestore) return;
    updateDoc(doc(firestore, 'meetings', meetingId, 'participants', pId), { role: 'left' });
  };

  const promoteToCoHost = (pId: string) => {
    if (!isHost || !firestore) return;
    updateDoc(doc(firestore, 'meetings', meetingId, 'participants', pId), { role: 'co-host' });
  };

  const forceMute = (pId: string) => {
    if (!hasAdminPrivileges || !firestore) return;
    updateDoc(doc(firestore, 'meetings', meetingId, 'participants', pId), { remoteMuteRequestAt: serverTimestamp(), isMuted: true });
  };

  const requestUnmute = (pId: string) => {
    if (!hasAdminPrivileges || !firestore) return;
    updateDoc(doc(firestore, 'meetings', meetingId, 'participants', pId), { remoteUnmuteRequestAt: serverTimestamp() });
  };

  const stopScreenSharing = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
    }
    setIsScreenSharing(false);
    const cameraTrack = localStreamRef.current?.getVideoTracks().find(t => t.readyState === 'live');
    pcs.current.forEach(pc => {
      if (pc.signalingState === 'closed') return;
      const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
      if (videoSender) videoSender.replaceTrack(cameraTrack || null);
    });
    updateDoc(meetingRef!, { screenSharerId: null });
  };

  const startScreenSharing = async () => {
    if (!meetingData || !user || !firestore) return;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = stream.getVideoTracks()[0];
      pcs.current.forEach(pc => {
        if (pc.signalingState === 'closed') return;
        const videoSender = pc.getSenders().find(s => s.track?.kind === 'video');
        if (videoSender) videoSender.replaceTrack(screenTrack);
      });
      screenStreamRef.current = stream;
      setIsScreenSharing(true);
      updateDoc(meetingRef!, { screenSharerId: user.uid });
      screenTrack.onended = () => stopScreenSharing();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Screen Share Failed' });
    }
  };

  const handleSendMessage = () => {
    if (!chatInput.trim() || !user || !firestore) return;
    addDoc(collection(firestore, 'meetings', meetingId, 'chat'), {
      senderId: user.uid,
      senderName: user.displayName || user.email?.split('@')[0],
      text: chatInput,
      createdAt: serverTimestamp(),
    });
    setChatInput('');
  };

  const handleReact = (emoji: string) => {
    if (!firestore || !user || !meetingId) return;
    updateDoc(doc(firestore, 'meetings', meetingId, 'participants', user.uid), {
      lastReaction: emoji,
      lastReactionAt: serverTimestamp(),
    });
    setIsReactionOpen(false);
  };

  const endMeetingForAll = async () => {
    if (!isHost || !meetingRef || !firestore || !participants) return;
    setIsProcessingAttendance(true);
    const totalSessionSeconds = Math.max(1, currentTime - (meetingData.createdAt?.seconds || currentTime));
    const batch = writeBatch(firestore);
    batch.update(meetingRef, { status: 'finished', endedAt: serverTimestamp() });
    
    for (const p of participants) {
      const lastStart = p.activeSegmentStart?.seconds || currentTime;
      const duration = (p.totalDuration || 0) + (currentTime - lastStart);
      const ratio = totalSessionSeconds > 0 ? duration / totalSessionSeconds : 0;
      const isQualified = p.id === meetingData.hostId || ratio >= 0.7;
      if (isQualified && meetingData.seriesId) {
        const seriesUserRef = doc(firestore, 'seriesAttendance', meetingData.seriesId, 'users', p.id);
        batch.set(seriesUserRef, { userId: p.id, seriesId: meetingData.seriesId, attendedHours: increment(meetingData.fixedDurationHours || 0), sessionsAttended: increment(1) }, { merge: true });
      }
    }
    await batch.commit();
    setIsProcessingAttendance(false);
    setShowSummary(true);
  };

  if (currentUserParticipant?.role === 'waiting') {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-[#F8F9FB] p-6 text-center">
        <div className="bg-primary/10 w-32 h-32 rounded-[2.5rem] flex items-center justify-center mb-8 animate-pulse shadow-inner border border-white/5"><Lock className="h-12 w-12 text-primary" /></div>
        <h1 className="text-4xl font-black mb-3 tracking-tight">Meeting Restricted</h1>
        <p className="text-zinc-500 max-w-sm font-bold text-sm leading-relaxed">The host has been notified. Please wait until you are admitted to the session.</p>
        <Button variant="ghost" className="mt-12 text-zinc-400 font-black uppercase tracking-widest text-[11px]" onClick={() => router.push('/dashboard')}>Leave Waiting Room</Button>
      </div>
    );
  }

  if (showSummary || (meetingData?.status === 'finished' && user)) {
    const totalExpectedHours = (meetingData?.totalSessionsInSeries || 1) * (meetingData?.fixedDurationHours || 0);
    const attendedHours = myCumulativeStats?.attendedHours || 0;
    const isPresentOverall = isHost || (attendedHours / (totalExpectedHours || 1)) >= 0.7;

    return (
      <div className="flex h-screen items-center justify-center bg-[#F8F9FB] p-6">
        <Card className="w-full max-w-2xl shadow-[0_50px_100px_-20px_rgba(0,0,0,0.15)] rounded-[3rem] overflow-hidden border-none bg-white">
          <CardHeader className="text-center border-b pb-10 pt-16 bg-zinc-50/50">
            <div className="mx-auto bg-primary/5 w-24 h-24 rounded-[2rem] flex items-center justify-center mb-6 shadow-inner border border-white/5"><BookOpen className="h-12 w-12 text-primary" /></div>
            <CardTitle className="text-5xl font-black tracking-tighter">Attendance Report</CardTitle>
            <CardDescription className="text-zinc-400 font-bold uppercase tracking-[0.2em] mt-2 text-[11px]">Series: {meetingData?.name}</CardDescription>
          </CardHeader>
          <CardContent className="pt-12 space-y-12 px-12">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="bg-zinc-50 p-10 rounded-[2rem] border border-zinc-100 text-center shadow-sm">
                <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest mb-4">Total Hours</p>
                <div className="text-5xl font-black tracking-tighter">{attendedHours}<span className="text-zinc-300 text-2xl">/{totalExpectedHours}</span></div>
              </div>
              <div className="bg-zinc-50 p-10 rounded-[2rem] border border-zinc-100 text-center shadow-sm">
                <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest mb-4">Completion</p>
                <div className="text-5xl font-black tracking-tighter">{((attendedHours / (totalExpectedHours || 1)) * 100).toFixed(0)}%</div>
              </div>
              <div className="bg-zinc-50 p-10 rounded-[2rem] border border-zinc-100 text-center shadow-sm">
                <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest mb-4">Sessions</p>
                <div className="text-5xl font-black tracking-tighter">{myCumulativeStats?.sessionsAttended || 0}<span className="text-zinc-300 text-2xl">/{meetingData?.totalSessionsInSeries || 1}</span></div>
              </div>
            </div>
            <div className={cn("p-12 rounded-[2.5rem] flex flex-col items-center gap-8 text-center border-4 transition-all", isPresentOverall ? "bg-green-50/30 border-green-100 text-green-900 shadow-green-100/50" : "bg-red-50/30 border-red-100 text-red-900 shadow-red-100/50")}>
              {isPresentOverall ? <Trophy className="h-20 w-20 animate-bounce" /> : <Frown className="h-20 w-20" />}
              <div>
                <h3 className="text-4xl font-black tracking-tighter uppercase">Status: {isPresentOverall ? 'PRESENT' : 'ABSENT'}</h3>
                <p className="text-[11px] font-black uppercase tracking-[0.2em] mt-2 opacity-60">{isPresentOverall ? 'Attendance Credit Granted' : 'Attendance Requirement Not Met'}</p>
              </div>
            </div>
          </CardContent>
          <CardFooter className="bg-zinc-50/80 p-12 gap-6 border-t">
            <Button variant="outline" className="flex-1 h-16 rounded-[1.5rem] font-black uppercase tracking-widest text-[11px] border-zinc-200" onClick={() => window.print()}><Download className="mr-3 h-5 w-5" /> Export PDF</Button>
            <Button className="flex-1 h-16 rounded-[1.5rem] font-black uppercase tracking-widest text-[11px] shadow-xl" onClick={() => router.push('/dashboard')}>Back to Dashboard</Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <AuthGuard>
      <div className="flex h-screen w-full flex-col overflow-hidden bg-[#F8F9FB]">
        <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
          {floatingReaction && (
            <div key={floatingReaction.id} className="absolute bottom-0 animate-float-up flex flex-col items-center gap-2" style={{ left: `${floatingReaction.left}%` }}>
              <div className="text-6xl filter drop-shadow-[0_15px_15px_rgba(0,0,0,0.2)]">{floatingReaction.emoji}</div>
              <Badge variant="secondary" className="bg-black/60 text-white border-none text-[10px] py-1 px-3 font-black uppercase tracking-widest backdrop-blur-md rounded-lg">{floatingReaction.userName}</Badge>
            </div>
          )}
        </div>

        <header className="flex h-20 items-center justify-between px-10 bg-white border-b z-10 shadow-sm">
          <div className="flex items-center gap-8">
            <div className="bg-zinc-900 flex items-center justify-center h-12 w-12 rounded-[1.25rem] text-white font-black text-xl shadow-lg ring-4 ring-zinc-50">CV</div>
            <div className="flex items-center gap-6">
               <div className="flex flex-col">
                  <h1 className="text-base font-black truncate max-w-[300px] leading-tight tracking-tight text-zinc-900">{meetingData?.name || 'Loading session...'}</h1>
                  <p className="text-[10px] text-zinc-400 font-black uppercase tracking-[0.25em] mt-1">{meetingData?.isLocked ? 'Restricted Session' : 'Public Session'}</p>
               </div>
               <div className="flex items-center bg-zinc-50 px-4 py-2 rounded-2xl border border-zinc-100 gap-3 cursor-pointer hover:bg-zinc-100 transition-all hover:scale-105 active:scale-95 group" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/room/${meetingId}`); toast({ title: "Invite link copied!" }); }}>
                 <span className="text-[11px] font-mono font-black text-zinc-400 group-hover:text-zinc-600">{meetingId}</span>
                 <Share2 className="h-3.5 w-3.5 text-zinc-300 group-hover:text-primary transition-colors" />
               </div>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3 bg-zinc-50 border border-zinc-100 rounded-[1.25rem] px-5 py-3 text-xs font-black text-zinc-600 shadow-sm"><Timer className="h-4 w-4 text-primary" /> {elapsedTime}</div>
            {isHost ? (
              <Button onClick={endMeetingForAll} variant="destructive" disabled={isProcessingAttendance} className="rounded-[1.25rem] h-14 px-10 font-black uppercase text-xs tracking-widest shadow-[0_15px_30px_-10px_rgba(255,69,69,0.4)] bg-[#FF4545] hover:bg-red-600 transition-all border-none">
                {isProcessingAttendance ? 'Syncing...' : 'End Session'}
              </Button>
            ) : (
              <Button onClick={() => router.push('/dashboard')} variant="outline" className="rounded-[1.25rem] h-14 px-10 font-black uppercase text-xs tracking-widest border-zinc-200 hover:bg-zinc-50 transition-all active:scale-95">Leave</Button>
            )}
          </div>
        </header>

        <main className="flex-1 flex overflow-hidden p-8 gap-8 relative">
          <div className="flex-1 flex flex-col gap-8 overflow-hidden">
            <div className="flex-1 bg-[#121212] rounded-[3.5rem] relative overflow-hidden shadow-[0_50px_100px_-20px_rgba(0,0,0,0.5)] border border-white/5">
               <div className="w-full h-full">
                 {meetingData?.screenSharerId ? (
                   <div className="w-full h-full relative">
                      <RemoteStream 
                        stream={meetingData.screenSharerId === user?.uid ? screenStreamRef.current : remoteStreams.get(meetingData.screenSharerId) || null} 
                        name={featuredParticipant?.name || 'Screen Share'} 
                        isMe={meetingData.screenSharerId === user?.uid} 
                        isFeatured={true}
                      />
                      {!isVideoOff && meetingData.screenSharerId === user?.uid && (
                        <div className="absolute bottom-10 right-10 w-64 aspect-video rounded-[2rem] overflow-hidden border-4 border-white/10 shadow-2xl z-20 transition-transform duration-500">
                          <RemoteStream stream={localStreamRef.current} name="Me" isMe={true} isVideoOff={isVideoOff} />
                        </div>
                      )}
                   </div>
                 ) : (
                   <div className="h-full w-full flex items-center justify-center p-8">
                      {featuredParticipant ? (
                        <div className="w-full h-full max-w-[1400px] mx-auto transition-all duration-700">
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
                        <div className="text-zinc-700 font-black uppercase tracking-[1em] animate-pulse text-[10px]">Initializing Mesh Network...</div>
                      )}
                   </div>
                 )}
               </div>
              {hasMediaPermission === false && (
                <div className="absolute inset-0 flex items-center justify-center bg-[#121212]/98 z-30 px-10">
                  <div className="max-w-md w-full text-center">
                    <div className="bg-[#FF4545]/10 w-32 h-32 rounded-[2.5rem] flex items-center justify-center mx-auto mb-10 shadow-inner border border-white/5">
                      <AlertCircle className="h-14 w-14 text-[#FF4545]" />
                    </div>
                    <h2 className="text-white text-3xl font-black mb-4 tracking-tight">Hardware Access Required</h2>
                    <p className="text-zinc-500 text-sm mb-12 leading-relaxed font-bold">Please ensure you have granted camera and microphone access in your browser settings to join the session.</p>
                    <Button variant="secondary" className="w-full h-16 rounded-[1.5rem] font-black shadow-2xl uppercase tracking-widest text-[11px] bg-white text-zinc-900 hover:bg-zinc-100 transition-all" onClick={() => window.location.reload()}><RefreshCcw className="mr-4 h-5 w-5" /> Retry Connection</Button>
                  </div>
                </div>
              )}
            </div>

            <div className="h-28 mx-auto w-fit bg-white rounded-[3rem] border border-zinc-100 shadow-[0_30px_60px_-15px_rgba(0,0,0,0.15)] flex items-center px-12 gap-6 shrink-0 -mt-14 z-20 transition-all hover:scale-[1.02]">
               <Button variant={isAudioMuted ? "destructive" : "secondary"} size="icon" onClick={handleToggleAudio} className={cn("rounded-2xl h-16 w-16 shadow-lg transition-all border-none", isAudioMuted ? "bg-[#FF4545] hover:bg-red-600 shadow-red-200" : "bg-zinc-100 hover:bg-zinc-200")}>{isAudioMuted ? <MicOff className="h-7 w-7 text-white" /> : <Mic className="h-7 w-7 text-zinc-700" />}</Button>
               <Button variant={isVideoOff ? "destructive" : "secondary"} size="icon" onClick={handleToggleVideo} disabled={isTogglingVideo} className={cn("rounded-2xl h-16 w-16 shadow-lg transition-all border-none", isVideoOff ? "bg-[#FF4545] hover:bg-red-600 shadow-red-200" : "bg-zinc-100 hover:bg-zinc-200")}>{isVideoOff ? <VideoOff className="h-7 w-7 text-white" /> : <VideoIcon className="h-7 w-7 text-zinc-700" />}</Button>
               <Separator orientation="vertical" className="h-12 mx-4 bg-zinc-100" />
               <Button variant={isScreenSharing ? "default" : "secondary"} size="icon" onClick={isScreenSharing ? stopScreenSharing : startScreenSharing} className={cn("rounded-2xl h-16 w-16 shadow-lg transition-all border-none", isScreenSharing ? "bg-primary text-white" : "bg-zinc-50 hover:bg-zinc-100")}><ScreenShare className="h-7 w-7 text-zinc-500" /></Button>
               <Button variant={hasHandRaised ? "default" : "secondary"} size="icon" onClick={() => { const ns = !hasHandRaised; setHasHandRaised(ns); updateDoc(doc(firestore!, 'meetings', meetingId, 'participants', user!.uid), { hasRaisedHand: ns }); }} className={cn("rounded-2xl h-16 w-16 shadow-lg transition-all border-none", hasHandRaised ? "bg-yellow-400 text-yellow-900 hover:bg-yellow-500 shadow-yellow-200" : "bg-zinc-50 hover:bg-zinc-100")}><Hand className="h-7 w-7" /></Button>
               <Popover open={isReactionOpen} onOpenChange={setIsReactionOpen}>
                  <PopoverTrigger asChild><Button variant="secondary" size="icon" className="rounded-2xl h-16 w-16 shadow-lg transition-all bg-zinc-50 hover:bg-zinc-100 border-none"><Smile className="h-7 w-7 text-zinc-500" /></Button></PopoverTrigger>
                  <PopoverContent className="w-auto p-6 grid grid-cols-4 gap-6 rounded-[3rem] shadow-[0_50px_100px_-20px_rgba(0,0,0,0.3)] border-none bg-white mb-6">
                     {['👍', '👏', '🔥', '❤️', '😮', '🎉', '💡', '💯'].map(emoji => (
                       <Button key={emoji} variant="ghost" className="h-16 w-16 p-0 text-4xl hover:bg-zinc-50 transition-all hover:scale-125 rounded-2xl" onClick={() => handleReact(emoji)}>{emoji}</Button>
                     ))}
                  </PopoverContent>
               </Popover>
               <Separator orientation="vertical" className="h-12 mx-4 bg-zinc-100" />
               <Dialog>
                 <DialogTrigger asChild><Button variant="secondary" size="icon" className="rounded-2xl h-16 w-16 shadow-lg transition-all bg-zinc-50 hover:bg-zinc-100 border-none"><BarChart3 className="h-7 w-7 text-zinc-500" /></Button></DialogTrigger>
                 <DialogContent className="max-w-5xl rounded-[3.5rem] p-0 overflow-hidden border-none shadow-[0_50px_100px_-20px_rgba(0,0,0,0.5)]">
                    <DialogHeader className="p-12 bg-zinc-50/50 border-b">
                      <DialogTitle className="text-4xl font-black tracking-tighter">Session Engagement</DialogTitle>
                      <DialogDescription className="font-black text-zinc-400 uppercase tracking-[0.2em] text-[10px] mt-2">Real-time attendance tracking</DialogDescription>
                    </DialogHeader>
                    <div className="p-12 overflow-auto max-h-[60vh]">
                       <Table>
                          <TableHeader><TableRow className="border-none hover:bg-transparent"><TableHead className="font-black text-[11px] uppercase tracking-widest text-zinc-400 pb-6">Student</TableHead><TableHead className="font-black text-[11px] uppercase tracking-widest text-zinc-400 pb-6">Status</TableHead><TableHead className="font-black text-[11px] uppercase tracking-widest text-zinc-400 pb-6">Join Time</TableHead><TableHead className="text-right font-black text-[11px] uppercase tracking-widest text-zinc-400 pb-6">Active Time</TableHead><TableHead className="text-right font-black text-[11px] uppercase tracking-widest text-zinc-400 pb-6">Credit</TableHead></TableRow></TableHeader>
                          <TableBody>
                             {activeParticipants.map(p => {
                               const lastStart = p.activeSegmentStart?.seconds || currentTime;
                               const dur = (p.totalDuration || 0) + (currentTime - lastStart);
                               const meetingElapsed = Math.max(1, currentTime - (meetingData?.createdAt?.seconds || currentTime));
                               const ratio = meetingElapsed > 0 ? dur / meetingElapsed : 0;
                               const isQualified = p.id === meetingData?.hostId || ratio >= 0.7;
                               return (
                                 <TableRow key={p.id} className="border-b border-zinc-50 hover:bg-zinc-50/50 transition-colors">
                                    <TableCell className="py-6"><div className="font-black text-zinc-900 flex items-center gap-2">{p.name} {p.id === user?.uid && <Badge variant="secondary" className="bg-primary/5 text-primary text-[8px] font-black uppercase border-none px-2">Me</Badge>}</div></TableCell>
                                    <TableCell className="py-6"><Badge variant="outline" className="capitalize font-black border-zinc-200 text-[10px] tracking-widest px-3 py-1 bg-white">{p.role}</Badge></TableCell>
                                    <TableCell className="py-6 text-zinc-400 font-black text-[10px] tracking-widest">{p.joinedAt ? format(new Date(p.joinedAt.seconds * 1000), 'p') : '--'}</TableCell>
                                    <TableCell className="py-6 text-right font-mono font-black text-zinc-800 text-[11px]">{formatDuration(dur)}</TableCell>
                                    <TableCell className="py-6 text-right"><Badge className={cn("font-black text-[9px] uppercase tracking-widest px-4 py-1.5 rounded-lg border-none", isQualified ? "bg-green-100 text-green-700" : "bg-zinc-100 text-zinc-400 shadow-inner")}>{isQualified ? 'Qualified' : 'In Progress'}</Badge></TableCell>
                                 </TableRow>
                               );
                             })}
                          </TableBody>
                       </Table>
                    </div>
                 </DialogContent>
               </Dialog>
            </div>
          </div>

          <Card className="w-[420px] flex flex-col overflow-hidden border-zinc-100 shadow-[0_50px_100px_-20px_rgba(0,0,0,0.1)] shrink-0 rounded-[3.5rem] bg-white border-none">
             <Tabs defaultValue="participants" className="flex-1 flex flex-col overflow-hidden">
                <div className="px-8 pt-10 pb-4 border-b bg-zinc-50/20">
                   <TabsList className="w-full h-16 grid grid-cols-2 rounded-[1.5rem] bg-zinc-100/80 p-1.5 shadow-inner">
                      <TabsTrigger value="participants" className="rounded-2xl flex items-center gap-3 font-black text-[11px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-xl"><Users className="h-4 w-4" /> Students</TabsTrigger>
                      <TabsTrigger value="chat" className="rounded-2xl flex items-center gap-3 font-black text-[11px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-xl"><MessageSquare className="h-4 w-4" /> Chat</TabsTrigger>
                   </TabsList>
                </div>

                <TabsContent value="participants" className="flex-1 flex flex-col overflow-hidden mt-0">
                   <ScrollArea className="flex-1 p-8">
                      <div className="space-y-10">
                        {waitingParticipants.length > 0 && hasAdminPrivileges && (
                          <div className="space-y-6">
                             <div className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400 px-3 flex items-center gap-4">
                               <div className="w-2.5 h-2.5 bg-yellow-400 rounded-full animate-pulse shadow-[0_0_10px_rgba(250,204,21,0.5)]" /> Waiting Room
                             </div>
                             {waitingParticipants.map(p => (
                               <div key={p.id} className="bg-zinc-50/80 p-6 rounded-[2rem] border border-zinc-100 space-y-6 shadow-sm group hover:shadow-md transition-all">
                                  <div className="flex items-center gap-4">
                                    <Avatar className="h-14 w-14 border-4 border-white shadow-xl"><AvatarFallback className="text-sm font-black bg-zinc-100 text-zinc-900">{p.name[0]}</AvatarFallback></Avatar>
                                    <span className="text-sm font-black truncate text-zinc-900 tracking-tight">{p.name}</span>
                                  </div>
                                  <div className="flex gap-4">
                                    <Button size="sm" onClick={() => admitParticipant(p.id)} className="flex-1 h-12 text-[10px] font-black uppercase tracking-widest rounded-2xl shadow-lg">Admit</Button>
                                    <Button size="sm" variant="ghost" onClick={() => removeParticipant(p.id)} className="flex-1 h-12 text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-[#FF4545] rounded-2xl">Decline</Button>
                                  </div>
                               </div>
                             ))}
                             <Separator className="my-8 opacity-40" />
                          </div>
                        )}

                        <div className="space-y-6">
                          <div className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400 px-3 flex items-center gap-4">
                            <div className="w-2.5 h-2.5 bg-green-500 rounded-full" /> Active Sessions
                          </div>
                          {participants?.filter(p => p.role !== 'waiting' && p.role !== 'left').map(p => {
                            const isMe = p.id === user?.uid;
                            return (
                              <div key={p.id} className="group flex items-center gap-5 p-4 rounded-[2rem] hover:bg-zinc-50 transition-all border border-transparent">
                                 <div className="relative">
                                   <Avatar className="h-16 w-16 border-4 border-white shadow-xl group-hover:scale-110 transition-transform">
                                      <AvatarFallback className="bg-zinc-100 text-zinc-900 font-black text-sm">{p.name[0]}</AvatarFallback>
                                   </Avatar>
                                   {p.hasRaisedHand && <div className="absolute -top-1 -right-1 bg-yellow-400 rounded-full p-2.5 border-4 border-white shadow-2xl animate-bounce z-10"><Hand className="h-3 w-3 text-yellow-900" /></div>}
                                 </div>
                                 <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-3">
                                       <div className="text-sm font-black truncate text-zinc-900 tracking-tight">{p.name}</div>
                                       {p.role === 'host' && <Shield className="h-4 w-4 text-primary opacity-60" />}
                                       {p.role === 'co-host' && <Star className="h-4 w-4 text-yellow-500" />}
                                    </div>
                                    <div className="flex items-center gap-4 mt-2">
                                       {p.isMuted ? <MicOff className="h-4 w-4 text-[#FF4545]" /> : <Mic className="h-4 w-4 text-green-500" />}
                                       {p.isVideoOff ? <VideoOff className="h-4 w-4 text-zinc-200" /> : <VideoIcon className="h-4 w-4 text-primary opacity-30" />}
                                       {!isMe && hasAdminPrivileges && (
                                         <Popover>
                                            <PopoverTrigger asChild><Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-all ml-auto"><Shield className="h-4 w-4 text-zinc-300" /></Button></PopoverTrigger>
                                            <PopoverContent className="w-64 p-4 rounded-[2rem] border-none shadow-[0_30px_60px_-15px_rgba(0,0,0,0.2)] bg-white mb-2" align="end">
                                               <div className="grid gap-3">
                                                  <Button variant="ghost" size="sm" onClick={() => p.isMuted ? requestUnmute(p.id) : forceMute(p.id)} className="justify-start h-12 text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-zinc-50">
                                                    {p.isMuted ? <><Mic className="h-4 w-4 mr-4 text-primary" /> Request Unmute</> : <><MicOff className="h-4 w-4 mr-4 text-[#FF4545]" /> Force Mute</>}
                                                  </Button>
                                                  {isHost && p.role === 'participant' && (
                                                    <Button variant="ghost" size="sm" onClick={() => promoteToCoHost(p.id)} className="justify-start h-12 text-[10px] font-black uppercase tracking-widest rounded-2xl hover:bg-zinc-50">
                                                       <Star className="h-4 w-4 mr-4 text-yellow-500" /> Make Co-host
                                                    </Button>
                                                  )}
                                                  <Button variant="ghost" size="sm" onClick={() => removeParticipant(p.id)} className="justify-start h-12 text-[10px] font-black uppercase tracking-widest text-[#FF4545] hover:bg-red-50 rounded-2xl">
                                                     <UserMinus className="h-4 w-4 mr-4" /> Kick Student
                                                  </Button>
                                               </div>
                                            </PopoverContent>
                                         </Popover>
                                       )}
                                    </div>
                                 </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                   </ScrollArea>
                   <div className="p-10 bg-zinc-50/50 border-t">
                      <div className="space-y-6">
                         <div className="flex justify-between text-[10px] uppercase font-black text-zinc-400 tracking-[0.2em] px-2">
                            <div>Series Progress</div>
                            <div className="text-primary">{myCumulativeStats?.attendedHours || 0}h / {((meetingData?.totalSessionsInSeries || 1) * (meetingData?.fixedDurationHours || 0))}h</div>
                         </div>
                         <div className="h-4 w-full bg-zinc-100 rounded-full overflow-hidden shadow-inner border border-zinc-200/40">
                            <div 
                              className="h-full bg-zinc-900 transition-all duration-1000" 
                              style={{ width: `${Math.min(100, (myCumulativeStats?.attendedHours || 0) / Math.max(1, (meetingData?.totalSessionsInSeries || 1) * (meetingData?.fixedDurationHours || 0)) * 100)}%` }} 
                            />
                         </div>
                      </div>
                   </div>
                </TabsContent>

                <TabsContent value="chat" className="flex-1 flex flex-col overflow-hidden mt-0">
                   <ScrollArea className="flex-1 p-10">
                      <div className="space-y-10">
                         {chatMessages?.map((msg) => (
                           <div key={msg.id} className={cn("flex flex-col gap-3", msg.senderId === user?.uid ? "items-end" : "items-start")}>
                              <div className="text-[10px] font-black text-zinc-400 px-3 uppercase tracking-[0.2em]">{msg.senderName}</div>
                              <div className={cn("max-w-[90%] px-6 py-5 rounded-[2rem] text-[13px] font-bold leading-relaxed shadow-sm", msg.senderId === user?.uid ? "bg-zinc-900 text-white rounded-tr-none shadow-zinc-200" : "bg-zinc-50 text-zinc-800 border border-zinc-100 rounded-tl-none")}>{msg.text}</div>
                           </div>
                         ))}
                      </div>
                   </ScrollArea>
                   <div className="p-8 border-t bg-white">
                      <div className="relative flex items-center">
                        <Input placeholder="Share something..." value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()} className="pr-16 rounded-[2rem] h-16 bg-zinc-50 border-zinc-100 pl-8 font-bold text-sm shadow-inner" />
                        <Button size="icon" variant="ghost" onClick={handleSendMessage} className="absolute right-3 top-1/2 -translate-y-1/2 h-12 w-12 text-zinc-900 transition-transform active:scale-90"><Send className="h-6 w-6" /></Button>
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
