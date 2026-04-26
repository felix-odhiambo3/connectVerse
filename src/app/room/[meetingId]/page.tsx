
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
  getDoc,
  writeBatch,
} from 'firebase/firestore';
import AuthGuard from '@/components/auth/AuthGuard';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { 
  Mic, 
  MicOff, 
  Video as VideoIcon, 
  VideoOff, 
  Send, 
  Hand, 
  User as UserIcon, 
  MessageSquare, 
  Users, 
  Trophy,
  ScreenShare,
  StopCircle,
  Monitor,
  Link as LinkIcon,
  Smile,
  Captions,
  Lock,
  ShieldCheck,
  UserPlus,
  UserX,
  Pin,
  PinOff,
  Maximize,
  Minimize,
  Settings,
  Check,
  AlertCircle,
  Download,
  Search,
  ChevronLeft,
  CheckCircle2,
  XCircle,
  Repeat
} from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { cn } from "@/lib/utils";
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from '@/components/ui/skeleton';
import { setDocumentNonBlocking, addDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';

interface Participant {
  id: string;
  name: string;
  joinedAt: Timestamp | null;
  lastJoinTime: Timestamp | null;
  accumulatedSeconds: number;
  role: 'host' | 'co-host' | 'participant' | 'waiting' | 'left';
  hasRaisedHand?: boolean;
  raisedAt?: Timestamp | null;
  isMuted?: boolean;
  isVideoOff?: boolean;
  cameraStreamId?: string;
  screenStreamId?: string;
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
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
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

function useAudioLevel(stream: MediaStream | null) {
  const [level, setLevel] = useState(0);
  const analyzerRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) {
      setLevel(0);
      return;
    }

    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    const analyzer = audioContext.createAnalyser();
    analyzer.fftSize = 256;
    source.connect(analyzer);
    analyzerRef.current = analyzer;

    const update = () => {
      if (!analyzerRef.current) return;
      const dataArray = new Uint8Array(analyzerRef.current.frequencyBinCount);
      analyzerRef.current.getByteFrequencyData(dataArray);
      let values = 0;
      for (let i = 0; i < dataArray.length; i++) {
        values += dataArray[i];
      }
      const average = values / dataArray.length;
      setLevel(average);
      rafRef.current = requestAnimationFrame(update);
    };

    update();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      audioContext.close();
    };
  }, [stream]);

  return level;
}

function AudioLevelIndicator({ stream, isMuted }: { stream: MediaStream | null, isMuted: boolean }) {
  const level = useAudioLevel(isMuted ? null : stream);
  const height = Math.min(100, (level / 128) * 100);
  
  if (isMuted) return null;

  return (
    <div className="flex items-end gap-[1px] md:gap-[2px] h-2 md:h-3 w-3 md:w-4">
      <div className="w-0.5 md:w-1 bg-primary rounded-full transition-all duration-75" style={{ height: `${Math.max(20, height * 0.4)}%` }} />
      <div className="w-0.5 md:w-1 bg-primary rounded-full transition-all duration-75" style={{ height: `${Math.max(20, height * 1.0)}%` }} />
      <div className="w-0.5 md:w-1 bg-primary rounded-full transition-all duration-75" style={{ height: `${Math.max(20, height * 0.6)}%` }} />
    </div>
  );
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
      <div className="text-3xl md:text-5xl drop-shadow-2xl filter saturate-150">{reaction.type}</div>
      <div className="bg-black/40 backdrop-blur-md px-2 py-0.5 md:px-3 md:py-1 rounded-full text-[8px] md:text-[9px] text-white font-black uppercase tracking-widest whitespace-nowrap border border-white/10 shadow-lg">
        {reaction.senderName}
      </div>
    </div>
  );
}

