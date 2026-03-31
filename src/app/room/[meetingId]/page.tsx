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
  arrayUnion,
  writeBatch,
  setDoc,
  Timestamp,
} from 'firebase/firestore';
import { format } from 'date-fns';
import AuthGuard from '@/components/auth/AuthGuard';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { Mic, MicOff, Video as VideoIcon, VideoOff, ScreenShare, ScreenShareOff, Timer, Send, Hand, Share2, Shield, User as UserIcon, Smile, BarChart3, Trophy, Frown, AlertCircle, RefreshCcw, Lock, MessageSquare, Users, BookOpen, Download } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Participation Tracking Threshold
const ATTENDANCE_THRESHOLD = 0.7; // 70% participation required for credit

interface Participant {
  id: string;
  name: string;
  joinedAt: Timestamp | null;
  activeSegmentStart?: Timestamp | null;
  totalDuration?: number;
  role: 'host' | 'participant' | 'waiting' | 'left';
  hasRaisedHand?: boolean;
  isMuted?: boolean;
  isVideoOff?: boolean;
  lastReaction?: string;
  lastReactionAt?: Timestamp;
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
  totalSessionsInSeries?: number;
}

interface FloatingReaction {
  id: string;
  emoji: string;
  userName: string;
  left: number;
}

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
}

