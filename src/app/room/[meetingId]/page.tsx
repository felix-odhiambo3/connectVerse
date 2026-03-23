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
  deleteDoc,
  getDoc,
  setDoc,
} from 'firebase/firestore';
import { format } from 'date-fns';
import AuthGuard from '@/components/auth/AuthGuard';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { deleteDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { Mic, MicOff, Video as VideoIcon, VideoOff, ScreenShare, ScreenShareOff, Timer, XCircle, Send, Hand, Lock, Unlock, CircleDot, Share2, Shield, User as UserIcon, Smile } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * AudioVisualizer component that renders moving bars based on a MediaStream.
 */
function AudioVisualizer({ stream, isMuted }: { stream: MediaStream | null; isMuted: boolean }) {
  const [frequencies, setFrequencies] = useState<number[]>(new Array(4).fill(0));
  const animationRef = useRef<number>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!stream || isMuted || stream.getAudioTracks().length === 0) {
      setFrequencies(new Array(4).fill(0));
      return;
    }

    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioContextRef.current = audioContext;
    const analyser = audioContext.createAnalyser();
    analyserRef.current = analyser;
    analyser.fftSize = 32;
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    
    const update = () => {
      if (!analyserRef.current) return;
      analyserRef.current.getByteFrequencyData(dataArray);
      const newFrequencies = [
        dataArray[1],
        dataArray[3],
        dataArray[5],
        dataArray[7],
      ].map(v => (v / 255) * 100);
      setFrequencies(newFrequencies);
      animationRef.current = requestAnimationFrame(update);
    };

    update();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, [stream, isMuted]);

  return (
    <div className="flex items-end gap-0.5 h-4 w-6">
      {frequencies.map((f, i) => (
        <div
          key={i}
          className="w-1 bg-primary rounded-full transition-all duration-75 ease-out"
          style={{ height: `${Math.max(2, f)}%` }}
        />
      ))}
    </div>
  );
}

// Firestore collections
const MEETINGS_COLLECTION = 'meetings';
const PARTICIPANTS_COLLECTION = 'participants';
const WEBRTC_COLLECTION = 'webrtc';
const CHAT_COLLECTION = 'chat';
const OFFER_DOC = 'offer';
const ANSWER_DOC = 'answer';
const CALLER_CANDIDATES_COLLECTION = 'callerCandidates';
const CALLEE_CANDIDATES_COLLECTION = 'calleeCandidates';

// WebRTC configuration
const servers = {
  iceServers: [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
  ],
  iceCandidatePoolSize: 10,
};

interface Participant {
  id: string;
  name: string;
  joinedAt: { seconds: number };
  role: 'host' | 'participant' | 'waiting';
  hasRaisedHand?: boolean;
  isMuted?: boolean;
  lastReaction?: string;
  lastReactionAt?: { seconds: number };
}

interface ParticipantPermissions {
    allowShareScreen: boolean;
    allowSendReactions: boolean;
    allowUnmute: boolean;
    allowStartVideo: boolean;
}

interface FloatingReaction {
  id: string;
  emoji: string;
  senderName: string;
  left: number;
}

const REACTION_EMOJIS = ['❤️', '👍', '🎉', '😮', '😢', '🔥', '👏', '💯'];

