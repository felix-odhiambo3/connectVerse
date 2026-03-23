
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useCollection, useUser, useFirestore, useMemoFirebase, useDoc } from '@/firebase';
import {
  doc,
  collection,
  serverTimestamp,
  addDoc,
  onSnapshot,
  getDocs,
  writeBatch,
  query,
  orderBy,
  getDoc,
  setDoc,
  updateDoc,
  increment,
  arrayUnion,
} from 'firebase/firestore';
import { format } from 'date-fns';
import AuthGuard from '@/components/auth/AuthGuard';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { useToast } from '@/hooks/use-toast';
import { Mic, MicOff, Video as VideoIcon, VideoOff, ScreenShare, ScreenShareOff, Timer, XCircle, Send, Hand, Lock, Unlock, CircleDot, Share2, Shield, User as UserIcon, Smile, Copy, Check, BarChart3, Clock, Trophy, Frown, AlertCircle, Download, FileText, TrendingUp, BookOpen } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from '@/components/ui/badge';

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
  lastReaction?: string;
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

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isAudioMuted, setIsAudioMuted] = useState(true);
  const [isVideoOff, setIsVideoOff] = useState(true);
  const [elapsedTime, setElapsedTime] = useState('00:00:00');
  const [chatInput, setChatInput] = useState('');
  const [showSummary, setShowSummary] = useState(false);
  const [isProcessingAttendance, setIsProcessingAttendance] = useState(false);

  const meetingRef = useMemoFirebase(() => {
    if (!firestore || !meetingId) return null;
    return doc(firestore, 'meetings', meetingId);
  }, [firestore, meetingId]);

  const { data: meetingData } = useDoc<any>(meetingRef);

  const participantsRef = useMemoFirebase(() => {
    if (!firestore || !meetingId) return null;
    return query(collection(firestore, 'meetings', meetingId, 'participants'), orderBy('joinedAt', 'asc'));
  }, [firestore, meetingId]);

  const { data: participants, isLoading: areParticipantsLoading } = useCollection<Participant>(participantsRef);

  const seriesAttendanceRef = useMemoFirebase(() => {
    if (!firestore || !meetingData?.seriesId || !user) return null;
    return doc(firestore, 'seriesAttendance', meetingData.seriesId, 'users', user.uid);
  }, [firestore, meetingData?.seriesId, user]);

  const { data: myCumulativeStats } = useDoc<CumulativeStats>(seriesAttendanceRef);

  const currentUserParticipant = participants?.find(p => p.id === user?.uid);
  const isHost = user?.uid === meetingData?.hostId;

  // Track session time
  useEffect(() => {
    if (!meetingData?.createdAt || meetingData.status === 'scheduled') return;
    const interval = setInterval(() => {
      const now = Date.now();
      const start = meetingData.createdAt.seconds * 1000;
      const diff = Math.max(0, now - start);
      setElapsedTime(formatDuration(diff / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [meetingData]);

  // Handle meeting end and attendance logic
  const endMeetingForAll = async () => {
    if (!isHost || !meetingRef || !firestore || !participants) return;
    setIsProcessingAttendance(true);

    const totalSessionSeconds = (Date.now() / 1000) - meetingData.createdAt.seconds;
    const batch = writeBatch(firestore);

    // 1. Mark meeting as finished
    batch.update(meetingRef, {
      status: 'finished',
      endedAt: serverTimestamp(),
    });

    // 2. Process attendance for all participants
    for (const p of participants) {
      const currentDuration = (p.totalDuration || 0) + (p.activeSegmentStart ? (Date.now() / 1000 - p.activeSegmentStart.seconds) : 0);
      const participationRatio = currentDuration / totalSessionSeconds;

      if (participationRatio >= ATTENDANCE_THRESHOLD && meetingData.seriesId) {
        // Participant earned credit for this session
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

  // Participant joining logic
  useEffect(() => {
    if (!user || !meetingId || !firestore || !meetingData || meetingData.status === 'scheduled') return;
    const pRef = doc(firestore, 'meetings', meetingId, 'participants', user.uid);
    setDoc(pRef, {
      id: user.uid,
      name: user.displayName || user.email,
      joinedAt: serverTimestamp(),
      activeSegmentStart: serverTimestamp(),
      totalDuration: 0,
      role: user.uid === meetingData.hostId ? 'host' : 'participant',
    }, { merge: true });

    return () => {
      updateDoc(pRef, { role: 'left', activeSegmentStart: null });
    };
  }, [user, meetingId, firestore, meetingData]);

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
            <Button variant="outline" className="flex-1 h-12" onClick={() => window.print()}><Download className="mr-2 h-4 w-4" /> Save Report</Button>
            <Button className="flex-1 h-12" onClick={() => router.push('/dashboard')}>Dashboard</Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <AuthGuard>
      <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
        <header className="flex h-16 items-center justify-between border-b px-6 shrink-0 bg-card">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-lg font-bold">{meetingData?.name || 'Class Session'}</h1>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Session {meetingData?.sessionIndex} of {meetingData?.totalSessionsInSeries}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="bg-muted px-4 py-1.5 rounded-full border text-sm font-mono flex items-center gap-2">
              <Timer className="h-4 w-4 text-primary" /> {elapsedTime}
            </div>
            {isHost && (
              <Button onClick={endMeetingForAll} variant="destructive" disabled={isProcessingAttendance} className="rounded-full">
                {isProcessingAttendance ? 'Ending...' : 'End Session'}
              </Button>
            )}
            {!isHost && <Button onClick={() => router.push('/dashboard')} variant="outline" className="rounded-full">Leave</Button>}
          </div>
        </header>

        <main className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-4 p-4 overflow-hidden">
          <div className="md:col-span-3 bg-muted rounded-2xl relative overflow-hidden flex items-center justify-center border shadow-inner">
             <div className="text-zinc-400 flex flex-col items-center gap-4">
                <VideoIcon className="h-16 w-16 opacity-20" />
                <p className="text-sm font-medium">Camera is Off</p>
             </div>
             
             {/* Local Preview */}
             <div className="absolute bottom-6 right-6 w-48 aspect-video bg-zinc-900 rounded-xl border-2 border-background shadow-2xl overflow-hidden">
                <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs uppercase font-bold tracking-tighter">Preview</div>
             </div>
          </div>

          <div className="flex flex-col gap-4 overflow-hidden">
             <Card className="flex-1 flex flex-col overflow-hidden border shadow-sm">
                <CardHeader className="py-4 border-b bg-zinc-50/50">
                   <CardTitle className="text-sm">Participants ({participants?.length || 0})</CardTitle>
                </CardHeader>
                <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
                   {participants?.map(p => (
                     <div key={p.id} className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                           <AvatarFallback>{p.name[0]}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                           <p className="text-xs font-bold truncate">{p.name}</p>
                           <p className="text-[10px] text-muted-foreground">{p.role === 'host' ? 'Host' : 'Student'}</p>
                        </div>
                     </div>
                   ))}
                </CardContent>
             </Card>
             
             <Card className="h-1/3 bg-primary/5 border-primary/10 shadow-sm">
                <CardHeader className="py-3">
                   <CardTitle className="text-xs flex items-center gap-2"><TrendingUp className="h-3 w-3" /> Cumulative Progress</CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                   <div className="flex justify-between text-[10px] uppercase font-bold text-muted-foreground">
                      <span>Total Earned</span>
                      <span>{myCumulativeStats?.attendedHours || 0}h</span>
                   </div>
                   <div className="h-2 w-full bg-zinc-200 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-primary transition-all" 
                        style={{ width: `${Math.min(100, (myCumulativeStats?.attendedHours || 0) / ((meetingData?.totalSessionsInSeries || 1) * (meetingData?.fixedDurationHours || 0)) * 100)}%` }} 
                      />
                   </div>
                   <p className="text-[10px] text-center text-muted-foreground">Keep participation above 70% per session to earn hours.</p>
                </CardContent>
             </Card>
          </div>
        </main>
      </div>
    </AuthGuard>
  );
}
