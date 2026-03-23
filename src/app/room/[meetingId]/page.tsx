
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
  setDoc,
  updateDoc,
  increment,
  arrayUnion,
  writeBatch,
  onSnapshot,
  deleteDoc,
  getDocs,
} from 'firebase/firestore';
import { format } from 'date-fns';
import AuthGuard from '@/components/auth/AuthGuard';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { Mic, MicOff, Video as VideoIcon, VideoOff, ScreenShare, ScreenShareOff, Timer, Send, Hand, Share2, Shield, User as UserIcon, Smile, BarChart3, Trophy, Frown, AlertCircle, Download, BookOpen, MessageSquare, Users, MoreVertical, RefreshCcw } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

// Constants
const ATTENDANCE_THRESHOLD = 0.7; // 70% participation required for credit

interface Participant {
  id: string;
  name: string;
  joinedAt: { seconds: number } | null;
  activeSegmentStart?: { seconds: number } | null;
  totalDuration?: number;
  role: 'host' | 'participant' | 'waiting' | 'left';
  hasRaisedHand?: boolean;
  isMuted?: boolean;
  isVideoOff?: boolean;
  lastReaction?: string;
}

interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: { seconds: number };
}

interface CumulativeStats {
  attendedHours: number;
  sessionsAttended: number;
  totalSessionsInSeries?: number;
}

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
}