// Remote Participant Component with robust stream binding via Callback Ref
function RemoteStream({ stream, name, isMuted, isVideoOff, isMe }: { stream: MediaStream | null, name: string, isMuted?: boolean, isVideoOff?: boolean, isMe?: boolean }) {
  // Callback ref ensures srcObject is applied even if the element re-renders due to parent state changes (like mute/unmute)
  const videoRef = useCallback((node: HTMLVideoElement | null) => {
    if (node && stream) {
      node.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="relative w-full h-full bg-zinc-800 rounded-3xl overflow-hidden group border shadow-sm flex items-center justify-center">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isMe}
        className={cn("w-full h-full object-cover transition-opacity", isVideoOff ? "opacity-0" : "opacity-100")}
      />
      {isVideoOff && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900 z-10">
           <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center">
              <UserIcon className="h-8 w-8 text-zinc-600" />
           </div>
           <p className="text-xs text-zinc-500 mt-2 font-medium">Camera Off</p>
        </div>
      )}
      <div className="absolute bottom-4 left-4 flex items-center gap-2 z-20">
        <Badge variant="secondary" className="bg-black/40 text-white backdrop-blur-sm border-none px-3 py-1">
          {name} {isMe && "(You)"}
        </Badge>
        {isMuted && <div className="p-1 bg-red-500 rounded-full shadow-lg"><MicOff className="h-3 w-3 text-white" /></div>}
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

  // Meeting defaults: Audio Muted and Video Off
  const [isAudioMuted, setIsAudioMuted] = useState(true);
  const [isVideoOff, setIsVideoOff] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [hasHandRaised, setHasHandRaised] = useState(false);
  const [elapsedTime, setElapsedTime] = useState('00:00:00');
  const [chatInput, setChatInput] = useState('');
  const [showSummary, setShowSummary] = useState(false);
  const [isProcessingAttendance, setIsProcessingAttendance] = useState(false);
  const [currentTime, setCurrentTime] = useState(Date.now() / 1000);
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  const [isReactionOpen, setIsReactionOpen] = useState(false);
  
  // Media status states
  const [hasMediaPermission, setHasMediaPermission] = useState<boolean | null>(null);
  const [permissionErrorName, setPermissionErrorName] = useState<string | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const isInitializingRef = useRef(false);
  const seenReactionsRef = useRef<Set<string>>(new Set());

  const meetingRef = useMemoFirebase(() => {
    if (!firestore || !meetingId) return null;
    return doc(firestore, 'meetings', meetingId);
  }, [firestore, meetingId]);

  const { data: meetingData } = useDoc<any>(meetingRef);

  const participantsRef = useMemoFirebase(() => {
    if (!firestore || !meetingId) return null;
    return query(collection(firestore, 'meetings', meetingId, 'participants'), orderBy('joinedAt', 'asc'));
  }, [firestore, meetingId]);

  const { data: participants } = useCollection<Participant>(participantsRef);

  const chatRef = useMemoFirebase(() => {
    if (!firestore || !meetingId) return null;
    return query(collection(firestore, 'meetings', meetingId, 'chat'), orderBy('createdAt', 'asc'));
  }, [firestore, meetingId]);

  const { data: chatMessages } = useCollection<ChatMessage>(chatRef);

  const isHost = user?.uid === meetingData?.hostId;
  const currentUserParticipant = participants?.find(p => p.id === user?.uid);
  const activeParticipants = participants?.filter(p => p.role !== 'left') || [];

  const seriesAttendanceRef = useMemoFirebase(() => {
    if (!firestore || !meetingData?.seriesId || !user) return null;
    return doc(firestore, 'seriesAttendance', meetingData.seriesId, 'users', user.uid);
  }, [firestore, meetingData?.seriesId, user]);

  const { data: myCumulativeStats } = useDoc<CumulativeStats>(seriesAttendanceRef);

  // Reaction Monitor: Only one reaction visible at a time
  useEffect(() => {
    if (!participants) return;
    participants.forEach(p => {
      if (p.lastReaction && p.lastReactionAt) {
        const reactionId = `${p.id}-${p.lastReactionAt.seconds}-${p.lastReactionAt.nanoseconds}`;
        if (!seenReactionsRef.current.has(reactionId)) {
          seenReactionsRef.current.add(reactionId);
          const newReaction: FloatingReaction = {
            id: reactionId,
            emoji: p.lastReaction,
            userName: p.name,
            left: Math.random() * 80 + 10,
          };
          // Replace existing floating reactions so only one floats at a time
          setFloatingReactions([newReaction]);
          setTimeout(() => {
            setFloatingReactions(prev => prev.filter(r => r.id !== reactionId));
          }, 4000);
        }
      }
    });
  }, [participants]);

  // Initialize Media safely with a strict lock to prevent AbortError
  const initMedia = useCallback(async (isMounted: boolean) => {
    if (isInitializingRef.current || localStreamRef.current) return;
    isInitializingRef.current = true;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (!isMounted) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      localStreamRef.current = stream;
      setHasMediaPermission(true);
      setPermissionErrorName(null);
    } catch (error: any) {
      if (isMounted) {
        console.error('Media error:', error);
        setHasMediaPermission(false);
        setPermissionErrorName(error.name);
      }
    } finally {
      isInitializingRef.current = false;
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    initMedia(isMounted);
    return () => {
      isMounted = false;
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [initMedia]);

  // Sync hardware toggles directly on the stream object (independent of initialization)
  useEffect(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(t => t.enabled = !isAudioMuted);
      localStreamRef.current.getVideoTracks().forEach(t => t.enabled = !isVideoOff);
    }
  }, [isAudioMuted, isVideoOff]);

  // Participation Tracking and Presence
  useEffect(() => {
    if (!user || !meetingId || !firestore || !meetingData || meetingData.status === 'finished') return;
    const pRef = doc(firestore, 'meetings', meetingId, 'participants', user.uid);
    
    const syncPresence = async () => {
      try {
        await setDoc(pRef, {
          id: user.uid,
          name: user.displayName || user.email?.split('@')[0] || 'Unknown User',
          joinedAt: currentUserParticipant?.joinedAt || serverTimestamp(),
          activeSegmentStart: serverTimestamp(),
          role: user.uid === meetingData.hostId ? 'host' : 'participant',
          isMuted: isAudioMuted,
          isVideoOff: isVideoOff,
          hasRaisedHand: hasHandRaised,
          totalDuration: currentUserParticipant?.totalDuration || 0
        }, { merge: true });
      } catch (err) {
        console.error("Presence sync failed", err);
      }
    };

    syncPresence();

    const interval = setInterval(() => {
      if (meetingData.status !== 'finished' && document.visibilityState === 'visible') {
        const currentDuration = (currentUserParticipant?.totalDuration || 0) + 
          (currentUserParticipant?.activeSegmentStart ? (currentTime - (currentUserParticipant.activeSegmentStart.seconds || currentTime)) : 0);
        updateDoc(pRef, { 
          totalDuration: Math.max(0, currentDuration),
          activeSegmentStart: serverTimestamp() 
        });
      }
    }, 30000);

    return () => {
      clearInterval(interval);
      updateDoc(pRef, { role: 'left', activeSegmentStart: null });
    };
  }, [user, meetingId, firestore, meetingData?.status, currentTime, isAudioMuted, isVideoOff, hasHandRaised]);

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
      const start = meetingData.createdAt.seconds * 1000;
      const diff = Math.max(0, Date.now() - start);
      setElapsedTime(formatDuration(diff / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [meetingData?.createdAt, meetingData?.status]);

  const stopScreenSharing = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
    }
    setIsScreenSharing(false);
    if (firestore && meetingId) {
      updateDoc(doc(firestore, 'meetings', meetingId), { screenSharerId: null });
    }
  };

  const startScreenSharing = async () => {
    if (!meetingData || !user || !firestore) return;
    
    if (meetingData.screenSharerId && meetingData.screenSharerId !== user.uid && !isHost) {
      toast({ variant: 'destructive', title: 'Cannot Share', description: 'Someone is already sharing their screen.' });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenStreamRef.current = stream;
      setIsScreenSharing(true);
      updateDoc(doc(firestore, 'meetings', meetingId), { screenSharerId: user.uid });
      stream.getVideoTracks()[0].onended = () => stopScreenSharing();
    } catch (err) {
      console.error("Screen share error:", err);
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
    setIsReactionOpen(false); // Close popover on selection
  };

  const endMeetingForAll = async () => {
    if (!isHost || !meetingRef || !firestore || !participants) return;
    setIsProcessingAttendance(true);

    const totalSessionSeconds = currentTime - (meetingData.createdAt?.seconds || currentTime);
    const batch = writeBatch(firestore);

    batch.update(meetingRef, { status: 'finished', endedAt: serverTimestamp() });

    for (const p of participants) {
      const duration = (p.totalDuration || 0) + (p.activeSegmentStart ? (currentTime - (p.activeSegmentStart.seconds || currentTime)) : 0);
      const ratio = totalSessionSeconds > 0 ? duration / totalSessionSeconds : 0;

      if (ratio >= ATTENDANCE_THRESHOLD && meetingData.seriesId) {
        const seriesUserRef = doc(firestore, 'seriesAttendance', meetingData.seriesId, 'users', p.id);
        const seriesSnap = await getDoc(seriesUserRef);
        
        if (seriesSnap.exists()) {
          const data = seriesSnap.data();
          if (!data.completedSessionIds?.includes(meetingId)) {
            batch.update(seriesUserRef, {
              attendedHours: increment(meetingData.fixedDurationHours || 0),
              sessionsAttended: increment(1),
              completedSessionIds: arrayUnion(meetingId),
              lastUpdated: serverTimestamp()
            });
          }
        } else {
          batch.set(seriesUserRef, {
            userId: p.id,
            seriesId: meetingData.seriesId,
            attendedHours: meetingData.fixedDurationHours || 0,
            sessionsAttended: 1,
            completedSessionIds: [meetingId],
            lastUpdated: serverTimestamp()
          });
        }
      }
    }

    await batch.commit();
    setIsProcessingAttendance(false);
    setShowSummary(true);
  };

  const copyInviteLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/room/${meetingId}`);
    toast({ title: "Invite link copied!" });
  };

  if (showSummary || meetingData?.status === 'finished') {
    const totalExpectedHours = (meetingData?.totalSessionsInSeries || 1) * (meetingData?.fixedDurationHours || 0);
    const attendedHours = myCumulativeStats?.attendedHours || 0;
    const attendancePercent = totalExpectedHours > 0 ? (attendedHours / totalExpectedHours) * 100 : 0;
    const isPresentOverall = attendancePercent >= 70;

    return (
      <div className="flex h-screen items-center justify-center bg-zinc-50 p-6">
        <Card className="w-full max-w-2xl shadow-xl print-report rounded-3xl overflow-hidden border-none">
          <CardHeader className="text-center border-b pb-8 bg-white pt-12">
            <div className="mx-auto bg-primary/10 w-20 h-20 rounded-full flex items-center justify-center mb-4 no-print shadow-inner">
              <BookOpen className="h-10 w-10 text-primary" />
            </div>
            <CardTitle className="text-4xl font-black">Attendance Report</CardTitle>
            <CardDescription className="text-lg">Series: {meetingData?.name}</CardDescription>
          </CardHeader>
          <CardContent className="pt-10 space-y-10 bg-white px-10">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="bg-zinc-50 p-8 rounded-3xl border text-center shadow-sm">
                <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest mb-3">Total Hours</p>
                <p className="text-4xl font-black">{attendedHours}<span className="text-zinc-400 text-xl">/{totalExpectedHours}</span></p>
              </div>
              <div className="bg-zinc-50 p-8 rounded-3xl border text-center shadow-sm">
                <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest mb-3">Completion</p>
                <p className="text-4xl font-black">{attendancePercent.toFixed(0)}%</p>
              </div>
              <div className="bg-zinc-50 p-8 rounded-3xl border text-center shadow-sm">
                <p className="text-[10px] text-muted-foreground uppercase font-black tracking-widest mb-3">Sessions</p>
                <p className="text-4xl font-black">{myCumulativeStats?.sessionsAttended || 0}<span className="text-zinc-400 text-xl">/{meetingData?.totalSessionsInSeries || 1}</span></p>
              </div>
            </div>

            <div className={cn(
              "p-10 rounded-3xl flex flex-col items-center gap-6 text-center border-4 shadow-lg transition-all",
              isPresentOverall ? "bg-green-50/50 border-green-100 text-green-900" : "bg-red-50/50 border-red-100 text-red-900"
            )}>
              {isPresentOverall ? <Trophy className="h-16 w-16" /> : <Frown className="h-16 w-16" />}
              <div>
                <h3 className="text-3xl font-black">Status: {isPresentOverall ? 'PRESENT' : 'ABSENT'}</h3>
                <p className="text-sm font-medium opacity-80 mt-2 max-w-sm">
                  {isPresentOverall 
                    ? "Congratulations! You have met the 70% participation requirement for this series."
                    : "You have not met the required 70% participation threshold for the credit."}
                </p>
              </div>
            </div>
          </CardContent>
          <CardFooter className="bg-zinc-50/80 p-10 gap-4 no-print border-t">
            <Button variant="outline" className="flex-1 h-14 rounded-2xl font-bold shadow-sm" onClick={() => window.print()}><Download className="mr-2 h-5 w-5" /> Export PDF</Button>
            <Button className="flex-1 h-14 rounded-2xl font-bold shadow-lg" onClick={() => router.push('/dashboard')}>Back to Dashboard</Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <AuthGuard>
      <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
        {/* Floating Reactions Overlay */}
        <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
          {floatingReactions.map(reaction => (
            <div 
              key={reaction.id} 
              className="absolute bottom-0 animate-float-up flex flex-col items-center gap-1"
              style={{ left: `${reaction.left}%` }}
            >
              <div className="text-4xl filter drop-shadow-lg">{reaction.emoji}</div>
              <Badge variant="secondary" className="bg-black/50 text-white border-none text-[10px] py-0 px-2 font-bold whitespace-nowrap">
                {reaction.userName}
              </Badge>
            </div>
          ))}
        </div>

        <header className="flex h-16 items-center justify-between border-b px-6 shrink-0 bg-card z-10">
          <div className="flex items-center gap-4">
            <div className="bg-primary p-2 rounded-lg"><VideoIcon className="h-5 w-5 text-primary-foreground" /></div>
            <div>
              <h1 className="text-sm font-bold truncate max-w-[200px]">{meetingData?.name || 'Loading session...'}</h1>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] py-0 font-mono">{meetingId}</Badge>
                {meetingData?.seriesId && <Badge className="text-[10px] py-0 bg-blue-100 text-blue-700 border-none font-bold">Series Session</Badge>}
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex bg-muted/50 px-3 py-1.5 rounded-full border text-xs font-mono items-center gap-2 shadow-inner">
              <Timer className="h-3.5 w-3.5 text-primary" /> {elapsedTime}
            </div>
            <Separator orientation="vertical" className="h-6 mx-1" />
            <Button variant="ghost" size="icon" onClick={copyInviteLink} className="rounded-full hover:bg-zinc-100 transition-colors"><Share2 className="h-4 w-4" /></Button>
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
                      <RemoteStream 
                        stream={screenStreamRef.current} 
                        name="Your Screen" 
                        isMe={true} 
                      />
                      {/* Mini Preview for Camera during Screen Share */}
                      {!isVideoOff && (
                        <div className="absolute bottom-6 right-6 w-48 aspect-video rounded-2xl overflow-hidden border-2 border-white shadow-2xl z-20">
                          <RemoteStream 
                            stream={localStreamRef.current} 
                            name="Me" 
                            isMe={true} 
                            isVideoOff={isVideoOff}
                          />
                        </div>
                      )}
                   </div>
                 ) : (
                   <div className={cn(
                     "h-full w-full",
                     activeParticipants.length > 1 ? "grid grid-cols-1 md:grid-cols-2 p-4 gap-4" : "flex items-center justify-center"
                   )}>
                      {activeParticipants.map(p => (
                        <div key={p.id} className={cn("w-full h-full", activeParticipants.length === 1 && "max-w-none")}>
                          <RemoteStream 
                            stream={p.id === user?.uid ? localStreamRef.current : null} 
                            name={p.name} 
                            isMe={p.id === user?.uid} 
                            isMuted={p.isMuted}
                            isVideoOff={p.isVideoOff}
                          />
                        </div>
                      ))}
                      {activeParticipants.length === 0 && hasMediaPermission === null && (
                        <div className="text-zinc-500 font-medium">Requesting hardware access...</div>
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
                    <h2 className="text-white text-xl font-bold mb-2">
                      {permissionErrorName === 'NotAllowedError' ? 'Permission Denied' : 'Hardware Access Required'}
                    </h2>
                    <p className="text-zinc-400 text-sm mb-8 leading-relaxed">
                      {permissionErrorName === 'NotAllowedError' 
                        ? "You've blocked camera or microphone access. Please click the camera icon in your browser address bar and choose 'Always allow' to join the session."
                        : "We need access to your camera and microphone. Please ensure they are not in use by another app and you've granted permission."}
                    </p>
                    <Button variant="secondary" className="w-full h-14 rounded-2xl font-bold shadow-lg" onClick={() => window.location.reload()}>
                      <RefreshCcw className="mr-2 h-5 w-5" /> Retry Connection
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Controls */}
            <div className="h-20 bg-card rounded-3xl border shadow-xl flex items-center justify-center px-6 gap-4 shrink-0">
               <Button variant={isAudioMuted ? "destructive" : "secondary"} size="icon" onClick={() => setIsAudioMuted(!isAudioMuted)} className="rounded-full h-12 w-12 shadow-sm transition-all">{isAudioMuted ? <MicOff /> : <Mic />}</Button>
               <Button variant={isVideoOff ? "destructive" : "secondary"} size="icon" onClick={() => setIsVideoOff(!isVideoOff)} className="rounded-full h-12 w-12 shadow-sm transition-all">{isVideoOff ? <VideoOff /> : <VideoIcon />}</Button>
               <Separator orientation="vertical" className="h-8 mx-2" />
               <Button 
                variant={isScreenSharing ? "default" : "secondary"} 
                size="icon" 
                onClick={isScreenSharing ? stopScreenSharing : startScreenSharing} 
                className={cn("rounded-full h-12 w-12 shadow-sm transition-all", isScreenSharing && "bg-blue-600 hover:bg-blue-700")}
               >
                 {isScreenSharing ? <ScreenShareOff /> : <ScreenShare />}
               </Button>
               <Button variant={hasHandRaised ? "default" : "secondary"} size="icon" onClick={() => setHasHandRaised(!hasHandRaised)} className={cn("rounded-full h-12 w-12 shadow-sm transition-all", hasHandRaised && "bg-yellow-400 text-yellow-900 hover:bg-yellow-500")}><Hand /></Button>
               <Popover open={isReactionOpen} onOpenChange={setIsReactionOpen}>
                  <PopoverTrigger asChild><Button variant="secondary" size="icon" className="rounded-full h-12 w-12 shadow-sm"><Smile /></Button></PopoverTrigger>
                  <PopoverContent className="w-auto p-3 grid grid-cols-4 gap-3 rounded-2xl shadow-2xl border-none bg-white">
                     {['👍', '👏', '🔥', '❤️', '😮', '🎉', '💡', '💯'].map(emoji => (
                       <Button key={emoji} variant="ghost" className="h-12 w-12 p-0 text-2xl hover:bg-zinc-100 transition-colors" onClick={() => handleReact(emoji)}>{emoji}</Button>
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
                               const dur = (p.totalDuration || 0) + (p.activeSegmentStart ? (currentTime - (p.activeSegmentStart.seconds || currentTime)) : 0);
                               const maxDur = currentTime - (meetingData?.createdAt?.seconds || currentTime);
                               const ratio = dur / (maxDur || 1);
                               return (
                                 <TableRow key={p.id} className="border-b border-zinc-50 hover:bg-zinc-50/50">
                                    <TableCell className="font-bold">{p.name} {p.id === user?.uid && <span className="text-primary/60 font-medium ml-1">(You)</span>}</TableCell>
                                    <TableCell><Badge variant="outline" className="capitalize font-bold border-zinc-200">{p.role}</Badge></TableCell>
                                    <TableCell className="text-muted-foreground font-medium">{p.joinedAt ? format(new Date(p.joinedAt.seconds * 1000), 'p') : '--'}</TableCell>
                                    <TableCell className="text-right font-mono font-bold text-zinc-600">{formatDuration(dur)}</TableCell>
                                    <TableCell className="text-right"><Badge className={cn("font-black", ratio >= 0.7 ? "bg-green-100 text-green-700 border-none" : "bg-zinc-100 text-zinc-400 border-none")}>{ratio >= 0.7 ? 'Qualified' : 'Pending'}</Badge></TableCell>
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

          {/* Right Sidebar */}
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
                      <div className="space-y-4">
                        {participants?.map(p => {
                          const isOnline = p.role !== 'left';
                          return (
                            <div key={p.id} className={cn("flex items-center gap-3 p-2 rounded-2xl transition-colors", !isOnline ? "opacity-40" : "hover:bg-zinc-50")}>
                               <div className="relative">
                                 <Avatar className="h-10 w-10 border-2 border-white shadow-sm ring-1 ring-zinc-100">
                                    <AvatarFallback className="bg-primary/5 text-primary font-black text-xs">{p.name[0]}</AvatarFallback>
                                 </Avatar>
                                 {p.hasRaisedHand && <div className="absolute -top-1 -right-1 bg-yellow-400 rounded-full p-1.5 border-2 border-white shadow-lg animate-bounce z-10"><Hand className="h-2.5 w-2.5 text-yellow-900" /></div>}
                               </div>
                               <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 overflow-hidden">
                                     <span className="text-xs font-black truncate text-zinc-800">{p.name}</span>
                                     {p.role === 'host' && <Shield className="h-3 w-3 text-blue-500 shrink-0" />}
                                  </div>
                                  <div className="flex items-center gap-3 mt-0.5">
                                     {!isOnline ? (
                                       <Badge variant="outline" className="text-[8px] h-4 px-1.5 py-0 uppercase tracking-widest border-zinc-200">Offline</Badge>
                                     ) : (
                                       <div className="flex items-center gap-3">
                                         {p.isMuted ? <MicOff className="h-3 w-3 text-red-500" /> : <Mic className="h-3 w-3 text-green-500" />}
                                         {p.isVideoOff ? <VideoOff className="h-3 w-3 text-zinc-300" /> : <VideoIcon className="h-3 w-3 text-primary" />}
                                       </div>
                                     )}
                                  </div>
                               </div>
                            </div>
                          );
                        })}
                      </div>
                   </ScrollArea>
                   
                   <Separator />
                   <div className="p-5 bg-zinc-50/80">
                      <div className="space-y-4">
                         <div className="flex justify-between text-[10px] uppercase font-black text-zinc-400 tracking-widest px-1">
                            <span>Series Progress</span>
                            <span className="text-primary">{myCumulativeStats?.attendedHours || 0}h Earned</span>
                         </div>
                         <div className="h-2.5 w-full bg-zinc-200 rounded-full overflow-hidden shadow-inner">
                            <div 
                              className="h-full bg-primary transition-all duration-1000 shadow-[0_0_10px_rgba(0,0,0,0.1)]" 
                              style={{ width: `${Math.min(100, (myCumulativeStats?.attendedHours || 0) / Math.max(1, (meetingData?.totalSessionsInSeries || 1) * (meetingData?.fixedDurationHours || 0)) * 100)}%` }} 
                            />
                         </div>
                         <div className="text-[10px] text-center text-zinc-500 leading-relaxed font-medium bg-white p-3 rounded-xl border border-zinc-100">
                            Maintain 70% participation in <b>Session {meetingData?.sessionIndex || 1}</b> to secure your attendance credit.
                         </div>
                      </div>
                   </div>
                </TabsContent>

                <TabsContent value="chat" className="flex-1 flex flex-col overflow-hidden mt-0">
                   <ScrollArea className="flex-1 p-6">
                      <div className="space-y-6">
                         {chatMessages?.map((msg) => (
                           <div key={msg.id} className={cn("flex flex-col gap-1.5", msg.senderId === user?.uid ? "items-end" : "items-start")}>
                              <p className="text-[10px] font-black text-zinc-400 px-1 uppercase tracking-wider">{msg.senderName}</p>
                              <div className={cn("max-w-[85%] px-4 py-3 rounded-2xl text-xs font-medium shadow-sm leading-relaxed", msg.senderId === user?.uid ? "bg-primary text-primary-foreground rounded-tr-none" : "bg-white border rounded-tl-none")}>{msg.text}</div>
                           </div>
                         ))}
                      </div>
                   </ScrollArea>
                   <div className="p-4 border-t bg-white">
                      <div className="relative flex items-center">
                        <Input placeholder="Type message..." value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()} className="pr-12 rounded-2xl h-12 bg-zinc-50 border-zinc-100 focus:bg-white transition-all shadow-inner" />
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
