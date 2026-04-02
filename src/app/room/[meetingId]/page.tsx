
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
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(e => console.warn("Auto-play blocked or failed", e));
    }
  }, [stream]);

  return (
    <div className={cn("relative w-full h-full bg-zinc-800 rounded-3xl overflow-hidden group border shadow-sm flex items-center justify-center transition-all", isFeatured && "border-primary/20 shadow-2xl bg-zinc-900")}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isMe}
        className={cn("w-full h-full object-cover transition-opacity duration-500", (isVideoOff && !isMe) ? "opacity-0" : "opacity-100")}
      />
      {(isVideoOff && !isMe && !isFeatured) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900 z-10 transition-all">
           <div className="rounded-full bg-zinc-800 flex items-center justify-center w-16 h-16 shadow-inner border border-white/5">
              <UserIcon className="text-zinc-600 h-8 w-8" />
           </div>
           <div className="text-zinc-500 mt-4 font-bold tracking-tight uppercase tracking-widest text-[10px]">Camera Off</div>
        </div>
      )}
      {isVideoOff && !isMe && isFeatured && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900 z-10 transition-all">
           <div className="rounded-full bg-zinc-800 flex items-center justify-center w-32 h-32 shadow-inner border border-white/5">
              <UserIcon className="text-zinc-600 h-16 w-16" />
           </div>
           <div className="text-zinc-500 mt-6 font-bold tracking-tight uppercase tracking-widest text-sm">Waiting for Video</div>
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
        toast({ variant: 'destructive', title: 'Camera Error!', description: 'Could not access camera hardware.' });
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
    if (!user || !firestore || !meetingId || !hasMediaPermission || !activeParticipants.length) return;

    activeParticipants.forEach(async (participant) => {
      if (participant.id === user.uid || pcs.current.has(participant.id)) return;

      const pc = new RTCPeerConnection(ICE_SERVERS);
      pcs.current.set(participant.id, pc);

      const audioTransceiver = pc.addTransceiver('audio', { direction: 'sendrecv', streams: [localStreamRef.current!] });
      const videoTransceiver = pc.addTransceiver('video', { direction: 'sendrecv', streams: [localStreamRef.current!] });

      const audioTrack = localStreamRef.current?.getAudioTracks()[0];
      const videoTrack = localStreamRef.current?.getVideoTracks()[0];
      if (audioTrack) audioTransceiver.sender.replaceTrack(audioTrack);
      if (videoTrack) videoTransceiver.sender.replaceTrack(videoTrack);

      pc.ontrack = (event) => {
        if (pc.signalingState === 'closed') return;
        setRemoteStreams(prev => {
          const next = new Map(prev);
          const existingStream = next.get(participant.id) || new MediaStream();
          existingStream.addTrack(event.track);
          // Return a new MediaStream instance to trigger re-renders in RemoteStream
          next.set(participant.id, new MediaStream(existingStream.getTracks()));
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
              } catch (e) { console.warn("SetRemoteDescription failed", e); }
            }
          });
          signalingUnsubs.current.set(`${participant.id}_channel`, unsubChannel);
        } catch (err) {
          console.warn("Failed to create offer", err);
        }
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
            } catch (err) {
              console.warn("Signaling handling error", err);
            }
          }
        });
        signalingUnsubs.current.set(`${participant.id}_channel`, unsubChannel);
      }

      const unsubCandidates = onSnapshot(collection(channelRef, 'candidates'), (snapshot) => {
        if (pc.signalingState === 'closed') return;
        snapshot.docChanges().forEach(async (change) => {
          if (change.type === 'added') {
            const data = change.doc.data();
            if (data.from !== user.uid && pc.signalingState !== 'closed' && pc.remoteDescription) {
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
  }, [user?.uid, firestore, meetingId, activeParticipants, hasMediaPermission]);

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

  if (showSummary || (meetingData?.status === 'finished' && user)) {
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
      <div className="flex h-screen w-full flex-col overflow-hidden bg-[#F8F9FB]">
        <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
          {floatingReaction && (
            <div key={floatingReaction.id} className="absolute bottom-0 animate-float-up flex flex-col items-center gap-1" style={{ left: `${floatingReaction.left}%` }}>
              <div className="text-4xl filter drop-shadow-lg">{floatingReaction.emoji}</div>
              <Badge variant="secondary" className="bg-black/50 text-white border-none text-[10px] py-0 px-2 font-bold whitespace-nowrap">{floatingReaction.userName}</Badge>
            </div>
          )}
        </div>

        <header className="flex h-16 items-center justify-between px-8 bg-white border-b z-10">
          <div className="flex items-center gap-6">
            <div className="bg-zinc-900 flex items-center justify-center h-10 w-10 rounded-xl text-white font-black text-lg">CV</div>
            <div className="flex items-center gap-4">
               <div className="flex flex-col">
                  <h1 className="text-sm font-bold truncate max-w-[200px] leading-tight">{meetingData?.name || 'Loading session...'}</h1>
                  <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">{meetingData?.isLocked ? 'Restricted Session' : 'Public Session'}</p>
               </div>
               <div className="flex items-center bg-zinc-50 px-3 py-1.5 rounded-full border gap-2 cursor-pointer hover:bg-zinc-100 transition-colors" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/room/${meetingId}`); toast({ title: "Invite link copied!" }); }}>
                 <span className="text-[11px] font-mono text-zinc-500">{meetingId}</span>
                 <Share2 className="h-3 w-3 text-zinc-400" />
               </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-zinc-50 border rounded-full px-4 py-2 text-xs font-bold text-zinc-600 shadow-sm"><Timer className="h-3.5 w-3.5" /> {elapsedTime}</div>
            {isHost ? (
              <Button onClick={endMeetingForAll} variant="destructive" disabled={isProcessingAttendance} className="rounded-full h-11 px-8 font-black uppercase text-xs tracking-wider shadow-lg bg-[#FF4545] hover:bg-red-600">
                {isProcessingAttendance ? 'Syncing...' : 'End Session'}
              </Button>
            ) : (
              <Button onClick={() => router.push('/dashboard')} variant="outline" className="rounded-full h-11 px-8 font-black uppercase text-xs tracking-wider">Leave</Button>
            )}
          </div>
        </header>

        <main className="flex-1 flex overflow-hidden p-6 gap-6 relative">
          <div className="flex-1 flex flex-col gap-6 overflow-hidden">
            <div className="flex-1 bg-zinc-900 rounded-[2.5rem] relative overflow-hidden shadow-2xl border border-white/5">
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
                        <div className="absolute bottom-8 right-8 w-56 aspect-video rounded-3xl overflow-hidden border-2 border-white/20 shadow-2xl z-20">
                          <RemoteStream stream={localStreamRef.current} name="Me" isMe={true} isVideoOff={isVideoOff} />
                        </div>
                      )}
                   </div>
                 ) : (
                   <div className="h-full w-full flex items-center justify-center p-6">
                      {featuredParticipant ? (
                        <div className="w-full h-full max-w-[1200px] mx-auto">
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
                        <div className="text-zinc-500 font-bold uppercase tracking-[0.5em] animate-pulse">Initializing...</div>
                      )}
                   </div>
                 )}
               </div>
              {hasMediaPermission === false && (
                <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/95 z-30 px-6">
                  <div className="max-w-md w-full text-center">
                    <div className="bg-destructive/10 w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-8">
                      {permissionErrorName === 'NotAllowedError' ? <Lock className="h-12 w-12 text-destructive" /> : <AlertCircle className="h-12 w-12 text-destructive" />}
                    </div>
                    <h2 className="text-white text-2xl font-black mb-3">{permissionErrorName === 'NotAllowedError' ? 'Permission Denied' : 'Hardware Access Required'}</h2>
                    <p className="text-zinc-500 text-sm mb-10 leading-relaxed font-medium">Please ensure you have granted camera and microphone access in your browser settings to join the session.</p>
                    <Button variant="secondary" className="w-full h-14 rounded-2xl font-black shadow-lg uppercase tracking-wider" onClick={() => window.location.reload()}><RefreshCcw className="mr-3 h-5 w-5" /> Retry Connection</Button>
                  </div>
                </div>
              )}
            </div>

            <div className="h-24 mx-auto w-fit bg-white rounded-full border shadow-2xl flex items-center px-10 gap-4 shrink-0 -mt-12 z-20 transition-transform hover:scale-[1.02]">
               <Button variant={isAudioMuted ? "destructive" : "secondary"} size="icon" onClick={handleToggleAudio} className={cn("rounded-full h-14 w-14 shadow-lg transition-all", isAudioMuted ? "bg-[#FF4545] hover:bg-red-600" : "bg-zinc-100 hover:bg-zinc-200")}>{isAudioMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6 text-zinc-700" />}</Button>
               <Button variant={isVideoOff ? "destructive" : "secondary"} size="icon" onClick={handleToggleVideo} disabled={isTogglingVideo} className={cn("rounded-full h-14 w-14 shadow-lg transition-all", isVideoOff ? "bg-[#FF4545] hover:bg-red-600" : "bg-zinc-100 hover:bg-zinc-200")}>{isVideoOff ? <VideoOff className="h-6 w-6" /> : <VideoIcon className="h-6 w-6 text-zinc-700" />}</Button>
               <Separator orientation="vertical" className="h-10 mx-4 bg-zinc-100" />
               <Button variant={isScreenSharing ? "default" : "secondary"} size="icon" onClick={isScreenSharing ? stopScreenSharing : startScreenSharing} className={cn("rounded-full h-14 w-14 shadow-lg transition-all", isScreenSharing ? "bg-blue-600 hover:bg-blue-700" : "bg-zinc-50 hover:bg-zinc-100")}>{isScreenSharing ? <ScreenShareOff className="h-6 w-6" /> : <ScreenShare className="h-6 w-6 text-zinc-500" />}</Button>
               <Button variant={hasHandRaised ? "default" : "secondary"} size="icon" onClick={() => { const ns = !hasHandRaised; setHasHandRaised(ns); updateDoc(doc(firestore!, 'meetings', meetingId, 'participants', user!.uid), { hasRaisedHand: ns }); }} className={cn("rounded-full h-14 w-14 shadow-lg transition-all", hasHandRaised ? "bg-yellow-400 text-yellow-900 hover:bg-yellow-500 shadow-yellow-200" : "bg-zinc-50 hover:bg-zinc-100")}><Hand className="h-6 w-6" /></Button>
               <Popover open={isReactionOpen} onOpenChange={setIsReactionOpen}>
                  <PopoverTrigger asChild><Button variant="secondary" size="icon" className="rounded-full h-14 w-14 shadow-lg transition-all bg-zinc-50 hover:bg-zinc-100"><Smile className="h-6 w-6 text-zinc-500" /></Button></PopoverTrigger>
                  <PopoverContent className="w-auto p-4 grid grid-cols-4 gap-4 rounded-[2rem] shadow-2xl border-none bg-white">
                     {['👍', '👏', '🔥', '❤️', '😮', '🎉', '💡', '💯'].map(emoji => (
                       <Button key={emoji} variant="ghost" className="h-14 w-14 p-0 text-3xl hover:bg-zinc-50 transition-transform active:scale-90" onClick={() => handleReact(emoji)}>{emoji}</Button>
                     ))}
                  </PopoverContent>
               </Popover>
               <Separator orientation="vertical" className="h-10 mx-4 bg-zinc-100" />
               <Dialog>
                 <DialogTrigger asChild><Button variant="secondary" size="icon" className="rounded-full h-14 w-14 shadow-lg transition-all bg-zinc-50 hover:bg-zinc-100"><BarChart3 className="h-6 w-6 text-zinc-500" /></Button></DialogTrigger>
                 <DialogContent className="max-w-4xl rounded-[2.5rem] p-0 overflow-hidden border-none shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)]">
                    <DialogHeader className="p-10 bg-zinc-50 border-b">
                      <DialogTitle className="text-3xl font-black">Session Participation</DialogTitle>
                      <DialogDescription className="font-bold text-zinc-400 uppercase tracking-widest text-[11px]">Real-time engagement tracking for {meetingData?.name}</DialogDescription>
                    </DialogHeader>
                    <div className="p-10">
                       <Table>
                          <TableHeader><TableRow className="border-none hover:bg-transparent"><TableHead className="font-black text-[11px] uppercase tracking-widest text-zinc-400">Student</TableHead><TableHead className="font-black text-[11px] uppercase tracking-widest text-zinc-400">Status</TableHead><TableHead className="font-black text-[11px] uppercase tracking-widest text-zinc-400">Join Time</TableHead><TableHead className="text-right font-black text-[11px] uppercase tracking-widest text-zinc-400">Active Time</TableHead><TableHead className="text-right font-black text-[11px] uppercase tracking-widest text-zinc-400">Credit</TableHead></TableRow></TableHeader>
                          <TableBody>
                             {activeParticipants.map(p => {
                               const lastStart = p.activeSegmentStart?.seconds || currentTime;
                               const dur = (p.totalDuration || 0) + (currentTime - lastStart);
                               const meetingElapsed = Math.max(1, currentTime - (meetingData?.createdAt?.seconds || currentTime));
                               const ratio = meetingElapsed > 0 ? dur / meetingElapsed : 0;
                               const isQualified = p.role === 'host' || ratio >= 0.7;
                               return (
                                 <TableRow key={p.id} className="border-b border-zinc-50 hover:bg-zinc-50/50">
                                    <TableCell className="font-bold text-zinc-900">{p.name} {p.id === user?.uid && <span className="text-primary/60 font-medium ml-1">(You)</span>}</TableCell>
                                    <TableCell><Badge variant="outline" className="capitalize font-black border-zinc-200 text-[10px] tracking-wide">{p.role}</Badge></TableCell>
                                    <TableCell className="text-muted-foreground font-bold text-[11px]">{p.joinedAt ? format(new Date(p.joinedAt.seconds * 1000), 'p') : '--'}</TableCell>
                                    <TableCell className="text-right font-mono font-black text-zinc-700 text-[11px]">{formatDuration(dur)}</TableCell>
                                    <TableCell className="text-right"><Badge className={cn("font-black text-[9px] uppercase tracking-widest px-3 py-1", isQualified ? "bg-green-100 text-green-700 border-none" : "bg-zinc-100 text-zinc-400 border-none")}>{isQualified ? 'Qualified' : 'Pending'}</Badge></TableCell>
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

          <Card className="w-96 flex flex-col overflow-hidden border shadow-2xl shrink-0 rounded-[2.5rem] bg-white">
             <Tabs defaultValue="participants" className="flex-1 flex flex-col overflow-hidden">
                <div className="px-6 pt-6 pb-2 border-b bg-zinc-50/30">
                   <TabsList className="w-full h-14 grid grid-cols-2 rounded-2xl bg-zinc-100 p-1.5 shadow-inner">
                      <TabsTrigger value="participants" className="rounded-xl flex items-center gap-2 font-black text-[11px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-lg"><Users className="h-4 w-4" /> Students</TabsTrigger>
                      <TabsTrigger value="chat" className="rounded-xl flex items-center gap-2 font-black text-[11px] uppercase tracking-widest transition-all data-[state=active]:bg-white data-[state=active]:text-primary data-[state=active]:shadow-lg"><MessageSquare className="h-4 w-4" /> Chat</TabsTrigger>
                   </TabsList>
                </div>

                <TabsContent value="participants" className="flex-1 flex flex-col overflow-hidden mt-0">
                   <ScrollArea className="flex-1 p-6">
                      <div className="space-y-8">
                        {waitingParticipants.length > 0 && hasAdminPrivileges && (
                          <div className="space-y-4">
                             <div className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400 px-2 flex items-center gap-3">
                               <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse shadow-sm shadow-yellow-200" /> Waiting Room
                             </div>
                             {waitingParticipants.map(p => (
                               <div key={p.id} className="bg-zinc-50 p-4 rounded-3xl border border-zinc-100 space-y-4 shadow-sm">
                                  <div className="flex items-center gap-3">
                                    <Avatar className="h-10 w-10 border-2 border-white shadow-md"><AvatarFallback className="text-xs font-black bg-zinc-100">{p.name[0]}</AvatarFallback></Avatar>
                                    <span className="text-xs font-black truncate text-zinc-700">{p.name}</span>
                                  </div>
                                  <div className="flex gap-3">
                                    <Button size="sm" onClick={() => admitParticipant(p.id)} className="flex-1 h-10 text-[10px] font-black uppercase tracking-widest rounded-xl shadow-md">Admit</Button>
                                    <Button size="sm" variant="ghost" onClick={() => removeParticipant(p.id)} className="flex-1 h-10 text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-red-500 rounded-xl">Decline</Button>
                                  </div>
                               </div>
                             ))}
                             <Separator className="my-6 opacity-50" />
                          </div>
                        )}

                        <div className="space-y-5">
                          {participants?.filter(p => p.role !== 'waiting' && p.role !== 'left').map(p => {
                            const isMe = p.id === user?.uid;
                            return (
                              <div key={p.id} className="group flex items-center gap-4 p-3 rounded-3xl hover:bg-zinc-50 transition-all border border-transparent hover:border-zinc-100">
                                 <div className="relative">
                                   <Avatar className="h-12 w-12 border-2 border-white shadow-md">
                                      <AvatarFallback className="bg-zinc-100 text-zinc-800 font-black text-xs">{p.name[0]}</AvatarFallback>
                                   </Avatar>
                                   {p.hasRaisedHand && <div className="absolute -top-1 -right-1 bg-yellow-400 rounded-full p-2 border-2 border-white shadow-xl animate-bounce z-10"><Hand className="h-2.5 w-2.5 text-yellow-900" /></div>}
                                 </div>
                                 <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                       <div className="text-[13px] font-black truncate text-zinc-900">{p.name}</div>
                                       {p.role === 'host' && <Shield className="h-3.5 w-3.5 text-blue-500" />}
                                       {p.role === 'co-host' && <Star className="h-3.5 w-3.5 text-yellow-500" />}
                                    </div>
                                    <div className="flex items-center gap-3 mt-1.5">
                                       {p.isMuted ? <MicOff className="h-3.5 w-3.5 text-[#FF4545]" /> : <Mic className="h-3.5 w-3.5 text-green-500" />}
                                       {p.isVideoOff ? <VideoOff className="h-3.5 w-3.5 text-zinc-200" /> : <VideoIcon className="h-3.5 w-3.5 text-primary/40" />}
                                       {!isMe && hasAdminPrivileges && (
                                         <Popover>
                                            <PopoverTrigger asChild><Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"><Shield className="h-3.5 w-3.5 text-zinc-300" /></Button></PopoverTrigger>
                                            <PopoverContent className="w-56 p-3 rounded-3xl border-none shadow-[0_20px_50px_rgba(0,0,0,0.15)] bg-white" align="end">
                                               <div className="grid gap-2">
                                                  <Button variant="ghost" size="sm" onClick={() => p.isMuted ? requestUnmute(p.id) : forceMute(p.id)} className="justify-start h-10 text-[10px] font-black uppercase tracking-wider rounded-xl">
                                                    {p.isMuted ? <><Mic className="h-4 w-4 mr-3" /> Request Unmute</> : <><MicOff className="h-4 w-4 mr-3 text-[#FF4545]" /> Force Mute</>}
                                                  </Button>
                                                  {isHost && p.role === 'participant' && (
                                                    <Button variant="ghost" size="sm" onClick={() => promoteToCoHost(p.id)} className="justify-start h-10 text-[10px] font-black uppercase tracking-wider rounded-xl">
                                                       <Star className="h-4 w-4 mr-3 text-yellow-500" /> Make Co-host
                                                    </Button>
                                                  )}
                                                  <Button variant="ghost" size="sm" onClick={() => removeParticipant(p.id)} className="justify-start h-10 text-[10px] font-black uppercase tracking-wider text-[#FF4545] hover:text-red-600 hover:bg-red-50 rounded-xl">
                                                     <UserMinus className="h-4 w-4 mr-3" /> Kick Out
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
                   <div className="p-8 bg-zinc-50/50 border-t">
                      <div className="space-y-5">
                         <div className="flex justify-between text-[10px] uppercase font-black text-zinc-400 tracking-widest px-1">
                            <div>Series Progress</div>
                            <div className="text-primary">{myCumulativeStats?.attendedHours || 0}h / {((meetingData?.totalSessionsInSeries || 1) * (meetingData?.fixedDurationHours || 0))}h</div>
                         </div>
                         <div className="h-3 w-full bg-zinc-100 rounded-full overflow-hidden shadow-inner border border-zinc-200/50">
                            <div 
                              className="h-full bg-zinc-900 transition-all duration-1000 shadow-sm" 
                              style={{ width: `${Math.min(100, (myCumulativeStats?.attendedHours || 0) / Math.max(1, (meetingData?.totalSessionsInSeries || 1) * (meetingData?.fixedDurationHours || 0)) * 100)}%` }} 
                            />
                         </div>
                      </div>
                   </div>
                </TabsContent>

                <TabsContent value="chat" className="flex-1 flex flex-col overflow-hidden mt-0">
                   <ScrollArea className="flex-1 p-8">
                      <div className="space-y-8">
                         {chatMessages?.map((msg) => (
                           <div key={msg.id} className={cn("flex flex-col gap-2", msg.senderId === user?.uid ? "items-end" : "items-start")}>
                              <div className="text-[10px] font-black text-zinc-400 px-2 uppercase tracking-[0.1em]">{msg.senderName}</div>
                              <div className={cn("max-w-[85%] px-5 py-4 rounded-[1.5rem] text-[13px] font-bold leading-relaxed shadow-sm", msg.senderId === user?.uid ? "bg-zinc-900 text-white rounded-tr-none" : "bg-zinc-50 text-zinc-800 border rounded-tl-none")}>{msg.text}</div>
                           </div>
                         ))}
                      </div>
                   </ScrollArea>
                   <div className="p-6 border-t bg-white">
                      <div className="relative flex items-center">
                        <Input placeholder="Type a message..." value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()} className="pr-14 rounded-full h-14 bg-zinc-50 border-zinc-100 focus-visible:ring-zinc-900 pl-6 font-bold text-sm" />
                        <Button size="icon" variant="ghost" onClick={handleSendMessage} className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 text-zinc-900 hover:bg-transparent"><Send className="h-5 w-5" /></Button>
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