// Remote Participant Component to handle WebRTC streams
function RemoteStream({ stream, name, isMuted, isVideoOff, isMe }: { stream: MediaStream | null, name: string, isMuted?: boolean, isVideoOff?: boolean, isMe?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <div className="relative w-full h-full bg-zinc-800 rounded-3xl overflow-hidden group">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isMe} // Only mute local user to prevent feedback loop
        className={cn("w-full h-full object-cover", isVideoOff && "hidden")}
      />
      {isVideoOff && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900">
           <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center">
              <UserIcon className="h-8 w-8 text-zinc-600" />
           </div>
           <p className="text-xs text-zinc-500 mt-2">Camera Off</p>
        </div>
      )}
      <div className="absolute bottom-4 left-4 flex items-center gap-2">
        <Badge variant="secondary" className="bg-black/40 text-white backdrop-blur-sm border-none">
          {name} {isMe && "(You)"}
        </Badge>
        {isMuted && <MicOff className="h-3 w-3 text-red-500" />}
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

  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [hasHandRaised, setHasHandRaised] = useState(false);
  const [elapsedTime, setElapsedTime] = useState('00:00:00');
  const [chatInput, setChatInput] = useState('');
  const [showSummary, setShowSummary] = useState(false);
  const [isProcessingAttendance, setIsProcessingAttendance] = useState(false);
  const [currentTime, setCurrentTime] = useState(Date.now() / 1000);
  const [hasMediaPermission, setHasMediaPermission] = useState<boolean | null>(null);

  // WebRTC State
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const peerConnections = useRef<Record<string, RTCPeerConnection>>({});
  const localStreamRef = useRef<MediaStream | null>(null);
  const isInitializingRef = useRef(false);

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

  const seriesAttendanceRef = useMemoFirebase(() => {
    if (!firestore || !meetingData?.seriesId || !user) return null;
    return doc(firestore, 'seriesAttendance', meetingData.seriesId, 'users', user.uid);
  }, [firestore, meetingData?.seriesId, user]);

  const { data: myCumulativeStats } = useDoc<CumulativeStats>(seriesAttendanceRef);

  const isHost = user?.uid === meetingData?.hostId;
  const currentUserParticipant = participants?.find(p => p.id === user?.uid);

  // Hardware Initialization
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
      
      // Initial tracks state
      stream.getAudioTracks().forEach(t => t.enabled = !isAudioMuted);
      stream.getVideoTracks().forEach(t => t.enabled = !isVideoOff);
    } catch (error: any) {
      if (isMounted) {
        console.error('Media error:', error);
        setHasMediaPermission(false);
      }
    } finally {
      isInitializingRef.current = false;
    }
  }, [isAudioMuted, isVideoOff]);

  useEffect(() => {
    let isMounted = true;
    initMedia(isMounted);
    return () => {
      isMounted = false;
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
        localStreamRef.current = null;
      }
    };
  }, [initMedia]);

  // Sync Hardware Toggles
  useEffect(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(t => t.enabled = !isAudioMuted);
      localStreamRef.current.getVideoTracks().forEach(t => t.enabled = !isVideoOff);
    }
  }, [isAudioMuted, isVideoOff]);

  // Participation Tracking
  useEffect(() => {
    if (!user || !meetingId || !firestore || !meetingData || meetingData.status === 'finished') return;
    const pRef = doc(firestore, 'meetings', meetingId, 'participants', user.uid);
    
    setDoc(pRef, {
      id: user.uid,
      name: user.displayName || user.email?.split('@')[0] || 'Unknown User',
      joinedAt: serverTimestamp(),
      activeSegmentStart: serverTimestamp(),
      role: user.uid === meetingData.hostId ? 'host' : 'participant',
      isMuted: isAudioMuted,
      isVideoOff: isVideoOff,
    }, { merge: true });

    const interval = setInterval(() => {
      if (meetingData.status !== 'finished') {
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
  }, [user, meetingId, firestore, meetingData?.status, currentTime, isAudioMuted, isVideoOff]);

  // WebRTC Signaling Logic (Simplified for MVP)
  useEffect(() => {
    if (!firestore || !meetingId || !user || !localStreamRef.current) return;

    // Listen for connection requests
    const webrtcCollection = collection(firestore, 'meetings', meetingId, 'webrtc');
    
    const unsubscribe = onSnapshot(webrtcCollection, async (snapshot) => {
      for (const change of snapshot.docChanges()) {
        const data = change.doc.data();
        if (change.type === 'added') {
          // Logic for handling SDP offers/answers would go here in a production app
          // For MVP, we use the participants list to drive visual feedback
        }
      }
    });

    return () => unsubscribe();
  }, [firestore, meetingId, user]);

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

  const toggleMic = () => {
    const next = !isAudioMuted;
    setIsAudioMuted(next);
    if (firestore && user && meetingId) {
      updateDoc(doc(firestore, 'meetings', meetingId, 'participants', user.uid), { isMuted: next });
    }
  };

  const toggleVideo = () => {
    const next = !isVideoOff;
    setIsVideoOff(next);
    if (firestore && user && meetingId) {
      updateDoc(doc(firestore, 'meetings', meetingId, 'participants', user.uid), { isVideoOff: next });
    }
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
        <Card className="w-full max-w-2xl shadow-xl print-report">
          <CardHeader className="text-center border-b pb-8">
            <div className="mx-auto bg-primary/10 w-16 h-16 rounded-full flex items-center justify-center mb-4 no-print">
              <BookOpen className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-3xl">Attendance Summary</CardTitle>
            <CardDescription>Series: {meetingData?.name}</CardDescription>
          </CardHeader>
          <CardContent className="pt-8 space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white p-6 rounded-xl border text-center shadow-sm">
                <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest mb-2">Total Hours</p>
                <p className="text-3xl font-black">{attendedHours}<span className="text-zinc-400 text-lg">/{totalExpectedHours}</span></p>
              </div>
              <div className="bg-white p-6 rounded-xl border text-center shadow-sm">
                <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest mb-2">Completion</p>
                <p className="text-3xl font-black">{attendancePercent.toFixed(0)}%</p>
              </div>
              <div className="bg-white p-6 rounded-xl border text-center shadow-sm">
                <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest mb-2">Sessions</p>
                <p className="text-3xl font-black">{myCumulativeStats?.sessionsAttended || 0}<span className="text-zinc-400 text-lg">/{meetingData?.totalSessionsInSeries || 1}</span></p>
              </div>
            </div>

            <div className={cn(
              "p-8 rounded-2xl flex flex-col items-center gap-4 text-center border-2",
              isPresentOverall ? "bg-green-50 border-green-100 text-green-800" : "bg-red-50 border-red-100 text-red-800"
            )}>
              {isPresentOverall ? <Trophy className="h-12 w-12" /> : <Frown className="h-12 w-12" />}
              <div>
                <h3 className="text-2xl font-bold">Status: {isPresentOverall ? 'PRESENT' : 'ABSENT'}</h3>
                <p className="text-sm opacity-80 mt-1">Based on cumulative 70% participation requirement.</p>
              </div>
            </div>
          </CardContent>
          <CardFooter className="bg-zinc-50/50 p-6 gap-3 no-print">
            <Button variant="outline" className="flex-1 h-12" onClick={() => window.print()}><Download className="mr-2 h-4 w-4" /> Download PDF</Button>
            <Button className="flex-1 h-12" onClick={() => router.push('/dashboard')}>Dashboard</Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <AuthGuard>
      <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
        <header className="flex h-16 items-center justify-between border-b px-6 shrink-0 bg-card z-10">
          <div className="flex items-center gap-4">
            <div className="bg-primary p-2 rounded-lg"><VideoIcon className="h-5 w-5 text-primary-foreground" /></div>
            <div>
              <h1 className="text-sm font-bold truncate max-w-[200px]">{meetingData?.name || 'Loading...'}</h1>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] py-0">{meetingId}</Badge>
                {meetingData?.seriesId && <Badge className="text-[10px] py-0 bg-blue-100 text-blue-700 border-none">Series</Badge>}
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex bg-muted/50 px-3 py-1.5 rounded-full border text-xs font-mono items-center gap-2">
              <Timer className="h-3.5 w-3.5 text-primary" /> {elapsedTime}
            </div>
            <Separator orientation="vertical" className="h-6 mx-1" />
            <Button variant="ghost" size="icon" onClick={copyInviteLink} className="rounded-full"><Share2 className="h-4 w-4" /></Button>
            {isHost ? (
              <Button onClick={endMeetingForAll} variant="destructive" disabled={isProcessingAttendance} className="rounded-full h-9 px-4 text-xs font-bold">
                {isProcessingAttendance ? 'Ending...' : 'End Session'}
              </Button>
            ) : (
              <Button onClick={() => router.push('/dashboard')} variant="outline" className="rounded-full h-9 px-4 text-xs font-bold">Leave</Button>
            )}
          </div>
        </header>

        <main className="flex-1 flex overflow-hidden p-4 gap-4 relative">
          <div className="flex-1 flex flex-col gap-4 overflow-hidden">
            <div className="flex-1 bg-zinc-900 rounded-3xl relative overflow-hidden grid grid-cols-1 md:grid-cols-2 gap-4 p-4 shadow-2xl border">
               {/* Remote Participants grid */}
               {participants?.filter(p => p.role !== 'left').map(p => (
                 <RemoteStream 
                   key={p.id} 
                   stream={p.id === user?.uid ? localStreamRef.current : null} 
                   name={p.name} 
                   isMe={p.id === user?.uid} 
                   isMuted={p.isMuted}
                   isVideoOff={p.isVideoOff}
                 />
               ))}

              {hasMediaPermission === false && (
                <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/90 z-30 px-6">
                  <div className="max-w-md w-full">
                    <Alert variant="destructive" className="bg-zinc-900 border-destructive mb-4">
                      <AlertTitle className="flex items-center gap-2"><AlertCircle className="h-4 w-4" /> Hardware Access Required</AlertTitle>
                      <AlertDescription>
                        Please ensure your camera and microphone are not being used by another app and you've granted permission in your browser.
                      </AlertDescription>
                    </Alert>
                    <Button variant="secondary" className="w-full h-12 rounded-xl" onClick={() => window.location.reload()}>
                      <RefreshCcw className="mr-2 h-4 w-4" /> Retry Connection
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="h-20 bg-card rounded-3xl border shadow-lg flex items-center justify-center px-6 gap-4 shrink-0">
               <Button variant={isAudioMuted ? "destructive" : "secondary"} size="icon" onClick={toggleMic} className="rounded-full h-12 w-12">{isAudioMuted ? <MicOff /> : <Mic />}</Button>
               <Button variant={isVideoOff ? "destructive" : "secondary"} size="icon" onClick={toggleVideo} className="rounded-full h-12 w-12">{isVideoOff ? <VideoOff /> : <VideoIcon />}</Button>
               <Separator orientation="vertical" className="h-8 mx-2" />
               <Button variant="secondary" size="icon" onClick={() => toast({ title: "Screen share available soon" })} className="rounded-full h-12 w-12"><ScreenShare /></Button>
               <Button variant={hasHandRaised ? "default" : "secondary"} size="icon" onClick={() => setHasHandRaised(!hasHandRaised)} className={cn("rounded-full h-12 w-12", hasHandRaised && "bg-yellow-400 text-yellow-900")}><Hand /></Button>
               <Popover>
                  <PopoverTrigger asChild><Button variant="secondary" size="icon" className="rounded-full h-12 w-12"><Smile /></Button></PopoverTrigger>
                  <PopoverContent className="w-auto p-2 grid grid-cols-4 gap-2">
                     {['👍', '👏', '🔥', '❤️', '😮', '🎉', '💡', '💯'].map(emoji => (
                       <Button key={emoji} variant="ghost" className="h-10 w-10 p-0 text-xl" onClick={() => { if (firestore && user) updateDoc(doc(firestore, 'meetings', meetingId, 'participants', user.uid), { lastReaction: emoji }); }}>{emoji}</Button>
                     ))}
                  </PopoverContent>
               </Popover>
               <Separator orientation="vertical" className="h-8 mx-2" />
               <Dialog>
                 <DialogTrigger asChild><Button variant="secondary" size="icon" className="rounded-full h-12 w-12"><BarChart3 /></Button></DialogTrigger>
                 <DialogContent className="max-w-3xl">
                    <DialogHeader><DialogTitle>Session Participation</DialogTitle><DialogDescription>Real-time attendance tracking.</DialogDescription></DialogHeader>
                    <div className="py-4">
                       <Table>
                          <TableHeader><TableRow><TableHead>Student</TableHead><TableHead>Status</TableHead><TableHead>Join Time</TableHead><TableHead className="text-right">Active Time</TableHead><TableHead className="text-right">Credit</TableHead></TableRow></TableHeader>
                          <TableBody>
                             {participants?.filter(p => p.role !== 'left').map(p => {
                               const dur = (p.totalDuration || 0) + (p.activeSegmentStart ? (currentTime - (p.activeSegmentStart.seconds || currentTime)) : 0);
                               const maxDur = currentTime - (meetingData?.createdAt?.seconds || currentTime);
                               const ratio = dur / (maxDur || 1);
                               return (
                                 <TableRow key={p.id}>
                                    <TableCell className="font-medium">{p.name} {p.id === user?.uid && "(You)"}</TableCell>
                                    <TableCell className="capitalize">{p.role}</TableCell>
                                    <TableCell className="text-muted-foreground">{p.joinedAt ? format(new Date(p.joinedAt.seconds * 1000), 'p') : '--'}</TableCell>
                                    <TableCell className="text-right font-mono">{formatDuration(dur)}</TableCell>
                                    <TableCell className="text-right"><Badge variant={ratio >= 0.7 ? "default" : "secondary"}>{ratio >= 0.7 ? 'Qualified' : 'Pending'}</Badge></TableCell>
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

          <Card className="w-80 flex flex-col overflow-hidden border shadow-lg shrink-0 rounded-3xl">
             <Tabs defaultValue="participants" className="flex-1 flex flex-col overflow-hidden">
                <div className="px-4 pt-4 border-b">
                   <TabsList className="w-full h-12 grid grid-cols-2 rounded-2xl">
                      <TabsTrigger value="participants" className="rounded-xl flex items-center gap-2"><Users className="h-4 w-4" /> Students</TabsTrigger>
                      <TabsTrigger value="chat" className="rounded-xl flex items-center gap-2"><MessageSquare className="h-4 w-4" /> Chat</TabsTrigger>
                   </TabsList>
                </div>

                <TabsContent value="participants" className="flex-1 flex flex-col overflow-hidden mt-0">
                   <ScrollArea className="flex-1 p-4">
                      <div className="space-y-4">
                        {participants?.map(p => {
                          const isOnline = p.role !== 'left';
                          return (
                            <div key={p.id} className={cn("flex items-center gap-3 group", !isOnline && "opacity-50")}>
                               <div className="relative">
                                 <Avatar className="h-10 w-10 border-2 border-background shadow-sm">
                                    <AvatarFallback className="bg-primary/5 text-primary font-bold text-xs">{p.name[0]}</AvatarFallback>
                                 </Avatar>
                                 {p.hasRaisedHand && <div className="absolute -top-1 -right-1 bg-yellow-400 rounded-full p-1 border border-background shadow-sm animate-bounce"><Hand className="h-2 w-2" /></div>}
                               </div>
                               <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 overflow-hidden">
                                     <p className="text-xs font-bold truncate">{p.name}</p>
                                     {p.role === 'host' && <Shield className="h-3 w-3 text-blue-500 shrink-0" />}
                                  </div>
                                  <div className="text-[10px] text-muted-foreground flex items-center gap-2 mt-0.5">
                                     {!isOnline ? <Badge variant="outline" className="text-[8px] h-3 px-1 py-0">Left</Badge> : (
                                       <div className="flex items-center gap-2">
                                         {p.isMuted ? <MicOff className="h-3 w-3 text-red-500" /> : <Mic className="h-3 w-3 text-green-500" />}
                                         {p.isVideoOff ? <VideoOff className="h-3 w-3 text-zinc-400" /> : <VideoIcon className="h-3 w-3 text-primary" />}
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
                   <div className="p-4 bg-zinc-50/50">
                      <div className="space-y-3">
                         <div className="flex justify-between text-[10px] uppercase font-bold text-muted-foreground tracking-widest">
                            <span>Series Progress</span>
                            <span>{myCumulativeStats?.attendedHours || 0}h Earned</span>
                         </div>
                         <div className="h-2 w-full bg-zinc-200 rounded-full overflow-hidden shadow-inner">
                            <div 
                              className="h-full bg-primary transition-all duration-1000" 
                              style={{ width: `${Math.min(100, (myCumulativeStats?.attendedHours || 0) / Math.max(1, (meetingData?.totalSessionsInSeries || 1) * (meetingData?.fixedDurationHours || 0)) * 100)}%` }} 
                            />
                         </div>
                         <p className="text-[10px] text-center text-muted-foreground leading-relaxed px-2">
                            Need 70% participation in <b>Session {meetingData?.sessionIndex || 1}</b> for credit.
                         </p>
                      </div>
                   </div>
                </TabsContent>

                <TabsContent value="chat" className="flex-1 flex flex-col overflow-hidden mt-0">
                   <ScrollArea className="flex-1 p-4">
                      <div className="space-y-4">
                         {chatMessages?.map((msg) => (
                           <div key={msg.id} className={cn("flex flex-col gap-1", msg.senderId === user?.uid ? "items-end" : "items-start")}>
                              <p className="text-[10px] font-bold text-muted-foreground px-1">{msg.senderName}</p>
                              <div className={cn("max-w-[90%] px-3 py-2 rounded-2xl text-xs", msg.senderId === user?.uid ? "bg-primary text-primary-foreground rounded-tr-none" : "bg-muted rounded-tl-none")}>{msg.text}</div>
                           </div>
                         ))}
                      </div>
                   </ScrollArea>
                   <div className="p-4 border-t bg-card">
                      <div className="relative flex items-center">
                        <Input placeholder="Type message..." value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()} className="pr-10 rounded-xl h-11" />
                        <Button size="icon" variant="ghost" onClick={handleSendMessage} className="absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 text-primary"><Send className="h-4 w-4" /></Button>
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