function StreamView({ stream, name, isMuted, isVideoOff, isMe, isPresenting, isPinned, isRaised, onTogglePin, className }: { 
  stream: MediaStream | null, 
  name: string, 
  isMuted?: boolean, 
  isVideoOff?: boolean, 
  isMe?: boolean, 
  isPresenting?: boolean,
  isPinned?: boolean,
  isRaised?: boolean,
  onTogglePin?: () => void,
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
      "relative w-full h-full bg-[#1A1A1A] rounded-2xl md:rounded-[4rem] overflow-hidden border-4 transition-all duration-500 group",
      isRaised ? "border-yellow-400 shadow-[0_0_30px_rgba(250,204,21,0.3)]" : "border-white/5 shadow-2xl",
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
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#121212] z-10 p-4 text-center">
           <div className="rounded-full bg-[#1E1E1E] flex items-center justify-center w-16 h-16 md:w-24 md:h-24 shadow-2xl border border-white/5 mb-2 md:mb-4">
              <UserIcon className="text-zinc-700 h-6 w-6 md:h-10 md:w-10" />
           </div>
           <div className="text-zinc-500 font-black tracking-[0.2em] md:tracking-[0.4em] uppercase text-[8px] md:text-[10px] opacity-60">Camera Off</div>
        </div>
      )}
      
      <div className="absolute top-3 right-3 md:top-6 md:right-6 z-30 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-2">
        {isRaised && (
          <div className="bg-yellow-400 p-2 md:p-3 rounded-lg md:rounded-xl shadow-2xl animate-bounce">
            <Hand className="h-4 w-4 md:h-6 md:w-6 text-zinc-900" />
          </div>
        )}
        {onTogglePin && (
          <Button 
            variant="secondary" 
            size="icon" 
            onClick={onTogglePin}
            className={cn(
              "rounded-lg md:rounded-xl h-8 w-8 md:h-12 md:w-12 shadow-2xl backdrop-blur-md border border-white/10",
              isPinned ? "bg-primary text-white" : "bg-black/40 text-white hover:bg-black/60"
            )}
          >
            {isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
          </Button>
        )}
      </div>

      <div className="absolute bottom-3 left-3 md:bottom-6 md:left-6 flex items-center gap-2 md:gap-3 z-20">
        <Badge variant="secondary" className="bg-black/60 text-white backdrop-blur-2xl border-white/10 px-2 md:px-4 py-1 md:py-2 font-black text-[8px] md:text-[11px] uppercase tracking-widest rounded-lg md:rounded-xl shadow-xl flex items-center gap-1.5 md:gap-2">
          {isPresenting && <Monitor className="h-3 w-3 md:h-3.5 md:w-3.5 text-primary" />}
          {isPinned && <Pin className="h-3 w-3 md:h-3.5 md:w-3.5 text-primary fill-primary" />}
          <AudioLevelIndicator stream={stream} isMuted={!!isMuted} />
          <span className="truncate max-w-[80px] md:max-w-none">{name} {isMe && "(You)"}</span>
        </Badge>
        {isMuted && !isPresenting && <div className="p-1.5 md:p-2 bg-[#FF4545] rounded-lg md:rounded-xl shadow-2xl border border-white/20"><MicOff className="h-3 w-3 md:h-4 md:w-4 text-white" /></div>}
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
  const isMobile = useIsMobile();

  const [isAudioMuted, setIsAudioMuted] = useState(true);
  const [isVideoOff, setIsVideoOff] = useState(true);
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [hasHandRaised, setHasHandRaised] = useState(false);
  const [isCaptionsEnabled, setIsCaptionsEnabled] = useState(false);
  const [elapsedTime, setElapsedTime] = useState('00:00:00');
  const [chatInput, setChatInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeReactions, setActiveReactions] = useState<Reaction[]>([]);
  const [pinnedParticipantId, setPinnedParticipantId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [activeTab, setActiveTab] = useState<'chat' | 'participants'>('chat');
  const [isRecordingAttendance, setIsRecordingAttendance] = useState(false);
  const [customMeetingName, setCustomMeetingName] = useState('');
  
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [videoInputDevices, setVideoInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioInput, setSelectedAudioInput] = useState<string>('');
  const [selectedVideoInput, setSelectedVideoInput] = useState<string>('');
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [hasMicPermission, setHasMicPermission] = useState<boolean | null>(null);

  const recognitionRef = useRef<any>(null);
  const lastCaptionRef = useRef<string>('');
  const lastPresenceRef = useRef<string>('');
  const lastPresenceUpdateAt = useRef<number>(0);
  const lastReactionTime = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const localCameraStream = useRef<MediaStream | null>(null);
  const localScreenStream = useRef<MediaStream | null>(null);
  
  const [remoteCameraStreams, setRemoteCameraStreams] = useState<Map<string, MediaStream>>(new Map());
  const [remoteScreenStreams, setRemoteScreenStreams] = useState<Map<string, MediaStream>>(new Map());

  const pcs = useRef<Map<string, RTCPeerConnection>>(new Map());
  const cameraSenders = useRef<Map<string, RTCRtpSender[]>>(new Map());
  const screenSenders = useRef<Map<string, RTCRtpSender[]>>(new Map());
  const signalingUnsubs = useRef<Map<string, () => void>>(new Map());
  const establishedPcs = useRef<Set<string>>(new Set());
  const initialPresenceSynced = useRef(false);
  const localRoleRef = useRef<Participant['role'] | null>(null);
  const prevRaisedHandsRef = useRef<Set<string>>(new Set());
  
  const meetingRef = useMemoFirebase(() => {
    if (!firestore || !meetingId || !user) return null;
    return doc(firestore, 'meetings', meetingId);
  }, [firestore, meetingId, user]);

  const { data: meetingData, isLoading: isMeetingLoading } = useDoc<any>(meetingRef);

  const isHost = useMemo(() => {
    if (!user || !meetingData) return false;
    return user.uid === meetingData.hostId;
  }, [user?.uid, meetingData?.hostId]);

  const hostId = meetingData?.hostId;
  const screenSharerId = meetingData?.screenSharerId;
  const isMeetingLocked = meetingData?.isLocked;

  const participantsRefQuery = useMemoFirebase(() => {
    if (!firestore || !meetingId || !user) return null;
    return query(collection(firestore, 'meetings', meetingId, 'participants'), limit(50));
  }, [firestore, meetingId, user]);

  const { data: participants } = useCollection<Participant>(participantsRefQuery);
  const currentParticipantsRef = useRef<Participant[]>([]);
  
  useEffect(() => {
    if (meetingData?.name) {
      setCustomMeetingName(meetingData.name);
    }
  }, [meetingData?.name]);

  useEffect(() => {
    if (!participants) return;
    const currentRaised = new Set(participants.filter(p => p.hasRaisedHand).map(p => p.id));
    
    currentRaised.forEach(id => {
      if (!prevRaisedHandsRef.current.has(id) && id !== user?.uid) {
        try {
          const context = new (window.AudioContext || (window as any).webkitAudioContext)();
          const osc = context.createOscillator();
          const gain = context.createGain();
          osc.connect(gain);
          gain.connect(context.destination);
          osc.type = 'sine';
          osc.frequency.setValueAtTime(523.25, context.currentTime); 
          gain.gain.setValueAtTime(0, context.currentTime);
          gain.gain.linearRampToValueAtTime(0.1, context.currentTime + 0.05);
          gain.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.3);
          osc.start(context.currentTime);
          osc.stop(context.currentTime + 0.3);
        } catch (e) { console.warn("Audio feedback failed", e); }
      }
    });
    
    prevRaisedHandsRef.current = currentRaised;
  }, [participants, user?.uid]);

  useEffect(() => {
    if (participants) {
      currentParticipantsRef.current = participants;
      const me = participants.find(p => p.id === user?.uid);
      if (me) localRoleRef.current = me.role;
      
      if (pinnedParticipantId && !participants.some(p => p.id === pinnedParticipantId && p.role !== 'left')) {
        setPinnedParticipantId(null);
      }
    }
  }, [participants, user?.uid, pinnedParticipantId]);

  const localParticipant = useMemo(() => {
    return participants?.find(p => p.id === user?.uid);
  }, [participants, user?.uid]);

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
    const active = participants.filter(p => p.role !== 'left' && p.role !== 'waiting');
    
    return [...active].sort((a, b) => {
      if (a.hasRaisedHand && b.hasRaisedHand) return a.name.localeCompare(b.name);
      if (a.hasRaisedHand) return -1;
      if (b.hasRaisedHand) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [participants]);

  const waitingParticipants = useMemo(() => {
    if (!participants) return [];
    return participants.filter(p => p.role === 'waiting');
  }, [participants]);

  const activeParticipantIds = useMemo(() => activeParticipants.map(p => p.id).sort().join(','), [activeParticipants]);

  const cleanupAllResources = useCallback(() => {
    localCameraStream.current?.getTracks().forEach(t => t.stop());
    localCameraStream.current = null;
    localScreenStream.current?.getTracks().forEach(t => t.stop());
    localScreenStream.current = null;

    pcs.current.forEach(pc => {
      try { pc.close(); } catch (e) {}
    });
    pcs.current.clear();
    establishedPcs.current.clear();
    cameraSenders.current.clear();
    screenSenders.current.clear();

    signalingUnsubs.current.forEach(unsub => unsub());
    signalingUnsubs.current.clear();

    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }

    setRemoteCameraStreams(new Map());
    setRemoteScreenStreams(new Map());
  }, []);

  useEffect(() => {
    if (meetingData?.status === 'finished') {
      cleanupAllResources();
    }
  }, [meetingData?.status, cleanupAllResources]);

  useEffect(() => {
    const checkPermissions = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audios = devices.filter(d => d.kind === 'audioinput' && d.deviceId);
        const videos = devices.filter(d => d.kind === 'videoinput' && d.deviceId);
        
        setAudioInputDevices(audios);
        setVideoInputDevices(videos);
        
        if (audios.length > 0) setSelectedAudioInput(audios[0].deviceId);
        if (videos.length > 0) setSelectedVideoInput(videos[0].deviceId);

        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setHasCameraPermission(true);
        setHasMicPermission(true);
        stream.getTracks().forEach(t => t.stop());
      } catch (err: any) {
        if (err.name === 'NotAllowedError') {
          setHasCameraPermission(false);
          setHasMicPermission(false);
        }
      }
    };
    checkPermissions();
  }, []);

  const syncPresence = useCallback(async (updates: Partial<Participant>, isInitial = false) => {
    if (!user?.uid || !firestore || !meetingId || isMeetingLoading || !hostId) return;
    
    const pRef = doc(firestore, 'meetings', meetingId, 'participants', user.uid);
    let role: Participant['role'] = user.uid === hostId ? 'host' : 'participant';

    const now = Date.now();
    const timeSinceLastUpdate = now - lastPresenceUpdateAt.current;

    if (isInitial) {
      const snap = await getDoc(pRef);
      if (isMeetingLocked && user.uid !== hostId) {
        if (snap.exists() && (snap.data().role === 'participant' || snap.data().role === 'host' || snap.data().role === 'co-host')) {
          role = snap.data().role;
        } else {
          role = 'waiting';
        }
      } else if (snap.exists()) {
        role = snap.data().role;
      }
    }

    const currentRole = localRoleRef.current || role;
    const existingSnap = await getDoc(pRef);
    const existingData = existingSnap.exists() ? existingSnap.data() as Participant : null;
    
    let accumulatedSeconds = existingData?.accumulatedSeconds || 0;
    if (updates.role === 'left' && existingData?.lastJoinTime) {
      const duration = Math.floor((now - existingData.lastJoinTime.toMillis()) / 1000);
      accumulatedSeconds += Math.max(0, duration);
    }

    const data: any = {
      ...updates,
      id: user.uid,
      name: user.displayName || user.email?.split('@')[0],
      role: isInitial ? role : (updates.role || currentRole),
      cameraStreamId: localCameraStream.current?.id || null,
      screenStreamId: localScreenStream.current?.id || null,
      accumulatedSeconds: accumulatedSeconds,
      lastJoinTime: (isInitial || (!isInitial && updates.role !== 'left')) ? Timestamp.now() : null,
    };
    if (isInitial) {
      data.joinedAt = serverTimestamp();
    }
    
    const presenceHash = JSON.stringify({ 
      role: data.role,
      hasRaisedHand: data.hasRaisedHand,
      isMuted: data.isMuted,
      isVideoOff: data.isVideoOff,
      cameraStreamId: data.cameraStreamId,
      screenStreamId: data.screenStreamId
    });

    if (!isInitial && presenceHash === lastPresenceRef.current) return;
    if (!isInitial && timeSinceLastUpdate < 25000 && !updates.role) return; 

    lastPresenceRef.current = presenceHash;
    lastPresenceUpdateAt.current = now;

    await setDoc(pRef, data, { merge: true });
  }, [user?.uid, user?.displayName, user?.email, firestore, meetingId, hostId, isMeetingLoading, isMeetingLocked]);

  useEffect(() => {
    if (!user || !meetingId || !firestore || isMeetingLoading || !meetingData || initialPresenceSynced.current) return;
    syncPresence({ isMuted: true, isVideoOff: true, hasRaisedHand: false }, true);
    initialPresenceSynced.current = true;
  }, [user?.uid, meetingId, !!meetingData, isMeetingLoading, syncPresence]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        toggleFullscreen();
      }
    };

    const handleMouseMove = () => {
      if (document.fullscreenElement) {
        setShowControls(true);
        if (controlTimeoutRef.current) clearTimeout(controlTimeoutRef.current);
        controlTimeoutRef.current = setTimeout(() => {
          setShowControls(false);
        }, 3000);
      } else {
        setShowControls(true);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousemove', handleMouseMove);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(err => {
        toast({ variant: 'destructive', title: "Fullscreen failed", description: err.message });
      });
    } else {
      document.exitFullscreen();
    }
  };

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
      toast({ variant: 'destructive', title: 'Captions Not Supported' });
      setIsCaptionsEnabled(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: any) => {
      const currentTranscript = event.results[event.results.length - 1][0].transcript;
      const isSentenceEnd = /[.!?]$/.test(currentTranscript);
      const isSignificant = currentTranscript.length - lastCaptionRef.current.length > 40;

      if ((isSignificant || isSentenceEnd) && user && firestore) {
          lastCaptionRef.current = currentTranscript;
          setDocumentNonBlocking(doc(firestore, 'meetings', meetingId, 'captions', user.uid), {
            text: currentTranscript,
            updatedAt: serverTimestamp(),
            username: user.displayName || user.email?.split('@')[0],
          }, { merge: true });
      }
    };

    recognition.onend = () => { if (isCaptionsEnabled) recognition.start(); };
    recognition.start();
    recognitionRef.current = recognition;

    return () => { if (recognitionRef.current) recognitionRef.current.stop(); };
  }, [isCaptionsEnabled, user, firestore, meetingId, toast]);

  const updateTracksForPeers = (stream: MediaStream | null, type: 'camera' | 'screen') => {
    pcs.current.forEach((pc, id) => {
      const existingSenders = type === 'camera' ? cameraSenders.current.get(id) : screenSenders.current.get(id);
      if (existingSenders) {
        existingSenders.forEach(s => { try { pc.removeTrack(s); } catch (e) {} });
      }
      if (stream) {
        const senders = stream.getTracks().map(t => {
          if (type === 'screen') t.contentHint = 'detail';
          return pc.addTrack(t, stream);
        });
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
        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
              deviceId: selectedVideoInput ? { ideal: selectedVideoInput } : undefined,
              width: { ideal: 1280 }, 
              height: { ideal: 720 }, 
              frameRate: { ideal: 24 } 
            }, 
            audio: { 
              deviceId: selectedAudioInput ? { ideal: selectedAudioInput } : undefined,
              echoCancellation: true, 
              noiseSuppression: true, 
              autoGainControl: true 
            } 
          });
        } catch (err: any) {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        }

        stream.getAudioTracks().forEach(t => t.enabled = !isAudioMuted);
        localCameraStream.current?.getTracks().forEach(t => t.stop());
        localCameraStream.current = stream;
        await syncPresence({ isVideoOff: false });
        updateTracksForPeers(stream, 'camera');
        setIsVideoOff(false);
        setHasCameraPermission(true);
      } else {
        localCameraStream.current?.getTracks().forEach(t => t.stop());
        localCameraStream.current = null;
        await syncPresence({ isVideoOff: true });
        updateTracksForPeers(null, 'camera');
        setIsVideoOff(true);
      }
    } catch (err: any) {
      if (err.name === 'NotAllowedError') setHasCameraPermission(false);
      else toast({ variant: 'destructive', title: 'Camera Error', description: err.message });
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
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: { 
              deviceId: selectedAudioInput ? { ideal: selectedAudioInput } : undefined,
              echoCancellation: true, 
              noiseSuppression: true, 
              autoGainControl: true 
            },
            video: !isVideoOff 
          });
          localCameraStream.current = stream;
          await syncPresence({ isMuted: newState });
          updateTracksForPeers(stream, 'camera');
          setHasMicPermission(true);
        } catch (err: any) {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: !isVideoOff });
          localCameraStream.current = stream;
          await syncPresence({ isMuted: newState });
          updateTracksForPeers(stream, 'camera');
        }
      }
      if (localCameraStream.current) {
        localCameraStream.current.getAudioTracks().forEach(t => t.enabled = !newState);
      }
      setIsAudioMuted(newState);
      syncPresence({ isMuted: newState });
    } catch (err: any) {
      if (err.name === 'NotAllowedError') setHasMicPermission(false);
      else toast({ variant: 'destructive', title: 'Mic Error', description: err.message });
    } finally {
      setIsProcessing(false);
    }
  };

  const startScreenShare = async () => {
    if (!user || !firestore || screenSharerId) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      toast({ 
        variant: 'destructive', 
        title: 'Not Supported', 
        description: 'Screen sharing is not supported on this browser or device. Please use a desktop browser like Chrome or Edge.' 
      });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
      localScreenStream.current = stream;
      await syncPresence({ screenStreamId: stream.id });
      await updateDoc(doc(firestore, 'meetings', meetingId), { screenSharerId: user.uid });
      updateTracksForPeers(stream, 'screen');
      setIsSharingScreen(true);
      stream.getVideoTracks()[0].onended = stopScreenShare;
    } catch (err) {
      toast({ title: 'Presentation Cancelled' });
    }
  };

  const stopScreenShare = async () => {
    if (!user || !firestore) return;
    localScreenStream.current?.getTracks().forEach(t => t.stop());
    localScreenStream.current = null;
    await syncPresence({ screenStreamId: null });
    await updateDoc(doc(firestore, 'meetings', meetingId), { screenSharerId: null });
    updateTracksForPeers(null, 'screen');
    setIsSharingScreen(false);
  };

  const sendReaction = useCallback((emoji: string) => {
    if (!user || !firestore || !meetingId) return;
    const now = Date.now();
    if (now - lastReactionTime.current < 2000) return;
    lastReactionTime.current = now;

    addDocumentNonBlocking(collection(firestore, 'meetings', meetingId, 'reactions'), {
      type: emoji,
      senderId: user.uid,
      senderName: user.displayName || user.email?.split('@')[0],
      createdAt: serverTimestamp(),
    });
  }, [user, firestore, meetingId]);

  const togglePin = (participantId: string) => {
    setPinnedParticipantId(pinnedParticipantId === participantId ? null : participantId);
  };

  const copyInviteLink = () => {
    navigator.clipboard.writeText(window.location.origin + `/room/${meetingId}`);
    toast({ title: "Link copied!" });
  };

  const toggleMeetingLock = () => {
    if (!isHost || !meetingRef) return;
    updateDoc(meetingRef, { isLocked: !isMeetingLocked });
    toast({ title: !isMeetingLocked ? "Meeting Locked" : "Meeting Unlocked" });
  };

  const admitParticipant = (participantId: string) => {
    if (!isHost || !firestore || !meetingId) return;
    updateDocumentNonBlocking(doc(firestore, 'meetings', meetingId, 'participants', participantId), { role: 'participant' });
  };

  const removeParticipant = (participantId: string) => {
    if (!isHost || !firestore || !meetingId) return;
    updateDocumentNonBlocking(doc(firestore, 'meetings', meetingId, 'participants', participantId), { role: 'left' });
  };

  const handleEndSession = async () => {
    if (!isHost || !meetingRef) return;
    try {
      await updateDoc(meetingRef, { status: 'finished', endedAt: serverTimestamp() });
    } catch (error) {
      toast({ variant: 'destructive', title: "Error ending session" });
    }
  };

  const handleLeaveRoom = async () => {
    await syncPresence({ role: 'left' });
    cleanupAllResources();
    router.push('/dashboard');
  };

  const handleRecordAttendance = async () => {
    if (!firestore || !meetingId || !participants) return;
    if (isHost && !customMeetingName.trim()) {
      toast({ variant: 'destructive', title: "Session Name Required", description: "Please enter a name for this session before saving." });
      return;
    }
    setIsRecordingAttendance(true);
    try {
      const batch = writeBatch(firestore);
      const attendanceCollection = collection(firestore, 'seriesAttendance');
      
      attendanceData.forEach(record => {
        const recordId = `${meetingId}_${record.id}`;
        const ref = doc(attendanceCollection, recordId);
        batch.set(ref, {
          meetingId,
          meetingName: customMeetingName,
          userId: record.id,
          userName: record.name,
          totalTimeAttended: record.totalTime,
          attendancePercentage: record.percentage,
          status: record.status,
          recordedAt: serverTimestamp(),
          hostId: user?.uid,
        });
      });

      await batch.commit();
      toast({ title: "Attendance recorded successfully!" });
      router.push('/dashboard');
    } catch (error) {
      toast({ variant: 'destructive', title: "Failed to record attendance" });
    } finally {
      setIsRecordingAttendance(false);
    }
  };

  useEffect(() => {
    if (!user || !firestore || !meetingId || !activeParticipantIds || localParticipant?.role === 'waiting' || meetingData?.status === 'finished') return;
    
    const currentIds = activeParticipantIds.split(',').filter(id => id && id !== user.uid);
    const currentIdSet = new Set(currentIds);

    pcs.current.forEach((pc, id) => {
      if (!currentIdSet.has(id)) {
        signalingUnsubs.current.get(`${id}_channel`)?.();
        signalingUnsubs.current.delete(`${id}_channel`);
        pc.close();
        pcs.current.delete(id);
        establishedPcs.current.delete(id);
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
      establishedPcs.current.add(participantId);

      const appliedCandidates = new Set<string>();

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
        const p = currentParticipantsRef.current.find(p => p.id === participantId);
        const isScreen = stream.id === p?.screenStreamId || stream.id === meetingData?.screenSharerId;
        
        if (isScreen) setRemoteScreenStreams(prev => new Map(prev).set(participantId, stream));
        else setRemoteCameraStreams(prev => new Map(prev).set(participantId, stream));
      };

      const channelId = [user.uid, participantId].sort().join('_');
      const channelRef = doc(firestore, 'meetings', meetingId, 'webrtc', channelId);
      const isPolite = user.uid > participantId;
      let makingOffer = false;

      pc.onnegotiationneeded = async () => {
        if (pc.signalingState !== 'stable' || makingOffer) return;
        try {
          makingOffer = true;
          await pc.setLocalDescription();
          const offer = pc.localDescription;
          if (offer) {
            await setDoc(channelRef, { [user.uid]: { type: offer.type, sdp: offer.sdp, ts: Date.now() } }, { merge: true });
          }
        } catch (err) { console.error(err); } finally { makingOffer = false; }
      };

      const candidateBuffer: any[] = [];
      let candidateTimeout: NodeJS.Timeout | null = null;

      pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
          candidateBuffer.push(candidate.toJSON());
          if (!candidateTimeout) {
            candidateTimeout = setTimeout(async () => {
              const toSend = [...candidateBuffer];
              candidateBuffer.length = 0;
              candidateTimeout = null;
              if (toSend.length > 0) {
                const updates: any = {};
                toSend.forEach((c, i) => updates[`c_${user.uid}_${Date.now()}_${i}`] = c);
                await setDoc(channelRef, updates, { merge: true });
              }
            }, 30000); 
          }
        }
      };

      const unsub = onSnapshot(channelRef, async (snap) => {
        const data = snap.data();
        if (!data) return;
        const remoteData = data[participantId];
        try {
          if (remoteData) {
            const collision = remoteData.type === 'offer' && (makingOffer || pc.signalingState !== 'stable');
            if (!collision || isPolite) {
              await pc.setRemoteDescription(remoteData);
              if (remoteData.type === 'offer') {
                await pc.setLocalDescription();
                const ans = pc.localDescription;
                if (ans) await setDoc(channelRef, { [user.uid]: { type: ans.type, sdp: ans.sdp, ts: Date.now() } }, { merge: true });
              }
            }
          }
          Object.keys(data).forEach(async (k) => {
            if (k.startsWith(`c_${participantId}`) && !appliedCandidates.has(k)) {
              appliedCandidates.add(k);
              try { await pc.addIceCandidate(new RTCIceCandidate(data[k])); } catch (e) {}
            }
          });
        } catch (err) { console.error(err); }
      });
      signalingUnsubs.current.set(`${participantId}_channel`, unsub);
    });
  }, [user?.uid, firestore, meetingId, activeParticipantIds, localParticipant?.role, meetingData?.status]);

  useEffect(() => {
    if (!meetingData?.createdAt || meetingData.status === 'finished') return;
    const interval = setInterval(() => {
      const diff = Math.max(0, Date.now() - meetingData.createdAt.seconds * 1000);
      setElapsedTime(formatDuration(diff / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [meetingData?.createdAt, meetingData?.status]);

  const attendanceData = useMemo(() => {
    if (!meetingData?.endedAt || !meetingData?.createdAt || !participants) return [];
    
    const totalSessionSeconds = Math.max(1, meetingData.endedAt.seconds - meetingData.createdAt.seconds);
    const now = Date.now();

    return participants.map(p => {
      let totalActiveSeconds = p.accumulatedSeconds || 0;
      if (p.lastJoinTime) {
        const currentStretch = Math.floor((now - p.lastJoinTime.toMillis()) / 1000);
        totalActiveSeconds += Math.max(0, currentStretch);
      }
      
      totalActiveSeconds = Math.min(totalActiveSeconds, totalSessionSeconds);
      const percentage = Math.round((totalActiveSeconds / totalSessionSeconds) * 100);
      const status = percentage >= 70 ? 'Present' : 'Absent';
      
      return {
        id: p.id,
        name: p.name,
        totalTime: totalActiveSeconds,
        percentage,
        status,
        role: p.role
      };
    });
  }, [meetingData?.endedAt, meetingData?.createdAt, participants]);

  const attendanceStats = useMemo(() => {
    const present = attendanceData.filter(d => d.status === 'Present').length;
    const absent = attendanceData.filter(d => d.status === 'Absent').length;
    return [
      { name: 'Present', value: present, color: '#22c55e' },
      { name: 'Absent', value: absent, color: '#ef4444' },
    ];
  }, [attendanceData]);

  if (isMeetingLoading) return <div className="h-screen flex items-center justify-center bg-[#F8F9FB]"><Skeleton className="h-12 md:h-16 w-48 md:w-64 rounded-2xl md:rounded-3xl" /></div>;

  if (!meetingData || meetingData?.status === 'finished' || localParticipant?.role === 'left') {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-[#F8F9FB] p-4 md:p-6 text-center overflow-auto">
        <div className="w-full max-w-4xl space-y-6 md:space-y-8 animate-in zoom-in duration-500 py-8">
          <div className="flex flex-col items-center">
            <div className="bg-zinc-900 p-6 md:p-8 rounded-[2rem] md:rounded-[3rem] shadow-2xl mb-6 md:mb-8">
              <Trophy className="h-12 w-12 md:h-16 md:w-16 text-white" />
            </div>
            <h1 className="text-3xl md:text-5xl font-black mb-2 text-zinc-900 tracking-tighter">Session Ended</h1>
            <p className="text-zinc-500 font-bold uppercase tracking-widest text-[10px] md:text-xs">{customMeetingName || meetingData?.name}</p>
          </div>

          <Card className="rounded-[2.5rem] md:rounded-[3.5rem] border-none shadow-2xl overflow-hidden bg-white">
            <CardHeader className="p-8 md:p-12 pb-0">
              <CardTitle className="text-2xl font-black tracking-tight">Attendance Summary</CardTitle>
            </CardHeader>
            <CardContent className="p-8 md:p-12 space-y-8 text-left">
              {isHost ? (
                <div className="space-y-10">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                    <div className="h-[250px] w-full">
                       <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={attendanceStats}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={100}
                            paddingAngle={5}
                            dataKey="value"
                          >
                            {attendanceStats.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <RechartsTooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center p-4 bg-green-50 rounded-2xl border border-green-100">
                        <span className="font-black text-[10px] uppercase tracking-widest text-green-600">Present</span>
                        <span className="text-2xl font-black text-green-700">{attendanceStats[0].value}</span>
                      </div>
                      <div className="flex justify-between items-center p-4 bg-red-50 rounded-2xl border border-red-100">
                        <span className="font-black text-[10px] uppercase tracking-widest text-red-600">Absent</span>
                        <span className="text-2xl font-black text-red-700">{attendanceStats[1].value}</span>
                      </div>
                    </div>
                  </div>

                  {meetingData?.name === 'Instant Meeting' && (
                    <div className="space-y-3 p-6 bg-zinc-50 rounded-[2rem] border border-zinc-100">
                      <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Session Name</label>
                      <Input 
                        placeholder="Enter name (e.g., Weekly Sync #12)" 
                        value={customMeetingName} 
                        onChange={(e) => setCustomMeetingName(e.target.value)}
                        className="h-12 rounded-xl bg-white border-zinc-200 font-bold"
                      />
                      <p className="text-[9px] font-bold text-zinc-400 italic">This will be used as the identifier for these records.</p>
                    </div>
                  )}

                  <div className="rounded-[2rem] border border-zinc-100 overflow-hidden">
                    <Table>
                      <TableHeader className="bg-zinc-50">
                        <TableRow>
                          <TableHead className="font-black text-[10px] uppercase tracking-widest">Name</TableHead>
                          <TableHead className="font-black text-[10px] uppercase tracking-widest">Time</TableHead>
                          <TableHead className="font-black text-[10px] uppercase tracking-widest text-right">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {attendanceData.map((record) => (
                          <TableRow key={record.id}>
                            <TableCell className="font-bold text-sm">{record.name}</TableCell>
                            <TableCell className="text-zinc-500 font-medium text-xs">{formatDuration(record.totalTime)} ({record.percentage}%)</TableCell>
                            <TableCell className="text-right">
                              <Badge variant={record.status === 'Present' ? 'secondary' : 'destructive'} className={cn(
                                "font-black text-[9px] uppercase tracking-widest",
                                record.status === 'Present' ? "bg-green-100 text-green-700 border-green-200" : "bg-red-100 text-red-700 border-red-200"
                              )}>
                                {record.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-6 text-center">
                  {attendanceData.find(d => d.id === user?.uid) ? (
                    (() => {
                      const myRecord = attendanceData.find(d => d.id === user?.uid)!;
                      return (
                        <div className="w-full max-w-md p-8 md:p-12 bg-zinc-50 rounded-[2.5rem] md:rounded-[3rem] border border-zinc-100 space-y-6 md:space-y-8">
                          <div className="flex flex-col items-center gap-4">
                            {myRecord.status === 'Present' ? (
                              <CheckCircle2 className="h-16 w-16 md:h-20 md:w-20 text-green-500" />
                            ) : (
                              <XCircle className="h-16 w-16 md:h-20 md:w-20 text-red-500" />
                            )}
                            <h2 className="text-2xl md:text-3xl font-black">{myRecord.status}</h2>
                          </div>
                          <Separator className="bg-zinc-200" />
                          <div className="space-y-4">
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Total Participation</span>
                              <span className="text-lg font-black">{formatDuration(myRecord.totalTime)}</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Attendance Score</span>
                              <span className="text-lg font-black text-primary">{myRecord.percentage}%</span>
                            </div>
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    <p className="text-zinc-400 font-bold italic">No personal record found.</p>
                  )}
                </div>
              )}
            </CardContent>
            <CardFooter className="p-8 md:p-12 pt-0 flex flex-col md:flex-row gap-4">
              {isHost ? (
                <>
                  <Button onClick={handleRecordAttendance} disabled={isRecordingAttendance} className="w-full h-14 md:h-16 rounded-2xl md:rounded-3xl font-black uppercase text-[10px] md:text-xs tracking-widest shadow-xl">
                    {isRecordingAttendance ? "Saving..." : "Record Attendance"}
                    <Download className="ml-2 h-4 w-4" />
                  </Button>
                  <Button variant="outline" onClick={() => router.push('/dashboard')} className="w-full h-14 md:h-16 rounded-2xl md:rounded-3xl font-black uppercase text-[10px] md:text-xs tracking-widest border-zinc-200">
                    Discard
                  </Button>
                </>
              ) : (
                <Button onClick={() => router.push('/dashboard')} className="w-full h-14 md:h-16 rounded-2xl md:rounded-3xl font-black uppercase text-[10px] md:text-xs tracking-widest shadow-xl">
                  Back to Dashboard
                </Button>
              )}
            </CardFooter>
          </Card>
        </div>
      </div>
    );
  }

  const getAttendanceStatus = (participant: Participant) => {
    if (!meetingData?.scheduledAt || !participant.joinedAt) return null;
    
    const startTime = meetingData.scheduledAt.seconds;
    const joinTime = participant.joinedAt.seconds;
    const diffMinutes = (joinTime - startTime) / 60;
    
    if (diffMinutes <= 15) {
      return { label: 'On Time', className: 'bg-green-100 text-green-700 border-green-200' };
    } else {
      return { label: 'Late', className: 'bg-red-100 text-red-700 border-red-200' };
    }
  };

  if (localParticipant?.role === 'waiting') {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-[#F8F9FB] p-4 text-center">
        <div className="bg-white p-8 md:p-12 rounded-[2.5rem] md:rounded-[3.5rem] shadow-2xl border border-zinc-100 max-w-lg w-full">
          <div className="h-16 w-16 md:h-20 md:w-20 bg-primary/10 rounded-2xl md:rounded-[2rem] flex items-center justify-center mx-auto mb-6 md:mb-8"><Lock className="h-8 w-8 md:h-10 md:w-10 text-primary" /></div>
          <h1 className="text-2xl md:text-3xl font-black mb-3 md:mb-4 text-zinc-900 tracking-tighter">Meeting Locked</h1>
          <p className="text-zinc-500 font-medium mb-8 md:mb-12 text-sm md:text-base">The host has restricted access. Please wait to be admitted.</p>
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-3 py-4 bg-zinc-50 rounded-2xl border border-zinc-100">
              <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              <span className="text-[10px] md:text-xs font-black uppercase tracking-widest text-zinc-400">Waiting for host...</span>
            </div>
            <Button variant="outline" onClick={() => router.push('/dashboard')} className="w-full h-12 md:h-14 rounded-2xl font-black uppercase tracking-widest text-[9px] md:text-[10px]">Cancel</Button>
          </div>
        </div>
      </div>
    );
  }

  const raisedHandUser = activeParticipants.find(p => p.hasRaisedHand);
  const spotlightParticipantId = pinnedParticipantId || (screenSharerId && screenSharerId !== user?.uid ? screenSharerId : (raisedHandUser?.id || (activeParticipants.find(p => p.id !== user?.uid)?.id || user?.uid)));
  const isSpotlightMe = spotlightParticipantId === user?.uid;
  const spotlightParticipant = activeParticipants.find(p => p.id === spotlightParticipantId);

  const SidebarContent = () => (
    <Tabs defaultValue={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="flex-1 flex flex-col overflow-hidden h-full">
      <div className="px-6 md:px-10 pt-6 md:pt-12 pb-4 md:pb-6 border-b">
        <TabsList className="w-full h-12 md:h-16 grid grid-cols-2 rounded-xl md:rounded-2xl bg-zinc-100/80 p-1 md:p-1.5">
          <TabsTrigger value="chat" className="rounded-lg md:rounded-xl font-black text-[10px] md:text-[11px] uppercase tracking-widest">
            <MessageSquare className="h-3.5 w-3.5 md:h-4 md:w-4 mr-2 md:mr-3" /> Chat
          </TabsTrigger>
          <TabsTrigger value="participants" className="rounded-lg md:rounded-xl font-black text-[10px] md:text-[11px] uppercase tracking-widest">
            <Users className="h-3.5 w-3.5 md:h-4 w-4 mr-2 md:mr-3" /> People
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="chat" className="flex-1 flex flex-col overflow-hidden mt-0">
        <ScrollArea className="flex-1 p-6 md:p-10">
          <div className="space-y-6 md:space-y-8">
            {chatMessages?.map((msg) => (
              <div key={msg.id} className={cn("flex flex-col gap-2", msg.senderId === user?.uid ? "items-end" : "items-start")}>
                <div className="text-[9px] font-black text-zinc-400 px-2 uppercase tracking-widest">{msg.senderName}</div>
                <div className={cn("max-w-[90%] px-4 py-3 md:px-6 md:py-4 rounded-xl md:rounded-[1.75rem] text-xs md:text-[13px] font-bold shadow-sm leading-relaxed", msg.senderId === user?.uid ? "bg-zinc-900 text-white rounded-tr-none" : "bg-zinc-50 text-zinc-800 rounded-tl-none")}>
                  {msg.text}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
        <div className="p-4 md:p-8 border-t bg-zinc-50/50">
          <div className="relative flex items-center">
            <Input 
              placeholder="Type a message..." 
              value={chatInput} 
              onChange={(e) => chatInput && setChatInput(e.target.value)} 
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
              className="pr-12 rounded-xl h-12 md:h-14 bg-white border-zinc-100 text-sm" 
            />
            <Button size="icon" variant="ghost" className="absolute right-1 top-1/2 -translate-y-1/2 h-10 w-10 rounded-lg" onClick={() => { if (chatInput.trim() && firestore && user) { addDoc(collection(firestore, 'meetings', meetingId, 'chat'), { senderId: user.uid, senderName: user.displayName || user.email?.split('@')[0], text: chatInput, createdAt: serverTimestamp() }); setChatInput(''); } }}><Send className="h-4 w-4 text-zinc-400" /></Button>
          </div>
        </div>
      </TabsContent>
      <TabsContent value="participants" className="flex-1 flex flex-col overflow-hidden mt-0">
        <ScrollArea className="flex-1 p-4 md:p-8">
          <div className="space-y-8 md:space-y-10">
            {isHost && waitingParticipants.length > 0 && (
              <div className="space-y-3 md:space-y-4">
                <span className="text-[10px] md:text-[11px] font-black uppercase tracking-widest text-primary px-3 md:px-4">Waiting Room ({waitingParticipants.length})</span>
                {waitingParticipants.map(p => (
                  <div key={p.id} className="flex items-center justify-between p-4 md:p-5 bg-zinc-900 rounded-2xl md:rounded-3xl shadow-xl">
                    <div className="flex items-center gap-3 md:gap-4">
                      <div className="h-8 w-8 md:h-10 md:w-10 rounded-xl bg-white/10 flex items-center justify-center text-[10px] md:text-[11px] font-black text-zinc-400">{p.name.substring(0, 2)}</div>
                      <span className="text-[11px] md:text-xs font-black text-white truncate max-w-[80px] md:max-w-none">{p.name}</span>
                    </div>
                    <div className="flex gap-1 md:gap-2">
                      <Button size="icon" variant="ghost" onClick={() => removeParticipant(p.id)} className="h-8 w-8 md:h-10 md:w-10 rounded-lg md:rounded-xl text-zinc-500 hover:text-destructive"><UserX className="h-4 w-4" /></Button>
                      <Button size="icon" onClick={() => admitParticipant(p.id)} className="h-8 w-8 md:h-10 md:w-10 rounded-lg md:rounded-xl bg-primary text-white"><UserPlus className="h-4 w-4" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-3 md:space-y-4">
              <span className="text-[10px] md:text-[11px] font-black uppercase tracking-widest text-zinc-400 px-3 md:px-4">In Meeting ({activeParticipants.length})</span>
              {activeParticipants.map(p => {
                const status = getAttendanceStatus(p);
                return (
                  <div key={p.id} className={cn("flex flex-col gap-2 p-4 md:p-5 bg-zinc-50 rounded-2xl md:rounded-3xl border transition-all", p.hasRaisedHand ? "border-yellow-400 bg-yellow-50/50 shadow-[0_0_15px_rgba(250,204,21,0.2)]" : "border-zinc-100 bg-zinc-50 shadow-sm", pinnedParticipantId === p.id && "ring-2 ring-primary ring-inset")}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 md:gap-4">
                        <div className="h-8 w-8 md:h-10 md:w-10 rounded-xl bg-white shadow-sm flex items-center justify-center text-[10px] md:text-[11px] font-black text-zinc-400 ring-1 ring-zinc-100">
                          {p.hasRaisedHand ? <Hand className="h-4 w-4 text-yellow-500" /> : p.name.substring(0, 2)}
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[11px] md:text-xs font-black text-zinc-900 flex items-center gap-1.5 md:gap-2">
                            <span className="truncate max-w-[60px] md:max-w-none">{p.name}</span> {p.id === user?.uid && "(You)"}
                            <AudioLevelIndicator stream={p.id === user?.uid ? localCameraStream.current : remoteCameraStreams.get(p.id) || null} isMuted={!!p.isMuted} />
                          </span>
                          <span className="text-[8px] md:text-[9px] font-black text-zinc-400 uppercase tracking-widest">{p.role}</span>
                        </div>
                      </div>
                      <div className="flex gap-1.5 md:gap-3 items-center">
                        {status && (
                          <Badge variant="outline" className={cn("font-black text-[7px] md:text-[9px] uppercase tracking-widest px-2 py-0.5 rounded-full border shadow-sm", status.className)}>
                            {status.label}
                          </Badge>
                        )}
                        <Button variant="ghost" size="icon" onClick={() => togglePin(p.id)} className={cn("h-7 w-7 md:h-8 w-8 rounded-lg", pinnedParticipantId === p.id ? "text-primary bg-primary/10" : "text-zinc-300 hover:text-primary hover:bg-primary/5")}>
                          {pinnedParticipantId === p.id ? <PinOff className="h-3.5 w-3.5 md:h-4 md:w-4" /> : <Pin className="h-3.5 w-3.5 md:h-4 md:w-4" />}
                        </Button>
                        {p.isMuted && <MicOff className="h-3.5 w-3.5 md:h-4 md:w-4 text-destructive opacity-40" />}
                        {p.hasRaisedHand && <Hand className="h-3.5 w-3.5 md:h-4 md:w-4 text-yellow-500 animate-bounce" />}
                        {isHost && p.id !== user?.uid && (<Button variant="ghost" size="icon" onClick={() => removeParticipant(p.id)} className="h-7 w-7 md:h-8 md:w-8 rounded-lg text-zinc-300 hover:text-destructive"><UserX className="h-3.5 w-3.5" /></Button>)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );

  return (
    <AuthGuard>
      <div ref={containerRef} className="flex h-screen w-full flex-col overflow-hidden bg-[#F8F9FB]">
        {(hasCameraPermission === false || hasMicPermission === false) && (
          <div className="p-2 md:p-4 bg-red-50 border-b border-red-100 shrink-0">
            <Alert variant="destructive" className="max-w-6xl mx-auto border-none bg-transparent p-0 shadow-none">
              <div className="flex items-center gap-2 md:gap-3">
                <AlertCircle className="h-4 w-4 md:h-5 md:w-5 text-red-600" />
                <div>
                  <AlertTitle className="text-red-900 font-black text-[9px] md:text-[11px] uppercase tracking-widest mb-0.5 md:mb-1">Access Blocked</AlertTitle>
                  <AlertDescription className="text-red-700 font-medium text-[10px] md:text-xs">
                    Please allow camera/mic access in settings.
                  </AlertDescription>
                </div>
              </div>
            </Alert>
          </div>
        )}

        {!isFullscreen && (
          <header className="flex h-16 md:h-24 items-center justify-between px-4 md:px-12 bg-white border-b z-10 shrink-0 shadow-sm transition-all duration-300">
            <div className="flex items-center gap-4 md:gap-10 overflow-hidden">
              <div className="bg-zinc-900 flex items-center justify-center h-10 w-10 md:h-14 md:w-14 rounded-lg md:rounded-[1.5rem] text-white font-black text-lg md:text-2xl shadow-xl shrink-0">CV</div>
              <div className="flex flex-col min-w-0">
                 <div className="flex items-center gap-2 md:gap-4 overflow-hidden">
                   <h1 className="text-sm md:text-xl font-black truncate leading-tight tracking-tight text-zinc-900">{meetingData?.name || 'Live Session'}</h1>
                   <Button variant="secondary" size="icon" onClick={copyInviteLink} className="h-8 w-8 md:h-10 md:w-10 rounded-lg md:rounded-xl text-zinc-400 bg-zinc-50 shrink-0"><LinkIcon className="h-3.5 w-3.5 md:h-4 md:w-4" /></Button>
                 </div>
                 <div className="flex items-center gap-2 mt-1 shrink-0">
                    <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse"></div>
                    <span className="text-[8px] md:text-[10px] text-zinc-400 font-black uppercase tracking-widest truncate">{elapsedTime}</span>
                 </div>
              </div>
            </div>
            <div className="flex items-center gap-2 md:gap-8">
              {isHost ? (
                <Button onClick={handleEndSession} variant="destructive" className="rounded-xl md:rounded-[1.5rem] h-10 md:h-16 px-4 md:px-12 font-black uppercase text-[9px] md:text-xs tracking-widest shadow-lg bg-[#FF4545] border-none">End</Button>
              ) : (
                <Button onClick={handleLeaveRoom} variant="outline" className="rounded-xl md:rounded-[1.5rem] h-10 md:h-16 px-4 md:px-12 font-black uppercase text-[9px] md:text-xs tracking-widest border-zinc-200">Leave</Button>
              )}
            </div>
          </header>
        )}

        <main className="flex-1 flex overflow-hidden p-3 md:p-10 gap-3 md:gap-10 relative">
          <div className="flex-1 flex flex-col gap-4 md:gap-10 overflow-hidden relative">
            <div className="flex-1 bg-[#0F0F0F] rounded-2xl md:rounded-[4rem] relative overflow-hidden shadow-2xl border border-white/5 p-2 md:p-6">
               <div className="w-full h-full flex items-center justify-center">
                 {screenSharerId && !pinnedParticipantId ? (
                   <StreamView 
                    stream={screenSharerId === user?.uid ? localScreenStream.current : remoteScreenStreams.get(screenSharerId) || null} 
                    name={participants?.find(p => p.id === screenSharerId)?.name || 'Presentation'} 
                    isPresenting={true} 
                    isMe={screenSharerId === user?.uid}
                    onTogglePin={() => togglePin(screenSharerId)}
                    isPinned={pinnedParticipantId === screenSharerId}
                    isRaised={participants?.find(p => p.id === screenSharerId)?.hasRaisedHand}
                  />
                 ) : (
                   <StreamView 
                    stream={isSpotlightMe ? localCameraStream.current : remoteCameraStreams.get(spotlightParticipantId!) || null} 
                    name={isSpotlightMe ? 'You' : spotlightParticipant?.name || 'Participant'} 
                    isVideoOff={isSpotlightMe ? isVideoOff : spotlightParticipant?.isVideoOff} 
                    isMuted={isSpotlightMe ? isAudioMuted : spotlightParticipant?.isMuted} 
                    isMe={isSpotlightMe}
                    isPinned={pinnedParticipantId === spotlightParticipantId}
                    isRaised={spotlightParticipant?.hasRaisedHand}
                    onTogglePin={spotlightParticipantId ? () => togglePin(spotlightParticipantId) : undefined}
                  />
                 )}
               </div>

              <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl md:rounded-[4rem]">
                {activeReactions.map(reaction => (<FloatingReaction key={reaction.id} reaction={reaction} onComplete={(id) => setActiveReactions(prev => prev.filter(r => r.id !== id))} />))}
              </div>

              {isCaptionsEnabled && (
                <div className="absolute bottom-20 md:bottom-32 left-0 right-0 flex justify-center pointer-events-none z-50 p-4">
                  <div className="bg-black/80 backdrop-blur-xl px-6 py-4 md:px-10 md:py-6 rounded-2xl md:rounded-[2.5rem] border border-white/10 max-w-full md:max-w-[80%] shadow-2xl">
                    <div className="space-y-2 md:space-y-4 max-h-[100px] overflow-hidden">
                      {remoteCaptions && remoteCaptions.length > 0 ? (
                        remoteCaptions.map((caption) => (
                          <div key={caption.id} className="flex gap-2 md:gap-4 items-start">
                            <span className="font-black text-[8px] md:text-[10px] uppercase tracking-widest text-primary shrink-0 mt-0.5 md:mt-1">{caption.username}:</span>
                            <p className="text-white text-sm md:text-lg font-bold leading-tight truncate-lines-2">{caption.text}</p>
                          </div>
                        ))
                      ) : (<p className="text-zinc-500 font-black uppercase text-[10px] tracking-widest animate-pulse">Listening...</p>)}
                    </div>
                  </div>
                </div>
              )}

              {(screenSharerId || !isVideoOff) && (
                <div className={cn("absolute bottom-4 right-4 md:bottom-16 md:right-16 w-32 md:w-80 aspect-video rounded-xl md:rounded-[2.5rem] overflow-hidden border-2 md:border-[6px] shadow-2xl z-40 bg-zinc-900 transition-all duration-700", localParticipant?.hasRaisedHand ? "border-yellow-400" : "border-white/10", !screenSharerId && isMobile && "w-24")}>
                   <StreamView stream={localCameraStream.current} name="You" isMe={true} isVideoOff={isVideoOff} isMuted={isAudioMuted} isRaised={localParticipant?.hasRaisedHand} />
                </div>
              )}
            </div>

            <div className={cn(
              "h-20 md:h-32 mx-auto w-full md:w-fit bg-white/90 backdrop-blur-3xl rounded-2xl md:rounded-[3.5rem] border border-white shadow-2xl flex items-center justify-center px-4 md:px-12 gap-2 md:gap-6 shrink-0 -mt-8 md:-mt-16 z-20 transition-all duration-500",
              isFullscreen && !showControls ? "opacity-0 translate-y-10" : "opacity-100 translate-y-0"
            )}>
               <Button variant={isAudioMuted ? "destructive" : "secondary"} size="icon" onClick={handleToggleAudio} className={cn("rounded-xl md:rounded-2xl h-10 w-10 md:h-16 md:w-16 transition-all", isAudioMuted ? "bg-[#FF4545] text-white" : "bg-zinc-100 text-zinc-700")}>{isAudioMuted ? <MicOff className="h-5 w-5 md:h-8 md:w-8" /> : <Mic className="h-5 w-5 md:h-8 md:w-8" />}</Button>
               <Button variant={isVideoOff ? "destructive" : "secondary"} size="icon" onClick={handleToggleVideo} disabled={isProcessing} className={cn("rounded-xl md:rounded-2xl h-10 w-10 md:h-16 md:w-16 transition-all", isVideoOff ? "bg-[#FF4545] text-white" : "bg-zinc-100 text-zinc-700")}>{isVideoOff ? <VideoOff className="h-5 w-5 md:h-8 md:w-8" /> : <VideoIcon className="h-5 w-5 md:h-8 md:w-8" />}</Button>
               
               <div className="hidden md:block">
                 <Separator orientation="vertical" className="h-10 md:h-14 mx-1 md:mx-2 bg-zinc-100" />
               </div>

               <Popover>
                <PopoverTrigger asChild><Button variant="secondary" size="icon" className="rounded-xl md:rounded-2xl h-10 w-10 md:h-16 md:w-16 bg-zinc-50"><Smile className="h-5 w-5 md:h-8 md:w-8 text-zinc-700" /></Button></PopoverTrigger>
                <PopoverContent side="top" align="center" className="w-fit p-2 md:p-4 bg-white/80 backdrop-blur-2xl rounded-[1.5rem] md:rounded-[2.5rem] shadow-2xl mb-4 md:mb-8">
                  <div className="flex gap-2 md:gap-4">{EMOJIS.map((emoji) => (<button key={emoji} onClick={() => sendReaction(emoji)} className="text-2xl md:text-4xl hover:scale-125 transition-transform p-1.5 md:p-3 rounded-xl active:scale-90">{emoji}</button>))}</div>
                </PopoverContent>
               </Popover>

               <Button variant={isCaptionsEnabled ? "default" : "secondary"} size="icon" onClick={() => setIsCaptionsEnabled(!isCaptionsEnabled)} className={cn("rounded-xl md:rounded-2xl h-10 w-10 md:h-16 md:w-16 shadow-xl transition-all", isCaptionsEnabled ? "bg-primary text-white" : "bg-zinc-50 text-zinc-700")}><Captions className="h-5 w-5 md:h-8 md:w-8" /></Button>
               <Button variant={isSharingScreen ? "default" : "secondary"} size="icon" onClick={isSharingScreen ? stopScreenShare : startScreenShare} className={cn("rounded-xl md:rounded-2xl h-10 w-10 md:h-16 md:w-16 shadow-xl transition-all", isSharingScreen ? "bg-primary text-white" : "bg-zinc-50 text-zinc-700")}>{isSharingScreen ? <StopCircle className="h-5 w-5 md:h-8 md:w-8" /> : <ScreenShare className="h-5 w-5 md:h-8 md:w-8" />}</Button>

               <Button variant={hasHandRaised ? "default" : "secondary"} size="icon" onClick={() => { setHasHandRaised(!hasHandRaised); syncPresence({ hasRaisedHand: !hasHandRaised, raisedAt: !hasHandRaised ? Timestamp.now() : null }); }} className={cn("rounded-xl md:rounded-2xl h-10 w-10 md:h-16 md:w-16 shadow-xl transition-all", hasHandRaised ? "bg-yellow-400 text-white" : "bg-zinc-50 text-zinc-700")}><Hand className="h-5 w-5 md:h-8 md:w-8" /></Button>
               
               <div className="hidden md:block">
                 <Button variant="secondary" size="icon" onClick={toggleFullscreen} className="rounded-2xl h-16 w-16 bg-zinc-50 transition-all">
                   {isFullscreen ? <Minimize className="h-8 w-8 text-zinc-700" /> : <Maximize className="h-8 w-8 text-zinc-700" />}
                 </Button>
               </div>

               {isMobile && (
                 <Sheet>
                    <SheetTrigger asChild>
                      <Button variant="secondary" size="icon" className="rounded-xl h-10 w-10 bg-zinc-50"><MessageSquare className="h-5 w-5 text-zinc-700" /></Button>
                    </SheetTrigger>
                    <SheetContent side="bottom" className="h-[80vh] rounded-t-[2.5rem] p-0 overflow-hidden">
                       <SheetHeader className="sr-only">
                         <SheetTitle>Meeting Interaction</SheetTitle>
                       </SheetHeader>
                       <SidebarContent />
                    </SheetContent>
                 </Sheet>
               )}
               
               <Popover>
                 <PopoverTrigger asChild>
                   <Button variant="secondary" size="icon" className="rounded-xl md:rounded-2xl h-10 w-10 md:h-16 md:w-16 bg-zinc-50"><Settings className="h-5 w-5 md:h-8 md:w-8 text-zinc-700" /></Button>
                 </PopoverTrigger>
                 <PopoverContent side="top" align="center" className="w-[85vw] md:w-80 p-6 md:p-8 bg-white/90 backdrop-blur-2xl rounded-[2rem] md:rounded-[3.5rem] shadow-2xl mb-4 md:mb-8">
                   <div className="space-y-4 md:space-y-6">
                     <h3 className="font-black text-xs md:text-sm text-zinc-900 uppercase tracking-widest">Settings</h3>
                     <Separator className="bg-zinc-100" />
                     <div className="space-y-4">
                       <div className="space-y-2">
                         <label className="text-[9px] font-black uppercase tracking-widest text-zinc-400">Audio Source</label>
                         <div className="flex flex-col gap-1.5">
                           {audioInputDevices.length > 0 ? audioInputDevices.map((device) => (
                             <button key={device.deviceId} onClick={() => { setSelectedAudioInput(device.deviceId); toast({ title: "Mic updated" }); }} className={cn("flex items-center justify-between p-2.5 rounded-xl text-[10px] font-bold transition-all", selectedAudioInput === device.deviceId ? "bg-primary/5 text-primary" : "hover:bg-zinc-50 text-zinc-600")}>
                               <span className="truncate max-w-[140px]">{device.label || 'Mic'}</span>
                               {selectedAudioInput === device.deviceId && <Check className="h-3 w-3" />}
                             </button>
                           )) : <p className="text-[10px] text-zinc-400 italic">No mic found</p>}
                         </div>
                       </div>
                       {isMobile && (
                         <div className="pt-4 space-y-3">
                           {isHost && (
                             <Button onClick={toggleMeetingLock} variant={isMeetingLocked ? "destructive" : "outline"} className="w-full h-10 rounded-xl font-black text-[9px] uppercase tracking-widest"><ShieldCheck className="h-3.5 w-3.5 mr-2" /> {isMeetingLocked ? 'Unlock' : 'Lock'}</Button>
                           )}
                         </div>
                       )}
                     </div>
                   </div>
                 </PopoverContent>
               </Popover>
            </div>
          </div>

          {!isFullscreen && !isMobile && (
            <Card className="w-[380px] lg:w-[450px] flex flex-col overflow-hidden border-none shadow-2xl shrink-0 rounded-[3rem] lg:rounded-[4rem] bg-white transition-all duration-300">
               <SidebarContent />
            </Card>
          )}
        </main>
      </div>
    </AuthGuard>
  );
}
