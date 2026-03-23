
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
} from 'firebase/firestore';
import { format } from 'date-fns';
import AuthGuard from '@/components/auth/AuthGuard';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { Mic, MicOff, Video as VideoIcon, VideoOff, ScreenShare, ScreenShareOff, Timer, Send, Hand, Share2, Shield, User as UserIcon, Smile, BarChart3, Trophy, Frown, AlertCircle, Download, BookOpen, MessageSquare, Users, MoreVertical } from 'lucide-react';
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
const LATE_THRESHOLD_SECONDS = 15 * 60; // 15 minutes

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
  const mainVideoRef = useRef<HTMLVideoElement>(null);
  const miniVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const isInitializingMedia = useRef(false);

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

  // Initialize Media (Camera/Mic)
  useEffect(() => {
    if (isInitializingMedia.current) return;
    isInitializingMedia.current = true;

    let isSubscribed = true;

    const getMediaPermission = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        
        if (!isSubscribed) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }

        localStreamRef.current = stream;
        setHasMediaPermission(true);

        if (miniVideoRef.current) {
          miniVideoRef.current.srcObject = stream;
        }
        
        stream.getAudioTracks().forEach(track => track.enabled = !isAudioMuted);
        stream.getVideoTracks().forEach(track => track.enabled = !isVideoOff);
      } catch (error: any) {
        if (isSubscribed) {
          console.error('Error accessing media:', error);
          if (error.name !== 'AbortError') {
            setHasMediaPermission(false);
            toast({
              variant: 'destructive',
              title: 'Media Access Error',
              description: 'Please enable camera and microphone permissions.',
            });
          }
        }
      } finally {
        isInitializingMedia.current = false;
      }
    };

    if (!localStreamRef.current && hasMediaPermission === null) {
      getMediaPermission();
    }

    return () => {
      isSubscribed = false;
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => track.stop());
        screenStreamRef.current = null;
      }
    };
  }, []);

  // Priority Logic for Screen Sharing
  useEffect(() => {
    if (!meetingData || !user) return;

    const currentSharer = meetingData.screenSharerId;

    // If I am sharing locally but someone else (like a host) has taken over in Firestore
    if (isScreenSharing && currentSharer !== user.uid) {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => track.stop());
        screenStreamRef.current = null;
      }
      setIsScreenSharing(false);
      toast({
        title: "Screen Share Ended",
        description: "Another user is now sharing their screen.",
      });
    }
  }, [meetingData?.screenSharerId, user?.uid, isScreenSharing]);

  // Sync video elements with current streams
  useEffect(() => {
    const mainVideo = mainVideoRef.current;
    const miniVideo = miniVideoRef.current;

    if (mainVideo) {
      if (isScreenSharing && screenStreamRef.current) {
        if (mainVideo.srcObject !== screenStreamRef.current) {
          mainVideo.srcObject = screenStreamRef.current;
        }
      } else if (localStreamRef.current) {
        if (mainVideo.srcObject !== localStreamRef.current) {
          mainVideo.srcObject = localStreamRef.current;
        }
      }
    }
    
    if (miniVideo && localStreamRef.current) {
      if (miniVideo.srcObject !== localStreamRef.current) {
        miniVideo.srcObject = localStreamRef.current;
      }
    }

    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => track.enabled = !isAudioMuted);
      localStreamRef.current.getVideoTracks().forEach(track => track.enabled = !isVideoOff);
    }
  }, [isAudioMuted, isVideoOff, isScreenSharing, hasMediaPermission]);

  // Update current time
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(Date.now() / 1000), 1000);
    return () => clearInterval(interval);
  }, []);

  // Track session time
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

  // Join/Update participant
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

    const checkpointInterval = setInterval(() => {
      if (meetingData.status === 'active' || meetingData.status === 'pending' || meetingData.status === 'scheduled') {
        const currentDuration = (currentUserParticipant?.totalDuration || 0) + 
          (currentUserParticipant?.activeSegmentStart ? (currentTime - (currentUserParticipant.activeSegmentStart.seconds || currentTime)) : 0);
        
        const meetingStartTime = meetingData.createdAt?.seconds || currentTime;
        const maxPossibleDuration = currentTime - meetingStartTime;
        const cappedTotal = Math.max(0, Math.min(currentDuration, maxPossibleDuration));

        updateDoc(pRef, { 
          totalDuration: cappedTotal,
          activeSegmentStart: serverTimestamp() 
        });
      }
    }, 30000);

    return () => {
      clearInterval(checkpointInterval);
      updateDoc(pRef, { role: 'left', activeSegmentStart: null });
    };
  }, [user, meetingId, firestore, meetingData?.status, !!meetingData]);

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
    const nextValue = !isAudioMuted;
    setIsAudioMuted(nextValue);
    if (firestore && user && meetingId) {
      updateDoc(doc(firestore, 'meetings', meetingId, 'participants', user.uid), { isMuted: nextValue });
    }
  };

  const toggleVideo = () => {
    const nextValue = !isVideoOff;
    setIsVideoOff(nextValue);
    if (firestore && user && meetingId) {
      updateDoc(doc(firestore, 'meetings', meetingId, 'participants', user.uid), { isVideoOff: nextValue });
    }
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(track => track.stop());
        screenStreamRef.current = null;
      }
      setIsScreenSharing(false);
      if (firestore && meetingId) {
        updateDoc(doc(firestore, 'meetings', meetingId), { screenSharerId: null });
      }
    } else {
      // Logic for only allowing one sharer at a time with host priority
      if (meetingData?.screenSharerId && !isHost) {
        toast({
          variant: "destructive",
          title: "Cannot Share Screen",
          description: "Someone else is already sharing. Only the host can override a shared screen.",
        });
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = stream;
        setIsScreenSharing(true);

        if (firestore && meetingId && user) {
          updateDoc(doc(firestore, 'meetings', meetingId), { screenSharerId: user.uid });
        }

        stream.getVideoTracks()[0].onended = () => {
          setIsScreenSharing(false);
          screenStreamRef.current = null;
          if (firestore && meetingId) {
            updateDoc(doc(firestore, 'meetings', meetingId), { screenSharerId: null });
          }
        };
      } catch (err) {
        console.error("Error sharing screen:", err);
        toast({
          variant: 'destructive',
          title: 'Screen Share Failed',
          description: 'Could not access screen for sharing.',
        });
      }
    }
  };

  const toggleHand = () => {
    const nextValue = !hasHandRaised;
    setHasHandRaised(nextValue);
    if (firestore && user && meetingId) {
      updateDoc(doc(firestore, 'meetings', meetingId, 'participants', user.uid), { hasRaisedHand: nextValue });
    }
  };

  const endMeetingForAll = async () => {
    if (!isHost || !meetingRef || !firestore || !participants) return;
    setIsProcessingAttendance(true);

    const totalSessionSeconds = currentTime - (meetingData.createdAt?.seconds || currentTime);
    const batch = writeBatch(firestore);

    batch.update(meetingRef, {
      status: 'finished',
      endedAt: serverTimestamp(),
      screenSharerId: null
    });

    for (const p of participants) {
      const currentDuration = (p.totalDuration || 0) + (p.activeSegmentStart ? (currentTime - (p.activeSegmentStart.seconds || currentTime)) : 0);
      const cappedDuration = Math.min(currentDuration, totalSessionSeconds);
      const participationRatio = totalSessionSeconds > 0 ? cappedDuration / totalSessionSeconds : 0;

      if (participationRatio >= ATTENDANCE_THRESHOLD && meetingData.seriesId) {
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
    const link = `${window.location.origin}/room/${meetingId}`;
    navigator.clipboard.writeText(link);
    toast({ title: "Invite link copied!", description: "Share this link with participants." });
  };

  const handleDownloadPDF = () => {
    const originalTitle = document.title;
    document.title = `Attendance_Report_${meetingId}_${format(new Date(), 'yyyy-MM-dd')}`;
    window.print();
    document.title = originalTitle;
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
            <CardDescription>Recurring Series: {meetingData?.name}</CardDescription>
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
                <h3 className="text-2xl font-bold">Overall Status: {isPresentOverall ? 'PRESENT' : 'ABSENT'}</h3>
                <p className="text-sm opacity-80 mt-1">Based on cumulative attendance requirement of 70%.</p>
              </div>
            </div>
          </CardContent>
          <CardFooter className="bg-zinc-50/50 p-6 gap-3 no-print">
            <Button variant="outline" className="flex-1 h-12" onClick={handleDownloadPDF}><Download className="mr-2 h-4 w-4" /> Download PDF</Button>
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
            <div className="bg-primary p-2 rounded-lg">
              <VideoIcon className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-sm font-bold truncate max-w-[200px]">{meetingData?.name || 'Loading Meeting...'}</h1>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] py-0">{meetingId}</Badge>
                {meetingData?.seriesId && <Badge className="text-[10px] py-0 bg-blue-100 text-blue-700 border-none">Recurring</Badge>}
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex bg-muted/50 px-3 py-1.5 rounded-full border text-xs font-mono items-center gap-2">
              <Timer className="h-3.5 w-3.5 text-primary" /> {elapsedTime}
            </div>
            <Separator orientation="vertical" className="h-6 mx-1" />
            <Button variant="ghost" size="icon" onClick={copyInviteLink} className="rounded-full">
              <Share2 className="h-4 w-4" />
            </Button>
            {isHost ? (
              <Button onClick={endMeetingForAll} variant="destructive" disabled={isProcessingAttendance} className="rounded-full h-9 px-4 text-xs font-bold">
                {isProcessingAttendance ? 'Ending...' : 'End for All'}
              </Button>
            ) : (
              <Button onClick={() => router.push('/dashboard')} variant="outline" className="rounded-full h-9 px-4 text-xs font-bold">Leave</Button>
            )}
          </div>
        </header>

        <main className="flex-1 flex overflow-hidden p-4 gap-4 relative">
          <div className="flex-1 flex flex-col gap-4 overflow-hidden">
            <div className="flex-1 bg-zinc-900 rounded-3xl relative overflow-hidden flex items-center justify-center border shadow-2xl">
              <video 
                ref={mainVideoRef} 
                className={cn("w-full h-full object-contain rounded-3xl", (isVideoOff && !isScreenSharing) && "hidden")} 
                autoPlay 
                muted 
                playsInline 
              />
              
              {isVideoOff && !isScreenSharing && (
                <div className="text-zinc-600 flex flex-col items-center gap-4">
                  <div className="w-24 h-24 rounded-full bg-zinc-800 flex items-center justify-center animate-pulse">
                    <UserIcon className="h-10 w-10 opacity-20" />
                  </div>
                  <p className="text-sm font-medium tracking-wide">Video is Off</p>
                </div>
              )}
              
              <div className="absolute top-6 left-6 flex items-center gap-2">
                <Badge variant="secondary" className="bg-black/40 text-white backdrop-blur-md border-none px-3 py-1">
                  {meetingData?.screenSharerId ? `Screen: ${participants?.find(p => p.id === meetingData.screenSharerId)?.name}` : `${currentUserParticipant?.name} (You)`}
                </Badge>
              </div>

              <div className="absolute bottom-6 right-6 w-48 aspect-video bg-zinc-800 rounded-2xl border-2 border-zinc-700 shadow-2xl overflow-hidden group">
                 <div className="w-full h-full flex items-center justify-center relative">
                    <video 
                      ref={miniVideoRef} 
                      className={cn("w-full h-full object-cover", isVideoOff && "hidden")} 
                      autoPlay 
                      muted 
                      playsInline 
                    />
                    {isVideoOff && <VideoOff className="h-6 w-6 text-zinc-600" />}
                    {hasMediaPermission === null && (
                        <div className="p-2 text-center text-[10px] text-zinc-400">Requesting access...</div>
                    )}
                 </div>
                 <div className="absolute bottom-2 left-2">
                    {isAudioMuted && <MicOff className="h-3 w-3 text-red-500" />}
                 </div>
              </div>

              {hasHandRaised && (
                <div className="absolute top-6 right-6 bg-yellow-400 text-yellow-900 p-3 rounded-2xl animate-bounce shadow-lg">
                  <Hand className="h-6 w-6 fill-current" />
                </div>
              )}

              {hasMediaPermission === false && (
                <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/90 z-20 px-6">
                  <Alert variant="destructive" className="max-w-md bg-zinc-900 border-destructive">
                    <AlertTitle className="flex items-center gap-2"><AlertCircle className="h-4 w-4" /> Media Access Required</AlertTitle>
                    <AlertDescription>
                      Please allow camera and microphone access to participate in the video session. 
                      Check your browser settings and refresh the page.
                    </AlertDescription>
                  </Alert>
                </div>
              )}
            </div>

            {/* Bottom Controls Bar */}
            <div className="h-20 bg-card rounded-3xl border shadow-lg flex items-center justify-center px-6 gap-2 sm:gap-4 shrink-0">
               <Button 
                 variant={isAudioMuted ? "destructive" : "secondary"} 
                 size="icon" 
                 onClick={toggleMic} 
                 className="rounded-full h-12 w-12"
               >
                 {isAudioMuted ? <MicOff /> : <Mic />}
               </Button>
               <Button 
                 variant={isVideoOff ? "destructive" : "secondary"} 
                 size="icon" 
                 onClick={toggleVideo} 
                 className="rounded-full h-12 w-12"
               >
                 {isVideoOff ? <VideoOff /> : <VideoIcon />}
               </Button>
               <Separator orientation="vertical" className="h-8 mx-2" />
               <Button 
                 variant={isScreenSharing ? "default" : "secondary"} 
                 size="icon" 
                 onClick={toggleScreenShare} 
                 className={cn("rounded-full h-12 w-12", isScreenSharing && "bg-blue-600 text-white hover:bg-blue-700")}
               >
                 {isScreenSharing ? <ScreenShareOff /> : <ScreenShare />}
               </Button>
               <Button 
                 variant={hasHandRaised ? "default" : "secondary"} 
                 size="icon" 
                 onClick={toggleHand} 
                 className={cn("rounded-full h-12 w-12", hasHandRaised && "bg-yellow-400 text-yellow-900 hover:bg-yellow-500")}
               >
                 <Hand />
               </Button>
               <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="secondary" size="icon" className="rounded-full h-12 w-12">
                      <Smile />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-2 grid grid-cols-4 gap-2">
                     {['👍', '👏', '🔥', '❤️', '😮', '🎉', '💡', '💯'].map(emoji => (
                       <Button key={emoji} variant="ghost" className="h-10 w-10 p-0 text-xl">{emoji}</Button>
                     ))}
                  </PopoverContent>
               </Popover>
               <Separator orientation="vertical" className="h-8 mx-2" />
               <Dialog>
                 <DialogTrigger asChild>
                    <Button variant="secondary" size="icon" className="rounded-full h-12 w-12">
                      <BarChart3 />
                    </Button>
                 </DialogTrigger>
                 <DialogContent className="max-w-3xl">
                    <DialogHeader>
                      <DialogTitle>Session Participation Monitor</DialogTitle>
                      <DialogDescription>Track student engagement and cumulative attendance progress.</DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                       <Table>
                          <TableHeader>
                             <TableRow>
                                <TableHead>Student</TableHead>
                                <TableHead>Role</TableHead>
                                <TableHead>Join Time</TableHead>
                                <TableHead className="text-right">Active Time</TableHead>
                                <TableHead className="text-right">Status</TableHead>
                             </TableRow>
                          </TableHeader>
                          <TableBody>
                             {participants?.filter(p => p.role !== 'left').map(p => {
                               const durationSeconds = (p.totalDuration || 0) + (p.activeSegmentStart ? (currentTime - (p.activeSegmentStart.seconds || currentTime)) : 0);
                               const meetingStartTime = meetingData?.createdAt?.seconds || currentTime;
                               const maxPossibleDuration = currentTime - meetingStartTime;
                               const cappedDuration = Math.max(0, Math.min(durationSeconds, maxPossibleDuration));
                               
                               const joinDate = p.joinedAt ? new Date(p.joinedAt.seconds * 1000) : new Date();
                               const isLate = meetingData?.createdAt && p.joinedAt ? (p.joinedAt.seconds - meetingData.createdAt.seconds) > LATE_THRESHOLD_SECONDS : false;
                               
                               const meetingDuration = maxPossibleDuration || 1;
                               const ratio = cappedDuration / meetingDuration;

                               return (
                                 <TableRow key={p.id}>
                                    <TableCell className="font-medium flex items-center gap-2">
                                       {p.name} {p.id === user?.uid && "(You)"}
                                       {isLate && <Badge variant="destructive" className="text-[8px] h-4 py-0">Late</Badge>}
                                    </TableCell>
                                    <TableCell className="capitalize">{p.role}</TableCell>
                                    <TableCell className="text-muted-foreground">{format(joinDate, 'p')}</TableCell>
                                    <TableCell className="text-right font-mono">{formatDuration(cappedDuration)}</TableCell>
                                    <TableCell className="text-right">
                                       <Badge variant={ratio >= 0.7 ? "default" : "secondary"}>
                                          {ratio >= 0.7 ? 'Present' : 'Low Active'}
                                       </Badge>
                                    </TableCell>
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
          <Card className="w-80 flex flex-col overflow-hidden border shadow-lg shrink-0 rounded-3xl">
             <Tabs defaultValue="participants" className="flex-1 flex flex-col overflow-hidden">
                <div className="px-4 pt-4 border-b">
                   <TabsList className="w-full h-12 grid grid-cols-2 rounded-2xl">
                      <TabsTrigger value="participants" className="rounded-xl flex items-center gap-2">
                        <Users className="h-4 w-4" /> Participants
                      </TabsTrigger>
                      <TabsTrigger value="chat" className="rounded-xl flex items-center gap-2">
                        <MessageSquare className="h-4 w-4" /> Chat
                      </TabsTrigger>
                   </TabsList>
                </div>

                <TabsContent value="participants" className="flex-1 flex flex-col overflow-hidden mt-0">
                   <ScrollArea className="flex-1 p-4">
                      <div className="space-y-4">
                        {participants?.map(p => {
                          const isOnline = p.role !== 'left';
                          const isLate = meetingData?.createdAt && p.joinedAt ? (p.joinedAt.seconds - meetingData.createdAt.seconds) > LATE_THRESHOLD_SECONDS : false;
                          
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
                                     {isLate && <Badge variant="destructive" className="text-[8px] h-3 px-1 py-0 shrink-0">Late</Badge>}
                                  </div>
                                  <p className="text-[10px] text-muted-foreground flex items-center gap-2 mt-0.5">
                                     {!isOnline ? <Badge variant="outline" className="text-[8px] h-3 px-1 py-0">Left</Badge> : (
                                       <>
                                         {p.isMuted ? <MicOff className="h-3 w-3 text-red-500" /> : <Mic className="h-3 w-3 text-green-500" />}
                                         {p.isVideoOff ? <VideoOff className="h-3 w-3 text-zinc-400" /> : <VideoIcon className="h-3 w-3 text-primary" />}
                                       </>
                                     )}
                                  </p>
                               </div>
                               {isHost && p.id !== user?.uid && (
                                 <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                                   <MoreVertical className="h-4 w-4" />
                                 </Button>
                               )}
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
                         <p className="text-[10px] text-center text-muted-foreground leading-relaxed">
                            Need 70% participation in <b>Session {meetingData?.sessionIndex || 1}</b> to earn {meetingData?.fixedDurationHours || 1}h.
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
                              <div className={cn(
                                "max-w-[90%] px-3 py-2 rounded-2xl text-xs",
                                msg.senderId === user?.uid ? "bg-primary text-primary-foreground rounded-tr-none" : "bg-muted rounded-tl-none"
                              )}>
                                 {msg.text}
                              </div>
                           </div>
                         ))}
                      </div>
                   </ScrollArea>
                   <div className="p-4 border-t bg-card space-y-2">
                      <div className="relative">
                        <Input 
                          placeholder="Type a message..." 
                          value={chatInput} 
                          onChange={(e) => setChatInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                          className="pr-10 rounded-xl h-12"
                        />
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          onClick={handleSendMessage} 
                          className="absolute right-1 top-1 h-10 w-10 text-primary hover:bg-transparent"
                        >
                          <Send className="h-4 w-4" />
                        </Button>
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
