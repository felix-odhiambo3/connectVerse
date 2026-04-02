
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
  getDoc,
  updateDoc,
  increment,
  writeBatch,
  setDoc,
  Timestamp,
  onSnapshot,
  deleteDoc,
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
  const videoRef = useCallback((node: HTMLVideoElement | null) => {
    if (node && stream) {
      node.srcObject = stream;
      node.play().catch(e => console.warn("Auto-play blocked or failed", e));
    }
  }, [stream]);

  return (
    <div className={cn("relative w-full h-full bg-zinc-800 rounded-3xl overflow-hidden group border shadow-sm flex items-center justify-center transition-all", isFeatured && "border-primary/20 shadow-2xl bg-zinc-900")}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isMe}
        className={cn("w-full h-full object-cover transition-opacity duration-500", (isVideoOff && !stream?.getVideoTracks()[0]?.enabled) ? "opacity-0" : "opacity-100")}
      />
      {isVideoOff && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900 z-10 transition-all">
           <div className={cn("rounded-full bg-zinc-800 flex items-center justify-center transition-all shadow-inner border border-white/5", isFeatured ? "w-32 h-32" : "w-16 h-16")}>
              <UserIcon className={cn("text-zinc-600 transition-all", isFeatured ? "h-16 w-16" : "h-8 w-8")} />
           </div>
           <div className={cn("text-zinc-500 mt-4 font-bold tracking-tight", isFeatured ? "text-sm uppercase tracking-widest" : "text-xs")}>Camera Off</div>
        </div>
      )}
      <div className="absolute bottom-4 left-4 flex items-center gap-2 z-20">
        <Badge variant="secondary" className="bg-black/40 text-white backdrop-blur-sm border-none px-3 py-1 font-bold">
          {name} {isMe && "(You)"}
        </Badge>
        {isMuted && <div className="p-1.5 bg-red-500 rounded-full shadow-lg border border-white/10"><MicOff className="h-3.5 w-3.5 text-white" /></div>}
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
  const [permissionErrorName, setPermissionErrorName] = useState<string | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());

  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const isInitializingRef = useRef(false);
  const lastProcessedRemoteMuteAt = useRef<number>(0);
  const lastProcessedRemoteUnmuteAt = useRef<number>(0);
  const pcs = useRef<Map<string, RTCPeerConnection>>(new Map());
  const signalingUnsubs = useRef<Map<string, () => void>>(new Map());

  const meetingRef = useMemoFirebase(() => {
    if (!firestore || !meetingId || !user) return null;
    return doc(firestore, 'meetings', meetingId);
  }, [firestore, meetingId, user]);

  const { data: meetingData } = useDoc<any>(meetingRef);

  const participantsRef = useMemoFirebase(() => {
    if (!firestore || !meetingId || !user) return null;
    return query(collection(firestore, 'meetings', meetingId, 'participants'), orderBy('joinedAt', 'asc'));
  }, [firestore, meetingId, user]);

  const { data: participants } = useCollection<Participant>(participantsRef);

  const chatRef = useMemoFirebase(() => {
    if (!firestore || !meetingId || !user) return null;
    return query(collection(firestore, 'meetings', meetingId, 'chat'), orderBy('createdAt', 'asc'));
  }, [firestore, meetingId, user]);

  const { data: chatMessages } = useCollection<ChatMessage>(chatRef);

  const currentUserParticipant = participants?.find(p => p.id === user?.uid);
  const isHost = user?.uid === meetingData?.hostId;
  const isCoHost = currentUserParticipant?.role === 'co-host';
  const hasAdminPrivileges = isHost || isCoHost;
  
  const activeParticipants = useMemo(() => {
    if (!participants) return [];
    return participants.filter(p => p.role !== 'left' && p.role !== 'waiting');
  }, [participants]);

  const sortedParticipants = useMemo(() => {
    const rolePriority = { host: 0, 'co-host': 1, participant: 2 };
    return [...activeParticipants].sort((a, b) => (rolePriority[a.role as keyof typeof rolePriority] || 2) - (rolePriority[b.role as keyof typeof rolePriority] || 2));
  }, [activeParticipants]);

  const featuredParticipant = sortedParticipants[0];

  const waitingParticipants = participants?.filter(p => p.role === 'waiting') || [];

  const seriesAttendanceRef = useMemoFirebase(() => {
    if (!firestore || !meetingData?.seriesId || !user) return null;
    return doc(firestore, 'seriesAttendance', meetingData.seriesId, 'users', user.uid);
  }, [firestore, meetingData?.seriesId, user]);

  const { data: myCumulativeStats } = useDoc<CumulativeStats>(seriesAttendanceRef);

  const latestReactionParticipant = useMemo(() => {
    if (!participants) return null;
    const sorted = [...participants]
      .filter(p => p.lastReaction && p.lastReactionAt)
      .sort((a, b) => (b.lastReactionAt?.seconds || 0) - (a.lastReactionAt?.seconds || 0));
    return sorted[0];
  }, [participants]);

  useEffect(() => {
    if (latestReactionParticipant) {
      const ts = latestReactionParticipant.lastReactionAt?.seconds || 0;
      const reactionId = `${latestReactionParticipant.id}-${ts}`;
      if (floatingReaction?.id !== reactionId) {
        setFloatingReaction({
          id: reactionId,
          emoji: latestReactionParticipant.lastReaction!,
          userName: latestReactionParticipant.name,
          left: Math.random() * 80 + 10,
        });
        const timer = setTimeout(() => setFloatingReaction(null), 4000);
        return () => clearTimeout(timer);
      }
    }
  }, [latestReactionParticipant, floatingReaction?.id]);

  useEffect(() => {
    if (!currentUserParticipant) return;
    if (currentUserParticipant.role === 'left' && !isHost) {
      toast({ variant: 'destructive', title: 'Removed', description: 'You have been removed from the session.' });
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
          toast({ title: 'Muted by host', description: 'Your microphone has been disabled.' });
        }
      }
    }
    if (currentUserParticipant.remoteUnmuteRequestAt) {
      const ts = currentUserParticipant.remoteUnmuteRequestAt.seconds;
      if (ts > lastProcessedRemoteUnmuteAt.current) {
        lastProcessedRemoteUnmuteAt.current = ts;
        if (isAudioMuted) {
          toast({ 
            title: 'Unmute Request', 
            description: 'The host has requested that you unmute your microphone.',
            action: <Button size="sm" onClick={handleToggleAudio}>Unmute Now</Button>
          });
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
          if (isMounted) {
            setHasMediaPermission(false);
            setPermissionErrorName(error.name || error3.name);
          }
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
        const oldTracks = localStreamRef.current.getVideoTracks();
        oldTracks.forEach(t => { localStreamRef.current?.removeTrack(t); t.stop(); });
        localStreamRef.current.addTrack(newTrack);
        pcs.current.forEach(pc => {
          if (pc.signalingState === 'closed') return;
          const sender = pc.getSenders().find(s => s.track?.kind === 'video');
          if (sender) sender.replaceTrack(newTrack);
        });
        setIsVideoOff(false);
        updateDoc(pRef, { isVideoOff: false });
      } catch (err) {
        toast({ variant: 'destructive', title: 'Camera Error', description: 'Could not access camera hardware.' });
      }
    } else {
      localStreamRef.current.getVideoTracks().forEach(track => {
        track.enabled = false;
        track.stop();
      });
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
    if (!user || !firestore || !meetingId || !localStreamRef.current || !activeParticipants.length) return;

    activeParticipants.forEach(async (participant) => {
      if (participant.id === user.uid || pcs.current.has(participant.id)) return;

      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcs.current.set(participant.id, pc);

      localStreamRef.current?.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current!));

      pc.ontrack = (event) => {
        if (pc.signalingState === 'closed') return;
        setRemoteStreams(prev => {
          const next = new Map(prev);
          next.set(participant.id, event.streams[0]);
          return next;
        });
      };

      const channelId = [user.uid, participant.id].sort().join('_');
      const channelRef = doc(firestore, 'meetings', meetingId, 'webrtc', channelId);

      pc.onicecandidate = (event) => {
        if (event.candidate && pc.signalingState !== 'closed') {
          addDoc(collection(channelRef, 'candidates'), {
            candidate: event.candidate.toJSON(),
            from: user.uid,
          });
        }
      };

      if (user.uid < participant.id) {
        const offer = await pc.createOffer();
        if (pc.signalingState === 'closed') return;
        await pc.setLocalDescription(offer);
        await setDoc(channelRef, { offer: { type: offer.type, sdp: offer.sdp }, from: user.uid }, { merge: true });

        const unsubChannel = onSnapshot(channelRef, async (snapshot) => {
          if (pc.signalingState === 'closed') return;
          const data = snapshot.data();
          if (data?.answer && pc.signalingState !== 'stable') {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
          }
        });
        signalingUnsubs.current.set(`${participant.id}_channel`, unsubChannel);
      } else {
        const unsubChannel = onSnapshot(channelRef, async (snapshot) => {
          if (pc.signalingState === 'closed') return;
          const data = snapshot.data();
          if (data?.offer && pc.signalingState !== 'have-remote-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await pc.createAnswer();
            if (pc.signalingState === 'closed') return;
            await pc.setLocalDescription(answer);
            await updateDoc(channelRef, { answer: { type: answer.type, sdp: answer.sdp } });
          }
        });
        signalingUnsubs.current.set(`${participant.id}_channel`, unsubChannel);
      }

      const unsubCandidates = onSnapshot(collection(channelRef, 'candidates'), (snapshot) => {
        if (pc.signalingState === 'closed') return;
        snapshot.docChanges().forEach(async (change) => {
          if (change.type === 'added') {
            const data = change.doc.data();
            if (data.from !== user.uid && pc.signalingState !== 'closed') {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
              } catch (e) {
                console.warn("Failed to add ice candidate", e);
              }
            }
          }
        });
      });
      signalingUnsubs.current.set(`${participant.id}_candidates`, unsubCandidates);
    });

    return () => {
      const activeIds = new Set(activeParticipants.map(p => p.id));
      pcs.current.forEach((pc, id) => {
        if (!activeIds.has(id)) {
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
    };
  }, [user?.uid, firestore, meetingId, activeParticipants, localStreamRef.current]);

  useEffect(() => {
    if (!user || !meetingId || !firestore || !meetingData || meetingData.status === 'finished') return;
    const pRef = doc(firestore, 'meetings', meetingId, 'participants', user.uid);
    
    const syncPresence = async () => {
      let initialRole = 'participant';
      if (user.uid === meetingData.hostId) initialRole = 'host';
      else if (meetingData.isLocked && !currentUserParticipant) initialRole = 'waiting';
      else if (currentUserParticipant?.role) initialRole = currentUserParticipant.role;

      await setDoc(pRef, {
        id: user.uid,
        name: user.displayName || user.email?.split('@')[0] || 'Unknown User',
        joinedAt: currentUserParticipant?.joinedAt || serverTimestamp(),
        activeSegmentStart: serverTimestamp(),
        role: initialRole,
        isMuted: isAudioMuted,
        isVideoOff: isVideoOff,
        hasRaisedHand: hasHandRaised,
        totalDuration: currentUserParticipant?.totalDuration || 0
      }, { merge: true });
    };

    syncPresence();
  }, [user, meetingId, firestore, meetingData?.status, meetingData?.isLocked, isAudioMuted, isVideoOff, hasHandRaised, meetingData?.hostId]);

  useEffect(() => {
    if (!user || !meetingId || !firestore || !meetingData || meetingData.status === 'finished') return;
    const pRef = doc(firestore, 'meetings', meetingId, 'participants', user.uid);

    const interval = setInterval(() => {
      if (document.visibilityState === 'visible' && currentUserParticipant?.role !== 'waiting' && currentUserParticipant?.role !== 'left') {
        const now = Date.now() / 1000;
        const lastStart = currentUserParticipant?.activeSegmentStart?.seconds || now;
        const currentDuration = (currentUserParticipant?.totalDuration || 0) + (now - lastStart);
        updateDoc(pRef, { totalDuration: Math.max(0, currentDuration), activeSegmentStart: serverTimestamp() });
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [user, meetingId, firestore, meetingData?.status, currentUserParticipant?.role, currentUserParticipant?.totalDuration, currentUserParticipant?.activeSegmentStart]);

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

  const toggleLock = () => {
    if (!hasAdminPrivileges || !firestore) return;
    updateDoc(meetingRef!, { isLocked: !meetingData?.isLocked });
  };

  const stopScreenSharing = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
    }
    setIsScreenSharing(false);
    updateDoc(meetingRef!, { screenSharerId: null });
  };

  const startScreenSharing = async () => {
    if (!meetingData || !user || !firestore) return;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenStreamRef.current = stream;
      setIsScreenSharing(true);
      updateDoc(meetingRef!, { screenSharerId: user.uid });
      stream.getVideoTracks()[0].onended = () => stopScreenSharing();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Screen Share Failed', description: 'Permission for screen sharing was denied.' });
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
      const isQualified = p.role === 'host' || ratio >= 0.7;
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
      <div className="flex h-screen flex-col items-center justify-center bg-zinc-50 p-6 text-center">
        <div className="bg-primary/10 w-24 h-24 rounded-full flex items-center justify-center mb-6 animate-pulse"><Lock className="h-10 w-10 text-primary" /></div>
        <h1 className="text-3xl font-black mb-2">Meeting Restricted</h1>
        <p className="text-zinc-500 max-w-sm">The host has been notified. Please wait until you are admitted to the session.</p>
        <Button variant="ghost" className="mt-8 text-zinc-400 font-bold" onClick={() => router.push('/dashboard')}>Leave Waiting Room</Button>
      </div>
    );
  }

  if (showSummary || meetingData?.status === 'finished') {
    const totalExpectedHours = (meetingData?.totalSessionsInSeries || 1) * (meetingData?.fixedDurationHours || 0);
    const attendedHours = myCumulativeStats?.attendedHours || 0;
    const isPresentOverall = isHost || (attendedHours / (totalExpectedHours || 1)) >= 0.7;

    return (
      <div className="flex h-screen items-center justify-center bg-zinc-50 p-6">
        <Card className="w-full max-w-2xl shadow-xl rounded-3xl overflow-hidden border-none bg-white">
          <CardHeader className="text-center border-b pb-8 pt-12">
            <div className="mx-auto bg-primary/10 w-20 h-20 rounded-full flex items-center justify-center mb-4"><BookOpen className="h-10 w-10 text-primary" /></div>
            <CardTitle className="text-4xl font-black">Attendance Report</CardTitle>
            <CardDescription className="text-lg">Series: {meetingData?.name}</CardDescription>
          </CardHeader>
          <CardContent className="pt-10 space-y-10 px-10">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="bg-zinc-50 p-8 rounded-3xl border text-center shadow-sm">
                <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest mb-3">Total Hours</p>
                <div className="text-4xl font-black">{attendedHours}<span className="text-zinc-400 text-xl">/{totalExpectedHours}</span></div>
              </div>
              <div className="bg-zinc-50 p-8 rounded-3xl border text-center shadow-sm">
                <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest mb-3">Completion</p>
                <div className="text-4xl font-black">{((attendedHours / (totalExpectedHours || 1)) * 100).toFixed(0)}%</div>
              </div>
              <div className="bg-zinc-50 p-8 rounded-3xl border text-center shadow-sm">
                <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest mb-3">Sessions</p>
                <div className="text-4xl font-black">{myCumulativeStats?.sessionsAttended || 0}<span className="text-zinc-400 text-xl">/{meetingData?.totalSessionsInSeries || 1}</span></div>
              </div>
            </div>
            <div className={cn("p-10 rounded-3xl flex flex-col items-center gap-6 text-center border-4", isPresentOverall ? "bg-green-50/50 border-green-100 text-green-900" : "bg-red-50/50 border-red-100 text-red-900")}>
              {isPresentOverall ? <Trophy className="h-16 w-16" /> : <Frown className="h-16 w-16" />}
              <div><h3 className="text-3xl font-black">Status: {isPresentOverall ? 'PRESENT' : 'ABSENT'}</h3></div>
            </div>
          </CardContent>
          <CardFooter className="bg-zinc-50/80 p-10 gap-4 border-t">
            <Button variant="outline" className="flex-1 h-14 rounded-2xl font-bold" onClick={() => window.print()}><Download className="mr-2 h-5 w-5" /> Export PDF</Button>
            <Button className="flex-1 h-14 rounded-2xl font-bold" onClick={() => router.push('/dashboard')}>Back to Dashboard</Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <AuthGuard>
      <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
        <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
          {floatingReaction && (
            <div key={floatingReaction.id} className="absolute bottom-0 animate-float-up flex flex-col items-center gap-1" style={{ left: `${floatingReaction.left}%` }}>
              <div className="text-4xl filter drop-shadow-lg">{floatingReaction.emoji}</div>
              <Badge variant="secondary" className="bg-black/50 text-white border-none text-[10px] py-0 px-2 font-bold whitespace-nowrap">{floatingReaction.userName}</Badge>
            </div>
          )}
        </div>

        <header className="flex h-16 items-center justify-between border-b px-6 shrink-0 bg-card z-10">
          <div className="flex items-center gap-4">
            <div className="bg-primary p-2 rounded-lg"><VideoIcon className="h-5 w-5 text-primary-foreground" /></div>
            <div>
              <h1 className="text-sm font-bold truncate max-w-[200px]">{meetingData?.name || 'Loading session...'}</h1>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] py-0 font-mono">{meetingId}</Badge>
                {hasAdminPrivileges && (
                  <Button variant="ghost" size="sm" onClick={toggleLock} className="h-5 px-1.5 text-[10px] font-bold">
                    {meetingData?.isLocked ? <><Lock className="h-2.5 w-2.5 mr-1" /> Locked</> : <><Unlock className="h-2.5 w-2.5 mr-1" /> Open</>}
                  </Button>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex bg-muted/50 px-3 py-1.5 rounded-full border text-xs font-mono items-center gap-2 shadow-inner"><Timer className="h-3.5 w-3.5 text-primary" /> {elapsedTime}</div>
            <Separator orientation="vertical" className="h-6 mx-1" />
            <Button variant="ghost" size="icon" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/room/${meetingId}`); toast({ title: "Invite link copied!" }); }} className="rounded-full"><Share2 className="h-4 w-4" /></Button>
            {isHost ? (
              <Button onClick={endMeetingForAll} variant="destructive" disabled={isProcessingAttendance} className="rounded-full h-10 px-6 text-xs font-black uppercase tracking-tight shadow-md">
                {isProcessingAttendance ? 'Syncing...' : 'End Session'}
              </Button>
            ) : (
              <Button onClick={() => router.push('/dashboard')} variant="outline" className="rounded-full h-10 px-6 text-xs font-black uppercase tracking-tight">Leave</Button>
            )}
          </div>
        </header>

        <main className="flex-1 flex overflow-hidden p-4 gap-4 relative">
          <div className="flex-1 flex flex-col gap-4 overflow-hidden">
            <div className="flex-1 bg-zinc-900 rounded-3xl relative overflow-hidden shadow-2xl border">
               <div className="w-full h-full">
                 {isScreenSharing ? (
                   <div className="w-full h-full relative">
                      <RemoteStream stream={screenStreamRef.current} name="Your Screen" isMe={true} />
                      {!isVideoOff && (
                        <div className="absolute bottom-6 right-6 w-48 aspect-video rounded-2xl overflow-hidden border-2 border-white shadow-2xl z-20">
                          <RemoteStream stream={localStreamRef.current} name="Me" isMe={true} isVideoOff={isVideoOff} />
                        </div>
                      )}
                   </div>
                 ) : (
                   <div className="h-full w-full flex items-center justify-center p-4">
                      {featuredParticipant ? (
                        <div className="w-full h-full max-w-5xl mx-auto">
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
                        <div className="text-zinc-500 font-bold uppercase tracking-widest animate-pulse">Waiting for host...</div>
                      )}
                   </div>
                 )}
               </div>
              {hasMediaPermission === false && (
                <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/95 z-30 px-6">
                  <div className="max-w-md w-full text-center">
                    <div className="bg-destructive/10 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
                      {permissionErrorName === 'NotAllowedError' ? <Lock className="h-10 w-10 text-destructive" /> : <AlertCircle className="h-10 w-10 text-destructive" />}
                    </div>
                    <h2 className="text-white text-xl font-bold mb-2">{permissionErrorName === 'NotAllowedError' ? 'Permission Denied' : 'Hardware Access Required'}</h2>
                    <p className="text-zinc-400 text-sm mb-8 leading-relaxed">Please ensure you have granted camera and microphone access in your browser settings to join the session.</p>
                    <Button variant="secondary" className="w-full h-14 rounded-2xl font-bold shadow-lg" onClick={() => window.location.reload()}><RefreshCcw className="mr-2 h-5 w-5" /> Retry Connection</Button>
                  </div>
                </div>
              )}
            </div>

            <div className="h-20 bg-card rounded-3xl border shadow-xl flex items-center justify-center px-6 gap-4 shrink-0">
               <Button variant={isAudioMuted ? "destructive" : "secondary"} size="icon" onClick={handleToggleAudio} className="rounded-full h-12 w-12 shadow-sm">{isAudioMuted ? <MicOff /> : <Mic />}</Button>
               <Button variant={isVideoOff ? "destructive" : "secondary"} size="icon" onClick={handleToggleVideo} disabled={isTogglingVideo} className="rounded-full h-12 w-12 shadow-sm">{isVideoOff ? <VideoOff /> : <VideoIcon />}</Button>
               <Separator orientation="vertical" className="h-8 mx-2" />
               <Button variant={isScreenSharing ? "default" : "secondary"} size="icon" onClick={isScreenSharing ? stopScreenSharing : startScreenSharing} className={cn("rounded-full h-12 w-12 shadow-sm", isScreenSharing && "bg-blue-600 hover:bg-blue-700")}>{isScreenSharing ? <ScreenShareOff /> : <ScreenShare />}</Button>
               <Button variant={hasHandRaised ? "default" : "secondary"} size="icon" onClick={() => { const ns = !hasHandRaised; setHasHandRaised(ns); updateDoc(doc(firestore!, 'meetings', meetingId, 'participants', user!.uid), { hasRaisedHand: ns }); }} className={cn("rounded-full h-12 w-12 shadow-sm", hasHandRaised && "bg-yellow-400 text-yellow-900 hover:bg-yellow-500")}><Hand /></Button>
               <Popover open={isReactionOpen} onOpenChange={setIsReactionOpen}>
                  <PopoverTrigger asChild><Button variant="secondary" size="icon" className="rounded-full h-12 w-12 shadow-sm"><Smile /></Button></PopoverTrigger>
                  <PopoverContent className="w-auto p-3 grid grid-cols-4 gap-3 rounded-2xl shadow-2xl border-none bg-white">
                     {['👍', '👏', '🔥', '❤️', '😮', '🎉', '💡', '💯'].map(emoji => (
                       <Button key={emoji} variant="ghost" className="h-12 w-12 p-0 text-2xl hover:bg-zinc-100" onClick={() => handleReact(emoji)}>{emoji}</Button>
                     ))}
                  </PopoverContent>
               </Popover>
               <Separator orientation="vertical" className="h-8 mx-2" />
               <Dialog>
                 <DialogTrigger asChild><Button variant="secondary" size="icon" className="rounded-full h-12 w-12 shadow-sm"><BarChart3 /></Button></DialogTrigger>
                 <DialogContent className="max-w-4xl rounded-3xl p-0 overflow-hidden border-none shadow-2xl">
                    <DialogHeader className="p-8 bg-zinc-50 border-b">
                      <DialogTitle className="text-2xl font-black">Session Participation</DialogTitle>
                      <DialogDescription className="font-medium">Real-time engagement tracking for {meetingData?.name}</DialogDescription>
                    </DialogHeader>
                    <div className="p-8">
                       <Table>
                          <TableHeader><TableRow className="border-none hover:bg-transparent"><TableHead className="font-black text-xs uppercase tracking-widest">Student</TableHead><TableHead className="font-black text-xs uppercase tracking-widest">Status</TableHead><TableHead className="font-black text-xs uppercase tracking-widest">Join Time</TableHead><TableHead className="text-right font-black text-xs uppercase tracking-widest">Active Time</TableHead><TableHead className="text-right font-black text-xs uppercase tracking-widest">Credit</TableHead></TableRow></TableHeader>
                          <TableBody>
                             {activeParticipants.map(p => {
                               const lastStart = p.activeSegmentStart?.seconds || currentTime;
                               const dur = (p.totalDuration || 0) + (currentTime - lastStart);
                               const meetingElapsed = Math.max(1, currentTime - (meetingData?.createdAt?.seconds || currentTime));
                               const ratio = meetingElapsed > 0 ? dur / meetingElapsed : 0;
                               const isQualified = p.role === 'host' || ratio >= 0.7;
                               return (
                                 <TableRow key={p.id} className="border-b border-zinc-50 hover:bg-zinc-50/50">
                                    <TableCell className="font-bold">{p.name} {p.id === user?.uid && <span className="text-primary/60 font-medium ml-1">(You)</span>}</TableCell>
                                    <TableCell><Badge variant="outline" className="capitalize font-bold border-zinc-200">{p.role}</Badge></TableCell>
                                    <TableCell className="text-muted-foreground font-medium">{p.joinedAt ? format(new Date(p.joinedAt.seconds * 1000), 'p') : '--'}</TableCell>
                                    <TableCell className="text-right font-mono font-bold text-zinc-600">{formatDuration(dur)}</TableCell>
                                    <TableCell className="text-right"><Badge className={cn("font-black", isQualified ? "bg-green-100 text-green-700 border-none" : "bg-zinc-100 text-zinc-400 border-none")}>{isQualified ? 'Qualified' : 'Pending'}</Badge></TableCell>
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

          <Card className="w-80 flex flex-col overflow-hidden border shadow-xl shrink-0 rounded-3xl bg-card">
             <Tabs defaultValue="participants" className="flex-1 flex flex-col overflow-hidden">
                <div className="px-4 pt-4 border-b bg-zinc-50/50">
                   <TabsList className="w-full h-12 grid grid-cols-2 rounded-2xl bg-zinc-200/50 p-1">
                      <TabsTrigger value="participants" className="rounded-xl flex items-center gap-2 font-bold transition-all data-[state=active]:bg-white data-[state=active]:shadow-sm"><Users className="h-4 w-4" /> Students</TabsTrigger>
                      <TabsTrigger value="chat" className="rounded-xl flex items-center gap-2 font-bold transition-all data-[state=active]:bg-white data-[state=active]:shadow-sm"><MessageSquare className="h-4 w-4" /> Chat</TabsTrigger>
                   </TabsList>
                </div>

                <TabsContent value="participants" className="flex-1 flex flex-col overflow-hidden mt-0">
                   <ScrollArea className="flex-1 p-4">
                      <div className="space-y-6">
                        {waitingParticipants.length > 0 && hasAdminPrivileges && (
                          <div className="space-y-3">
                             <div className="text-[10px] font-black uppercase tracking-widest text-zinc-400 px-2 flex items-center gap-2">
                               <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" /> Waiting Room
                             </div>
                             {waitingParticipants.map(p => (
                               <div key={p.id} className="bg-zinc-50 p-3 rounded-2xl border border-zinc-100 space-y-3">
                                  <div className="flex items-center gap-2">
                                    <Avatar className="h-8 w-8"><AvatarFallback className="text-[10px]">{p.name[0]}</AvatarFallback></Avatar>
                                    <span className="text-xs font-bold truncate">{p.name}</span>
                                  </div>
                                  <div className="flex gap-2">
                                    <Button size="sm" onClick={() => admitParticipant(p.id)} className="flex-1 h-8 text-[10px] font-black uppercase">Admit</Button>
                                    <Button size="sm" variant="ghost" onClick={() => removeParticipant(p.id)} className="flex-1 h-8 text-[10px] font-black uppercase text-zinc-400">Decline</Button>
                                  </div>
                               </div>
                             ))}
                             <Separator className="my-4" />
                          </div>
                        )}

                        <div className="space-y-4">
                          {participants?.filter(p => p.role !== 'waiting' && p.role !== 'left').map(p => {
                            const isMe = p.id === user?.uid;
                            return (
                              <div key={p.id} className="group flex items-center gap-3 p-2 rounded-2xl hover:bg-zinc-50 transition-colors">
                                 <div className="relative">
                                   <Avatar className="h-10 w-10 border-2 border-white shadow-sm">
                                      <AvatarFallback className="bg-primary/5 text-primary font-black text-xs">{p.name[0]}</AvatarFallback>
                                   </Avatar>
                                   {p.hasRaisedHand && <div className="absolute -top-1 -right-1 bg-yellow-400 rounded-full p-1.5 border-2 border-white shadow-lg animate-bounce z-10"><Hand className="h-2.5 w-2.5 text-yellow-900" /></div>}
                                 </div>
                                 <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                       <div className="text-xs font-black truncate text-zinc-800">{p.name}</div>
                                       {p.role === 'host' && <Shield className="h-3 w-3 text-blue-500" />}
                                       {p.role === 'co-host' && <Star className="h-3 w-3 text-yellow-500" />}
                                    </div>
                                    <div className="flex items-center gap-3 mt-1 text-[10px] text-zinc-400 font-bold uppercase tracking-widest">
                                       {p.isMuted ? <MicOff className="h-3 w-3 text-red-500" /> : <Mic className="h-3 w-3 text-green-500" />}
                                       {p.isVideoOff ? <VideoOff className="h-3 w-3 text-zinc-300" /> : <VideoIcon className="h-3 w-3 text-primary" />}
                                       {!isMe && hasAdminPrivileges && (
                                         <Popover>
                                            <PopoverTrigger asChild><Button variant="ghost" size="icon" className="h-4 w-4 opacity-0 group-hover:opacity-100"><Shield className="h-3 w-3" /></Button></PopoverTrigger>
                                            <PopoverContent className="w-48 p-2 rounded-2xl border-none shadow-2xl bg-white" align="end">
                                               <div className="grid gap-1">
                                                  <Button variant="ghost" size="sm" onClick={() => p.isMuted ? requestUnmute(p.id) : forceMute(p.id)} className="justify-start h-9 text-[10px] font-bold uppercase">
                                                    {p.isMuted ? <><Mic className="h-3 w-3 mr-2" /> Request Unmute</> : <><MicOff className="h-3 w-3 mr-2 text-red-500" /> Force Mute</>}
                                                  </Button>
                                                  {isHost && p.role === 'participant' && (
                                                    <Button variant="ghost" size="sm" onClick={() => promoteToCoHost(p.id)} className="justify-start h-9 text-[10px] font-bold uppercase">
                                                       <Star className="h-3 w-3 mr-2 text-yellow-500" /> Make Co-host
                                                    </Button>
                                                  )}
                                                  <Button variant="ghost" size="sm" onClick={() => removeParticipant(p.id)} className="justify-start h-9 text-[10px] font-bold uppercase text-red-500 hover:text-red-600 hover:bg-red-50">
                                                     <UserMinus className="h-3 w-3 mr-2" /> Kick Out
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
                   <div className="p-5 bg-zinc-50/80 border-t">
                      <div className="space-y-4">
                         <div className="flex justify-between text-[10px] uppercase font-black text-zinc-400 tracking-widest px-1">
                            <div>Series Progress</div>
                            <div className="text-primary">{myCumulativeStats?.attendedHours || 0}h Earned</div>
                         </div>
                         <div className="h-2.5 w-full bg-zinc-200 rounded-full overflow-hidden shadow-inner">
                            <div 
                              className="h-full bg-primary transition-all duration-1000" 
                              style={{ width: `${Math.min(100, (myCumulativeStats?.attendedHours || 0) / Math.max(1, (meetingData?.totalSessionsInSeries || 1) * (meetingData?.fixedDurationHours || 0)) * 100)}%` }} 
                            />
                         </div>
                      </div>
                   </div>
                </TabsContent>

                <TabsContent value="chat" className="flex-1 flex flex-col overflow-hidden mt-0">
                   <ScrollArea className="flex-1 p-6">
                      <div className="space-y-6">
                         {chatMessages?.map((msg) => (
                           <div key={msg.id} className={cn("flex flex-col gap-1.5", msg.senderId === user?.uid ? "items-end" : "items-start")}>
                              <div className="text-[10px] font-black text-zinc-400 px-1 uppercase tracking-wider">{msg.senderName}</div>
                              <div className={cn("max-w-[85%] px-4 py-3 rounded-2xl text-xs font-medium shadow-sm", msg.senderId === user?.uid ? "bg-primary text-primary-foreground rounded-tr-none" : "bg-white border rounded-tl-none")}>{msg.text}</div>
                           </div>
                         ))}
                      </div>
                   </ScrollArea>
                   <div className="p-4 border-t bg-white">
                      <div className="relative flex items-center">
                        <Input placeholder="Type message..." value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()} className="pr-12 rounded-2xl h-12 bg-zinc-50 border-zinc-100" />
                        <Button size="icon" variant="ghost" onClick={handleSendMessage} className="absolute right-1 top-1/2 -translate-y-1/2 h-10 w-10 text-primary hover:bg-transparent"><Send className="h-5 w-5" /></Button>
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