function RoomPage() {
  const params = useParams();
  const meetingId = params.meetingId as string;
  const { user } = useUser();
  const firestore = useFirestore();
  const router = useRouter();
  const { toast } = useToast();

  const [hasCameraPermission, setHasCameraPermission] = useState(true);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isAudioMuted, setIsAudioMuted] = useState(true);
  const [isVideoOff, setIsVideoOff] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [elapsedTime, setElapsedTime] = useState('00:00:00');
  const [chatInput, setChatInput] = useState('');
  const [hasSeenSelfInList, setHasSeenSelfInList] = useState(false);
  const [openHostControls, setOpenHostControls] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const candidateQueueRef = useRef<RTCIceCandidate[]>([]);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasInitiatedJoin = useRef(false);
  const playedReactionsRef = useRef<Record<string, number>>({});

  const meetingRef = useMemoFirebase(() => {
    if (!firestore || !meetingId) return null;
    return doc(firestore, MEETINGS_COLLECTION, meetingId);
  }, [firestore, meetingId]);

  const { data: meetingData } = useDoc<{ 
    hostId: string; 
    createdAt: { seconds: number; }; 
    status: string;
    isLocked?: boolean;
    isRecording?: boolean;
    name?: string;
    scheduledAt?: { seconds: number };
    geminiNotesEnabled?: boolean;
    participantPermissions?: ParticipantPermissions;
  }>(meetingRef);

  const participantsRef = useMemoFirebase(() => {
    if (!firestore || !meetingId) return null;
    return query(collection(firestore, MEETINGS_COLLECTION, meetingId, PARTICIPANTS_COLLECTION), orderBy('joinedAt', 'asc'));
  }, [firestore, meetingId]);

  const { data: participants, isLoading: areParticipantsLoading } = useCollection<Omit<Participant, 'id'>>(participantsRef);

  const chatRef = useMemoFirebase(() => {
    if (!firestore || !meetingId) return null;
    return query(collection(firestore, MEETINGS_COLLECTION, meetingId, CHAT_COLLECTION), orderBy('createdAt', 'asc'));
  }, [firestore, meetingId]);

  const { data: chatMessages } = useCollection<{ text: string, senderId: string, senderName: string, createdAt: { seconds: number } }>(chatRef);
  
  const isHost = user?.uid === meetingData?.hostId;
  const activeParticipants = participants?.filter(p => p.role === 'host' || p.role === 'participant');
  const waitingList = participants?.filter(p => p.role === 'waiting');
  const currentUserParticipant = participants?.find(p => p.id === user?.uid);
  const isUserInWaitingRoom = currentUserParticipant?.role === 'waiting';

  const isCurrentUserInCall = useMemo(() => {
    if (!user || !activeParticipants) return false;
    const index = activeParticipants.findIndex(p => p.id === user.uid);
    return index >= 0 && index <= 1;
  }, [user, activeParticipants]);

  const activeParticipantIds = useMemo(
    () => activeParticipants?.map(p => p.id).join(','),
    [activeParticipants]
  );

  const isReactionRecent = (reactionAt?: { seconds: number }) => {
    if (!reactionAt) return false;
    const now = Math.floor(Date.now() / 1000);
    return now - reactionAt.seconds < 5;
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  useEffect(scrollToBottom, [chatMessages]);

  const handleSendMessage = async () => {
    if (!user || !chatInput.trim() || !firestore || !meetingId) return;

    const chatCollection = collection(firestore, MEETINGS_COLLECTION, meetingId, CHAT_COLLECTION);
    addDoc(chatCollection, {
        text: chatInput.trim(),
        senderId: user.uid,
        senderName: user.displayName || user.email,
        createdAt: serverTimestamp(),
    });
    setChatInput('');
  };

  // Watch for new reactions to trigger floating animation
  useEffect(() => {
    if (!participants) return;
    
    participants.forEach(p => {
      if (p.lastReaction && p.lastReactionAt) {
        const lastPlayed = playedReactionsRef.current[p.id] || 0;
        if (p.lastReactionAt.seconds > lastPlayed && isReactionRecent(p.lastReactionAt)) {
          const id = Math.random().toString(36).substr(2, 9);
          const left = Math.random() * 80 + 10; // 10% to 90% from left
          
          setFloatingReactions(prev => [...prev, { id, emoji: p.lastReaction!, senderName: p.name, left }]);
          playedReactionsRef.current[p.id] = p.lastReactionAt.seconds;
          
          setTimeout(() => {
            setFloatingReactions(prev => prev.filter(r => r.id !== id));
          }, 4000);
        }
      }
    });
  }, [participants]);

  useEffect(() => {
    if (!meetingData?.createdAt || meetingData.status === 'scheduled') {
        setElapsedTime('00:00:00');
        return;
    };
    
    const startTime = meetingData.createdAt.seconds * 1000;
    const intervalId = setInterval(() => {
      const now = Date.now();
      const difference = now - startTime;
      
      const hours = String(Math.floor(difference / 3600000)).padStart(2, '0');
      const minutes = String(Math.floor((difference % 3600000) / 60000)).padStart(2, '0');
      const seconds = String(Math.floor((difference % 60000) / 1000)).padStart(2, '0');
      
      setElapsedTime(`${hours}:${minutes}:${seconds}`);
    }, 1000);
    
    return () => clearInterval(intervalId);
  }, [meetingData?.createdAt, meetingData?.status]);

  const cleanupLocalMedia = () => {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        setLocalStream(null);
    }
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        setScreenStream(null);
    }
  }

  const cleanupPeerConnection = () => {
    if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
    }
    setRemoteStream(null);
    candidateQueueRef.current = [];
  };
  
  useEffect(() => {
      if (meetingData?.status === 'finished') {
          toast({
              title: "Meeting Ended",
              description: "The host has ended the meeting for all participants.",
          });
          
          if (isHost) {
            const webrtcRef = collection(firestore, MEETINGS_COLLECTION, meetingId, WEBRTC_COLLECTION);
            getDocs(webrtcRef).then(snapshot => {
                const batch = writeBatch(firestore);
                snapshot.forEach(doc => batch.delete(doc.ref));
                return batch.commit();
            });
          }
          router.push('/dashboard');
      }
  }, [meetingData?.status, router, toast, firestore, meetingId, isHost]);

  useEffect(() => {
    if (meetingData?.status === 'scheduled') return;
    let isCancelled = false;
    const getCameraPermission = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (!isCancelled) {
          stream.getAudioTracks().forEach(track => track.enabled = !isAudioMuted);
          stream.getVideoTracks().forEach(track => track.enabled = !isVideoOff);
          
          setLocalStream(stream);
          setHasCameraPermission(true);
        } else {
          stream.getTracks().forEach(track => track.stop());
        }
      } catch (error: any) {
        if (isCancelled) return;
        setHasCameraPermission(false);
      }
    };
    getCameraPermission();
    
    return () => {
      isCancelled = true;
      cleanupLocalMedia();
      cleanupPeerConnection();
    };
  }, [meetingData?.status]);
  
  useEffect(() => {
    if (localVideoRef.current) {
      if (isScreenSharing && screenStream) {
        localVideoRef.current.srcObject = screenStream;
      } else if (localStream) {
        localVideoRef.current.srcObject = localStream;
        cameraTrackRef.current = localStream.getVideoTracks()[0];
      }
    }
  }, [localStream, screenStream, isScreenSharing]);

  useEffect(() => {
    if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);


  useEffect(() => {
    if (!user || !meetingId || !firestore || !meetingData || meetingData.status === 'scheduled') return;

    if (hasInitiatedJoin.current) return;
    hasInitiatedJoin.current = true;

    const participantRef = doc(firestore, MEETINGS_COLLECTION, meetingId, PARTICIPANTS_COLLECTION, user.uid);

    const setupParticipant = async () => {
        const docSnap = await getDoc(participantRef);
        
        if (!docSnap.exists()) {
            let role: 'host' | 'participant' | 'waiting';
            if (user.uid === meetingData.hostId) {
                role = 'host';
            } else {
                role = meetingData.isLocked ? 'waiting' : 'participant';
            }
            
            const initialData = {
                name: user.displayName || user.email,
                joinedAt: serverTimestamp(),
                role: role,
                hasRaisedHand: false,
                isMuted: false,
            };
            await setDoc(participantRef, initialData);
        }
    };

    setupParticipant();
}, [user, meetingId, firestore, meetingData]);

    useEffect(() => {
        if (user && participants?.some(p => p.id === user.uid)) {
            setHasSeenSelfInList(true);
        }
    }, [participants, user]);

    useEffect(() => {
        if (!user || areParticipantsLoading || meetingData?.status === 'scheduled' || !participants) return;

        if (hasSeenSelfInList) {
            const isCurrentlyInList = participants.some(p => p.id === user.uid);
            if (!isCurrentlyInList) {
                toast({
                    title: "You were removed from the meeting.",
                    description: "Redirecting to the dashboard.",
                });
                router.push('/dashboard');
            }
        }
    }, [participants, user, router, toast, hasSeenSelfInList, areParticipantsLoading, meetingData?.status]);

    useEffect(() => {
        if (!meetingData || !participants || !user || !meetingRef) return;

        const hostIsPresent = participants.some(p => p.id === meetingData.hostId);
        const activeParticipantsList = participants?.filter(p => p.role === 'host' || p.role === 'participant');

        if (!hostIsPresent && activeParticipantsList.length > 0) {
            const newHost = activeParticipantsList[0];
            if (newHost.id === user.uid) {
                updateDocumentNonBlocking(meetingRef, { hostId: newHost.id });
                toast({ title: 'You are now the host!' });
            }
        }
    }, [participants, meetingData, user, firestore, meetingRef, toast]);


  useEffect(() => {
    const activeParticipantsInEffect = participants?.filter(p => p.role === 'host' || p.role === 'participant');

    const cleanupWebRTCSignaling = async () => {
      if (!firestore || !meetingId) return;
      try {
        const webrtcRef = collection(firestore, MEETINGS_COLLECTION, meetingId, WEBRTC_COLLECTION);
        const offerDocRef = doc(webrtcRef, OFFER_DOC);
        const answerDocRef = doc(webrtcRef, ANSWER_DOC);
        
        const callerCandidatesQuery = collection(offerDocRef, CALLER_CANDIDATES_COLLECTION);
        const calleeCandidatesQuery = collection(answerDocRef, CALLEE_CANDIDATES_COLLECTION);
  
        const [callerCandidatesSnapshot, calleeCandidatesSnapshot] = await Promise.all([
          getDocs(callerCandidatesQuery),
          getDocs(calleeCandidatesQuery)
        ]);
        
        const batch = writeBatch(firestore);
        callerCandidatesSnapshot.forEach(doc => batch.delete(doc.ref));
        calleeCandidatesSnapshot.forEach(doc => batch.delete(doc.ref));
        batch.delete(offerDocRef);
        batch.delete(answerDocRef);
        await batch.commit();
      } catch (error) {
        console.log("WebRTC signaling cleanup skipped:", error);
      }
    };


    if (!localStream || !user || !activeParticipantsInEffect || activeParticipantsInEffect.length < 2 || isUserInWaitingRoom) {
      if (peerConnectionRef.current) {
        cleanupPeerConnection();
        if (activeParticipantsInEffect && activeParticipantsInEffect.length > 0 && activeParticipantsInEffect[0].id === user.uid) {
            cleanupWebRTCSignaling();
        }
      }
      return;
    }

    if (!peerConnectionRef.current) {
        const pc = new RTCPeerConnection(servers);
        peerConnectionRef.current = pc;
        candidateQueueRef.current = [];

        pc.ontrack = (event) => {
          setRemoteStream(event.streams[0]);
        };
        
        localStream.getTracks().forEach(track => {
            const trackToUse = (track.kind === 'video' && isScreenSharing && screenStream)
                ? screenStream.getVideoTracks()[0]
                : track;
            pc.addTrack(trackToUse, localStream);
        });
    }

    const pc = peerConnectionRef.current;
    if (!firestore || !meetingId) return;
    const webrtcRef = collection(firestore, MEETINGS_COLLECTION, meetingId, WEBRTC_COLLECTION);

    const isCaller = activeParticipantsInEffect[0].id === user.uid;
    const isCallee = activeParticipantsInEffect.length >= 2 && activeParticipantsInEffect[1].id === user.uid;

    if (isCaller) {
        const offerDescriptionRef = doc(webrtcRef, OFFER_DOC);
        const answerDescriptionRef = doc(webrtcRef, ANSWER_DOC);
        const callerCandidatesCollection = collection(offerDescriptionRef, CALLER_CANDIDATES_COLLECTION);
        const calleeCandidatesCollection = collection(answerDescriptionRef, CALLEE_CANDIDATES_COLLECTION);

        pc.onicecandidate = (event) => {
            event.candidate && addDoc(callerCandidatesCollection, event.candidate.toJSON());
        };

        if (pc.signalingState === 'stable') {
          pc.createOffer().then(async (offer) => {
              try {
                await pc.setLocalDescription(offer);
                await setDoc(offerDescriptionRef, { sdp: offer.sdp, type: offer.type });
              } catch (e) {
                console.error("Offer creation failed:", e);
              }
          });
        }
        
        const unsubAnswer = onSnapshot(answerDescriptionRef, async (snapshot) => {
            if (snapshot.exists() && pc.signalingState === 'have-local-offer') {
                const answerDescription = new RTCSessionDescription(snapshot.data());
                try {
                  await pc.setRemoteDescription(answerDescription);
                  candidateQueueRef.current.forEach(candidate => pc.addIceCandidate(candidate));
                  candidateQueueRef.current = [];
                } catch(e) {
                  console.error("Answer application failed:", e);
                }
            }
        });

        const unsubCalleeCandidates = onSnapshot(calleeCandidatesCollection, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'added') {
                    const candidate = new RTCIceCandidate(change.doc.data());
                    if (pc.currentRemoteDescription) {
                        pc.addIceCandidate(candidate);
                    } else {
                        candidateQueueRef.current.push(candidate);
                    }
                }
            });
        });

        return () => {
            unsubAnswer();
            unsubCalleeCandidates();
        }
    }

    if (isCallee) {
       const offerDescriptionRef = doc(webrtcRef, OFFER_DOC);
       const answerDescriptionRef = doc(webrtcRef, ANSWER_DOC);
       const callerCandidatesCollection = collection(offerDescriptionRef, CALLER_CANDIDATES_COLLECTION);
       const calleeCandidatesCollection = collection(answerDescriptionRef, CALLEE_CANDIDATES_COLLECTION);

        pc.onicecandidate = (event) => {
            event.candidate && addDoc(calleeCandidatesCollection, event.candidate.toJSON());
        };

       const unsubOffer = onSnapshot(offerDescriptionRef, async (snapshot) => {
           if (snapshot.exists() && !pc.currentRemoteDescription) {
               const offerDescription = new RTCSessionDescription(snapshot.data());
               try {
                   await pc.setRemoteDescription(offerDescription);
                   candidateQueueRef.current.forEach(candidate => pc.addIceCandidate(candidate));
                   candidateQueueRef.current = [];

                   if (!pc.currentLocalDescription) {
                       const answer = await pc.createAnswer();
                       await pc.setLocalDescription(answer);
                       await setDoc(answerDescriptionRef, { sdp: answer.sdp, type: answer.type });
                   }
               } catch (e) {
                   console.error("Offer processing failed:", e);
               }
           }
       });

       const unsubCallerCandidates = onSnapshot(callerCandidatesCollection, (snapshot) => {
           snapshot.docChanges().forEach((change) => {
               if (change.type === 'added') {
                   const candidate = new RTCIceCandidate(change.doc.data());
                    if (pc.currentRemoteDescription) {
                       pc.addIceCandidate(candidate);
                   } else {
                       candidateQueueRef.current.push(candidate);
                   }
               }
           });
       });
       
       return () => {
           unsubOffer();
           unsubCallerCandidates();
       }
    }

  }, [localStream, meetingId, firestore, user, activeParticipantIds, isUserInWaitingRoom, participants, isScreenSharing, screenStream]);
  
    useEffect(() => {
        if (localStream) {
            const selfMuted = isAudioMuted;
            const hostMuted = currentUserParticipant?.isMuted ?? false;
            localStream.getAudioTracks().forEach(track => {
                track.enabled = !selfMuted && !hostMuted;
            });
        }
    }, [isAudioMuted, currentUserParticipant?.isMuted, localStream]);

    useEffect(() => {
        if (localStream) {
            localStream.getVideoTracks().forEach(track => {
                track.enabled = !isVideoOff;
            });
        }
    }, [isVideoOff, localStream]);

    const toggleAudio = () => {
        if (!isHost && !(meetingData?.participantPermissions?.allowUnmute ?? true) && (isAudioMuted || !!currentUserParticipant?.isMuted)) {
            toast({ title: "The host has disabled microphones for participants." });
            return;
        }
        setIsAudioMuted(prev => !prev);
    };

  const toggleVideo = () => {
      if (!isHost && !(meetingData?.participantPermissions?.allowStartVideo ?? true) && isVideoOff) {
          toast({ title: "The host has disabled video for participants." });
          return;
      }
      setIsVideoOff(prev => !prev);
  };

  const toggleScreenShare = async () => {
    if (!isHost && !(meetingData?.participantPermissions?.allowShareScreen ?? true)) {
        toast({ title: "The host has disabled screen sharing for participants." });
        return;
    }

    if (isScreenSharing) {
        if (screenStream) {
            screenStream.getTracks().forEach(track => track.stop());
            setScreenStream(null);
        }
        
        if (peerConnectionRef.current && cameraTrackRef.current) {
            const videoSender = peerConnectionRef.current.getSenders().find(s => s.track?.kind === 'video');
            if (videoSender) {
                await videoSender.replaceTrack(cameraTrackRef.current);
            }
        }
        setIsScreenSharing(false);
    } else {
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const screenTrack = stream.getVideoTracks()[0];
            
            setScreenStream(stream);
            setIsScreenSharing(true);

            if (peerConnectionRef.current) {
                const videoSender = peerConnectionRef.current.getSenders().find(s => s.track?.kind === 'video');
                if (videoSender) {
                    await videoSender.replaceTrack(screenTrack);
                }
            }

            screenTrack.onended = () => {
                if (peerConnectionRef.current && cameraTrackRef.current) {
                    const videoSender = peerConnectionRef.current.getSenders().find(s => s.track?.kind === 'video');
                    if (videoSender) {
                        videoSender.replaceTrack(cameraTrackRef.current).catch(console.error);
                    }
                }
                setScreenStream(null);
                setIsScreenSharing(false);
            };
        } catch (error: any) {
            console.error("Screen share error:", error);
            setIsScreenSharing(false);
        }
    }
  };

  const leaveMeeting = () => {
    if (user && meetingId && firestore) {
      const participantRef = doc(firestore, MEETINGS_COLLECTION, meetingId, PARTICIPANTS_COLLECTION, user.uid);
      deleteDocumentNonBlocking(participantRef);
    }
    router.push('/dashboard');
  };

  const endMeetingForAll = () => {
    if (isHost && meetingRef) {
      updateDocumentNonBlocking(meetingRef, { status: 'finished' });
    }
  };
  
  const admitParticipant = (participantId: string) => {
    if (!isHost || !firestore || !meetingId) return;
    const participantRef = doc(firestore, MEETINGS_COLLECTION, meetingId, PARTICIPANTS_COLLECTION, participantId);
    updateDocumentNonBlocking(participantRef, { role: 'participant' });
  };

  const toggleRaiseHand = () => {
      if (!user || !firestore || !meetingId || !currentUserParticipant) return;
      if (!isHost && !(meetingData?.participantPermissions?.allowSendReactions ?? true)) {
          toast({ title: "The host has disabled reactions." });
          return;
      }
      const participantRef = doc(firestore, MEETINGS_COLLECTION, meetingId, PARTICIPANTS_COLLECTION, user.uid);
      updateDocumentNonBlocking(participantRef, { hasRaisedHand: !currentUserParticipant.hasRaisedHand });
  };

  const handleSendReaction = (emoji: string) => {
    if (!user || !firestore || !meetingId) return;
    if (!isHost && !(meetingData?.participantPermissions?.allowSendReactions ?? true)) {
        toast({ title: "The host has disabled reactions." });
        return;
    }
    const participantRef = doc(firestore, MEETINGS_COLLECTION, meetingId, PARTICIPANTS_COLLECTION, user.uid);
    updateDocumentNonBlocking(participantRef, { 
        lastReaction: emoji, 
        lastReactionAt: serverTimestamp() 
    });
    setShowEmojiPicker(false);
  };
  
  const lowerHand = (participantId: string) => {
      if (!isHost || !firestore || !meetingId) return;
      const participantRef = doc(firestore, MEETINGS_COLLECTION, meetingId, PARTICIPANTS_COLLECTION, participantId);
      updateDocumentNonBlocking(participantRef, { hasRaisedHand: false });
  };
  
  const toggleLockMeeting = () => {
      if (!isHost || !meetingRef) return;
      updateDocumentNonBlocking(meetingRef, { isLocked: !meetingData?.isLocked });
  };

    const removeParticipant = (participantId: string) => {
        if (!isHost || !firestore || !meetingId) return;
        const participantRef = doc(firestore, MEETINGS_COLLECTION, meetingId, PARTICIPANTS_COLLECTION, participantId);
        deleteDocumentNonBlocking(participantRef);
        toast({ title: "Participant removed." });
    };

    const toggleParticipantMute = (participantId: string, currentState: boolean) => {
        if (!isHost || !firestore || !meetingId) return;
        const participantRef = doc(firestore, MEETINGS_COLLECTION, meetingId, PARTICIPANTS_COLLECTION, participantId);
        updateDocumentNonBlocking(participantRef, { isMuted: !currentState });
    };

    const handleShare = async () => {
        const shareUrl = window.location.href;
        const shareText = "Join my ConnectVerse meeting!";
        try {
            if (navigator.share) {
                await navigator.share({
                    title: 'ConnectVerse Meeting',
                    text: shareText,
                    url: shareUrl,
                });
            } else {
                await navigator.clipboard.writeText(shareUrl);
                toast({ title: 'Link copied to clipboard!' });
            }
        } catch (error: any) {
            if (error.name !== 'AbortError' && error.name !== 'NotAllowedError') {
                 try {
                    await navigator.clipboard.writeText(shareUrl);
                    toast({ title: 'Link copied to clipboard!' });
                } catch (copyError) {
                    toast({ variant: 'destructive', title: 'Failed to share' });
                }
            }
        }
    };

    const startMeeting = () => {
        if (!isHost || !meetingRef) return;
        updateDocumentNonBlocking(meetingRef, { status: 'pending' });
        toast({ title: 'Meeting started!' });
    };
    
    const handlePermissionChange = (key: keyof ParticipantPermissions, value: boolean) => {
        if (!isHost || !meetingRef) return;
        const updatePayload = {
            [`participantPermissions.${key}`]: value
        };
        updateDocumentNonBlocking(meetingRef, updatePayload);
    };

    const handleFeatureChange = (key: 'geminiNotesEnabled' | 'isRecording', value: boolean) => {
        if (!isHost || !meetingRef) return;
        const updatePayload = { [key]: value };
        updateDocumentNonBlocking(meetingRef, updatePayload);
    }

  const isLoading = areParticipantsLoading || !meetingData;

  if (isLoading && !isUserInWaitingRoom) {
    return (
      <AuthGuard>
        <div className="p-4 md:p-8">
          <Skeleton className="h-8 w-1/4 mb-4" />
          <Skeleton className="h-96 w-full" />
        </div>
      </AuthGuard>
    );
  }

  if (meetingData?.status === 'scheduled') {
    return (
        <AuthGuard>
            <div className="flex h-screen w-full flex-col items-center justify-center bg-background p-4">
                <Card className="max-w-md text-center">
                    <CardHeader>
                        <CardTitle>{meetingData.name || 'Scheduled Meeting'}</CardTitle>
                        <CardDescription>This meeting is scheduled to start on</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <p className="text-2xl font-bold">
                            {meetingData.scheduledAt ? format(new Date(meetingData.scheduledAt.seconds * 1000), 'PPP p') : '...'}
                        </p>
                    </CardContent>
                    <CardFooter className="flex-col gap-4">
                        {isHost ? (
                             <Button onClick={startMeeting}>Start Meeting Now</Button>
                        ) : (
                            <p className="text-sm text-muted-foreground">Please wait for the host to start the meeting.</p>
                        )}
                        <Button variant="outline" onClick={() => router.push('/dashboard')}>Go to Dashboard</Button>
                    </CardFooter>
                </Card>
            </div>
      </AuthGuard>
    )
  }

  if (isUserInWaitingRoom) {
    return (
      <AuthGuard>
        <div className="flex h-screen w-full flex-col items-center justify-center bg-background p-4">
            <Card className="max-sm">
                <CardHeader>
                    <CardTitle>Waiting Room</CardTitle>
                    <CardDescription>The meeting is locked by the host. Please wait to be admitted.</CardDescription>
                </CardHeader>
                <CardFooter>
                    <Button variant="outline" onClick={() => router.push('/dashboard')}>Leave</Button>
                </CardFooter>
            </Card>
        </div>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <div className="flex h-screen w-full relative overflow-hidden">
        {/* Floating Reactions Overlay */}
        <div className="absolute inset-0 pointer-events-none z-50">
          {floatingReactions.map((reaction) => (
            <div
              key={reaction.id}
              className="absolute bottom-0 flex flex-col items-center animate-float-up"
              style={{ left: `${reaction.left}%` }}
            >
              <span className="text-4xl md:text-6xl">{reaction.emoji}</span>
              <span className="text-[10px] md:text-xs bg-black/50 text-white px-2 py-0.5 rounded-full mt-1">
                {reaction.senderName}
              </span>
            </div>
          ))}
        </div>

        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="flex h-16 items-center justify-between border-b bg-background px-6 shrink-0">
            <div className="flex items-center gap-4">
                <h1 className="text-xl font-semibold">{meetingData?.name || 'Meeting Room'}</h1>
                {meetingData?.isRecording && (
                    <div className="flex items-center gap-2 text-sm text-red-500">
                        <CircleDot className="h-4 w-4 animate-pulse" />
                        <span>Recording</span>
                    </div>
                )}
            </div>
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Timer className="h-4 w-4" />
                    <span>{elapsedTime}</span>
                </div>
                <Button variant="outline" size="icon" onClick={handleShare}>
                    <Share2 className="h-4 w-4" />
                    <span className="sr-only">Share Meeting</span>
                </Button>
            </div>
          </header>
          <main className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 p-4 min-h-0">
            <div className="md:col-span-2 bg-muted rounded-lg flex flex-col p-4 gap-4 min-h-0">
              <div className="flex-1 w-full relative bg-black rounded-md flex items-center justify-center overflow-hidden min-h-0">
                 <video ref={remoteVideoRef} className="w-full h-full object-contain" autoPlay playsInline />
                 {/* Local Video Preview */}
                 <div className="absolute bottom-4 right-4 w-1/4 max-w-[200px] aspect-video rounded-md border-2 border-background overflow-hidden shadow-lg bg-zinc-900 z-10">
                    <video ref={localVideoRef} className={cn("w-full h-full object-cover", (isVideoOff && !isScreenSharing) && "hidden")} autoPlay muted playsInline />
                    {(isVideoOff && !isScreenSharing) && (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-800 text-zinc-400 gap-2">
                             <Avatar className="h-10 w-10 border border-zinc-700">
                                <AvatarFallback className="bg-zinc-700">
                                    <UserIcon className="h-6 w-6" />
                                </AvatarFallback>
                             </Avatar>
                             <span className="text-[10px] font-medium uppercase tracking-wider">Camera Off</span>
                        </div>
                    )}
                 </div>
                 {!remoteStream && isCurrentUserInCall && activeParticipants && activeParticipants.length > 1 && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                        <p className="text-white">Connecting...</p>
                    </div>
                 )}
              </div>
               {!hasCameraPermission && (
                  <Alert variant="destructive" className="shrink-0">
                    <AlertTitle>Camera Access Required</AlertTitle>
                    <AlertDescription>
                      Please allow camera access. Video feeds cannot be established.
                    </AlertDescription>
                  </Alert>
                )}
                 {activeParticipants && activeParticipants.length < 2 && !isLoading && (
                    <Alert className="shrink-0">
                        <AlertTitle>Waiting for others</AlertTitle>
                        <AlertDescription>
                        You are the only one here. The call will start when someone else joins.
                        </AlertDescription>
                    </Alert>
                )}
                {/* Control Bar */}
                <div className="flex items-center justify-center gap-2 flex-wrap shrink-0">
                    <Button 
                        onClick={toggleAudio} 
                        variant={(isAudioMuted || !!currentUserParticipant?.isMuted) ? "secondary" : "outline"} 
                        size="icon" 
                        className="rounded-full h-12 w-12" 
                        disabled={!hasCameraPermission || (!isHost && !(meetingData?.participantPermissions?.allowUnmute ?? true) && (isAudioMuted || !!currentUserParticipant?.isMuted))}
                    >
                      {(isAudioMuted || !!currentUserParticipant?.isMuted) ? <MicOff /> : <Mic />}
                      <span className="sr-only">Toggle Mic</span>
                    </Button>
                     <Button 
                        onClick={toggleVideo} 
                        variant={isVideoOff ? "secondary" : "outline"} 
                        size="icon" 
                        className="rounded-full h-12 w-12" 
                        disabled={!hasCameraPermission || (!isHost && !(meetingData?.participantPermissions?.allowStartVideo ?? true) && isVideoOff)}
                    >
                      {isVideoOff ? <VideoOff /> : <VideoIcon />}
                      <span className="sr-only">Toggle Video</span>
                    </Button>
                    <Button 
                        onClick={toggleScreenShare} 
                        variant={isScreenSharing ? "secondary" : "outline"} 
                        size="icon" 
                        className="rounded-full h-12 w-12" 
                        disabled={!hasCameraPermission || (!isHost && !(meetingData?.participantPermissions?.allowShareScreen ?? true))}
                    >
                      {isScreenSharing ? <ScreenShareOff /> : <ScreenShare />}
                      <span className="sr-only">Toggle Screen Share</span>
                    </Button>
                    <Button 
                        onClick={toggleRaiseHand} 
                        variant={currentUserParticipant?.hasRaisedHand ? "secondary" : "outline"} 
                        size="icon" 
                        className="rounded-full h-12 w-12"
                        disabled={!isHost && !(meetingData?.participantPermissions?.allowSendReactions ?? true)}
                    >
                        <Hand />
                        <span className="sr-only">Raise Hand</span>
                    </Button>
                    
                    <Popover open={showEmojiPicker} onOpenChange={setShowEmojiPicker}>
                        <PopoverTrigger asChild>
                            <Button 
                                variant="outline" 
                                size="icon" 
                                className="rounded-full h-12 w-12"
                                disabled={!isHost && !(meetingData?.participantPermissions?.allowSendReactions ?? true)}
                            >
                                <Smile />
                                <span className="sr-only">Reactions</span>
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-2" align="center" side="top">
                            <div className="flex gap-2">
                                {REACTION_EMOJIS.map((emoji) => (
                                    <Button 
                                        key={emoji} 
                                        variant="ghost" 
                                        className="h-10 w-10 text-xl p-0 hover:bg-accent rounded-full"
                                        onClick={() => handleSendReaction(emoji)}
                                    >
                                        {emoji}
                                    </Button>
                                ))}
                            </div>
                        </PopoverContent>
                    </Popover>

                    {isHost && (
                        <Button onClick={toggleLockMeeting} variant={meetingData?.isLocked ? "secondary" : "outline"} size="icon" className="rounded-full h-12 w-12">
                            {meetingData?.isLocked ? <Unlock /> : <Lock />}
                            <span className="sr-only">Toggle Lock</span>
                        </Button>
                    )}
                    {isHost && (
                        <Dialog open={openHostControls} onOpenChange={setOpenHostControls}>
                            <DialogTrigger asChild>
                                <Button variant="outline" size="icon" className="rounded-full h-12 w-12">
                                    <Shield />
                                    <span className="sr-only">Host Controls</span>
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Host Controls</DialogTitle>
                                    <DialogDescription>Manage features and participant permissions.</DialogDescription>
                                </DialogHeader>
                                <div className="space-y-6 py-2">
                                    <div>
                                        <h3 className="text-lg font-medium mb-4">Features</h3>
                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between">
                                                <Label htmlFor="recording-switch">Recording</Label>
                                                <Switch id="recording-switch" checked={meetingData?.isRecording ?? false} onCheckedChange={(checked) => handleFeatureChange('isRecording', checked)} />
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <Label htmlFor="gemini-switch">Gemini Notes (Beta)</Label>
                                                <Switch id="gemini-switch" checked={meetingData?.geminiNotesEnabled ?? false} onCheckedChange={(checked) => handleFeatureChange('geminiNotesEnabled', checked)} />
                                            </div>
                                        </div>
                                    </div>
                                    <Separator />
                                    <div>
                                        <h3 className="text-lg font-medium mb-4">Permissions</h3>
                                        <div className="space-y-4">
                                             <div className="flex items-center justify-between">
                                                <Label htmlFor="share-screen-switch">Share screen</Label>
                                                <Switch id="share-screen-switch" checked={meetingData?.participantPermissions?.allowShareScreen ?? true} onCheckedChange={(checked) => handlePermissionChange('allowShareScreen', checked)} />
                                            </div>
                                             <div className="flex items-center justify-between">
                                                <Label htmlFor="send-reactions-switch">Send reactions</Label>
                                                <Switch id="send-reactions-switch" checked={meetingData?.participantPermissions?.allowSendReactions ?? true} onCheckedChange={(checked) => handlePermissionChange('allowSendReactions', checked)} />
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <Label htmlFor="unmute-switch">Microphone</Label>
                                                <Switch id="unmute-switch" checked={meetingData?.participantPermissions?.allowUnmute ?? true} onCheckedChange={(checked) => handlePermissionChange('allowUnmute', checked)} />
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <Label htmlFor="start-video-switch">Video</Label>
                                                <Switch id="start-video-switch" checked={meetingData?.participantPermissions?.allowStartVideo ?? true} onCheckedChange={(checked) => handlePermissionChange('allowStartVideo', checked)} />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </DialogContent>
                        </Dialog>
                    )}
                    <Button onClick={leaveMeeting} variant="destructive" className="rounded-full h-12 px-6">
                      Leave
                    </Button>
                    {isHost && (
                      <Button onClick={endMeetingForAll} variant="destructive" className="rounded-full h-12 px-6 gap-2">
                        <XCircle className="h-4 w-4" /> End for All
                      </Button>
                    )}
                  </div>
            </div>
            {/* Sidebar with Participants and Chat */}
            <div className="flex flex-col gap-4 min-h-0">
              {isHost && waitingList && waitingList.length > 0 && (
                <Card className="shrink-0">
                    <CardHeader className="py-3">
                        <CardTitle className="text-lg">Waiting Room ({waitingList.length})</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 py-0 pb-3 max-h-[150px] overflow-y-auto">
                        {waitingList.map((p) => (
                            <div key={p.id} className="flex items-center justify-between text-sm">
                                <span className="truncate mr-2">{p.name}</span>
                                <Button size="sm" className="h-7 px-2" onClick={() => admitParticipant(p.id)}>Admit</Button>
                            </div>
                        ))}
                    </CardContent>
                </Card>
              )}
              <Card className="flex flex-col max-h-[40%] shrink-0">
                <CardHeader className="py-3">
                  <CardTitle className="text-lg">Participants ({activeParticipants?.length || 0})</CardTitle>
                </CardHeader>
                <CardContent className="flex-1 space-y-4 overflow-y-auto pt-0">
                  {activeParticipants?.map((p) => (
                    <div key={p.id} className="flex items-center gap-3">
                      <Avatar className="h-8 w-8 relative">
                        <AvatarImage src={`https://avatar.vercel.sh/${p.id}.png`} />
                        <AvatarFallback>{p.name?.[0].toUpperCase()}</AvatarFallback>
                        <div className="absolute -bottom-1 -right-1 bg-background rounded-full p-0.5 border">
                           <AudioVisualizer 
                             stream={p.id === user?.uid ? localStream : (activeParticipants.findIndex(ap => ap.id === p.id) === 1 ? remoteStream : null)} 
                             isMuted={!!p.isMuted || (p.id === user?.uid && isAudioMuted)} 
                           />
                        </div>
                      </Avatar>
                      <div className="flex-1 flex items-center gap-2 min-w-0">
                        <p className="font-medium text-sm truncate">{p.name} {p.id === meetingData?.hostId && '(Host)'}</p>
                        {isReactionRecent(p.lastReactionAt) && (
                            <span className="text-lg animate-bounce">{p.lastReaction}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {p.hasRaisedHand && <Hand className="text-yellow-500 h-4 w-4" />}
                        {isHost && p.hasRaisedHand && (
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => lowerHand(p.id)}>Lower</Button>
                        )}
                        {p.isMuted && <MicOff className="h-4 w-4 text-muted-foreground" />}
                        {isHost && p.id !== user?.uid && (
                            <div className="flex items-center">
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => toggleParticipantMute(p.id, !!p.isMuted)}>
                                    {p.isMuted ? <Mic className="h-3 w-3" /> : <MicOff className="h-3 w-3" />}
                                    <span className="sr-only">Mute/Unmute</span>
                                </Button>
                                <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeParticipant(p.id)}>
                                    <XCircle className="h-3 w-3" />
                                    <span className="sr-only">Remove</span>
                                </Button>
                            </div>
                        )}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card className="flex flex-col flex-1 min-h-0">
                <CardHeader className="py-3">
                  <CardTitle className="text-lg">Chat</CardTitle>
                </CardHeader>
                <CardContent className="flex-1 overflow-hidden pt-0">
                    <ScrollArea className="h-full">
                        <div className="space-y-4 pr-4">
                        {chatMessages?.map((msg, index) => (
                            <div key={index} className="flex flex-col gap-1 text-sm">
                                <div className="flex items-center justify-between">
                                    <span className="font-bold text-xs">{msg.senderId === user?.uid ? "You" : msg.senderName}</span>
                                    <span className="text-[10px] text-muted-foreground">
                                        {msg.createdAt ? format(new Date(msg.createdAt.seconds * 1000), 'p') : ''}
                                    </span>
                                </div>
                                <span className="bg-secondary/30 rounded-lg p-2 break-words">{msg.text}</span>
                            </div>
                        ))}
                        <div ref={messagesEndRef} />
                        </div>
                    </ScrollArea>
                </CardContent>
                <CardFooter className="p-3 shrink-0">
                    <div className="flex w-full items-center gap-2">
                        <Textarea
                            placeholder="Message..."
                            className="flex-1 min-h-[40px] max-h-[80px] text-sm py-2 resize-none"
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSendMessage();
                                }
                            }}
                        />
                        <Button onClick={handleSendMessage} size="icon" className="h-10 w-10 shrink-0">
                            <Send className="h-4 w-4" />
                        </Button>
                    </div>
                </CardFooter>
              </Card>
            </div>
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}

export default RoomPage;