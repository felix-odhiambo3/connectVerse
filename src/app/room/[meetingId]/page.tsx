'use client';

import { useEffect, useRef, useState } from 'react';
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
} from 'firebase/firestore';
import { format } from 'date-fns';
import AuthGuard from '@/components/auth/AuthGuard';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { setDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { Mic, MicOff, Video, VideoOff, ScreenShare, ScreenShareOff, Timer, XCircle, Send, Hand, Lock, Unlock, CircleDot } from 'lucide-react';


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
    // IMPORTANT: For production applications, you MUST configure a TURN server.
    // A TURN server is necessary to relay traffic when a direct peer-to-peer
    // connection cannot be established, for example, due to restrictive firewalls.
    // You can use a managed service like Twilio's Network Traversal Service
    // or host your own using an open-source solution like coturn.
    // {
    //   urls: 'turn:your-turn-server.com:3478',
    //   username: 'your-username',
    //   credential: 'your-password',
    // },
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
}

function RoomPage() {
  const params = useParams();
  const meetingId = params.meetingId as string;
  const { user } = useUser();
  const firestore = useFirestore();
  const router = useRouter();
  const { toast } = useToast();

  const [hasCameraPermission, setHasCameraPermission] = useState(true);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [elapsedTime, setElapsedTime] = useState('00:00:00');
  const [chatInput, setChatInput] = useState('');
  const [wasInMeeting, setWasInMeeting] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const candidateQueueRef = useRef<RTCIceCandidate[]>([]);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };
  useEffect(scrollToBottom, [chatMessages]);

  const handleSendMessage = async () => {
    if (!user || !chatInput.trim() || !firestore || !meetingId) return;

    const chatCollection = collection(firestore, MEETINGS_COLLECTION, meetingId, CHAT_COLLECTION);
    await addDoc(chatCollection, {
        text: chatInput.trim(),
        senderId: user.uid,
        senderName: user.displayName || user.email,
        createdAt: serverTimestamp(),
    });
    setChatInput('');
  };


  // Meeting Timer
  useEffect(() => {
    if (!meetingData?.createdAt) return;
    
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
  }, [meetingData?.createdAt]);

  const cleanupLocalMedia = () => {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        setLocalStream(null);
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
  
  // Listen for meeting end
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

  // Get camera permissions and local stream. Runs only once on mount.
  useEffect(() => {
    let isCancelled = false;
    const getCameraPermission = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (!isCancelled) {
          setLocalStream(stream);
          setHasCameraPermission(true);
        } else {
          stream.getTracks().forEach(track => track.stop());
        }
      } catch (error: any) {
        if (isCancelled) {
            console.warn('Camera access request cancelled on component unmount.');
            return;
        }

        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            console.error('Camera access denied by user:', error);
            setHasCameraPermission(false);
            toast({
                variant: 'destructive',
                title: 'Camera Access Denied',
                description: 'Please enable camera and microphone permissions in your browser settings to join the call.',
            });
        } else if (error.name === 'AbortError') {
            console.warn('Camera access request was aborted.', error);
            setHasCameraPermission(false);
        } else {
            console.error('Error accessing camera/microphone:', error);
            setHasCameraPermission(false);
            toast({
                variant: 'destructive',
                title: 'Device Error',
                description: 'Could not access your camera or microphone. Please check that they are connected and not in use by another application.',
            });
        }
      }
    };
    getCameraPermission();
    
    return () => {
      isCancelled = true;
      cleanupLocalMedia();
      cleanupPeerConnection();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  
  // Effect to attach streams to video elements
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
      cameraTrackRef.current = localStream.getVideoTracks()[0];
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);


  // Join the room and manage participant list
  useEffect(() => {
    if (!user || !meetingId || !firestore || !meetingData) return;

    const participantRef = doc(firestore, MEETINGS_COLLECTION, meetingId, PARTICIPANTS_COLLECTION, user.uid);

    const setupParticipant = async () => {
        const docSnap = await getDoc(participantRef);

        let role: 'host' | 'participant' | 'waiting';
        if (user.uid === meetingData.hostId) {
            role = 'host';
        } else {
            role = meetingData.isLocked ? 'waiting' : 'participant';
        }
        
        let initialData: any = {
            name: user.displayName || user.email,
            joinedAt: serverTimestamp(),
            role: role,
        };

        if (!docSnap.exists()) {
            initialData.hasRaisedHand = false;
            initialData.isMuted = false;
            setDocumentNonBlocking(participantRef, initialData, { merge: false });
        } else {
            // Document exists, only update the role if it's different to prevent resetting other states.
            const existingData = docSnap.data();
            if (existingData.role !== role) {
                updateDocumentNonBlocking(participantRef, { role: role });
            }
        }
    };
    setupParticipant();
  }, [user?.uid, meetingId, firestore, meetingData]);

    // Effect to handle being removed from the meeting
    useEffect(() => {
        if (!user || areParticipantsLoading) return;

        const isCurrentlyInList = participants?.some(p => p.id === user.uid) ?? false;

        if (isCurrentlyInList) {
            setWasInMeeting(true);
        }

        if (wasInMeeting && !isCurrentlyInList) {
            toast({
                title: "You were removed from the meeting.",
                description: "Redirecting to the dashboard.",
            });
            router.push('/dashboard');
        }
    }, [participants, user, router, toast, wasInMeeting, areParticipantsLoading]);

    // Effect for automatic host crowning
    useEffect(() => {
        if (!meetingData || !participants || !user || !meetingRef) return;

        const hostIsPresent = participants.some(p => p.id === meetingData.hostId);
        const activeParticipants = participants?.filter(p => p.role === 'host' || p.role === 'participant');

        if (!hostIsPresent && activeParticipants.length > 0) {
            const newHost = activeParticipants[0];
            if (newHost.id === user.uid) {
                // I am the new host!
                updateDocumentNonBlocking(meetingRef, { hostId: newHost.id });
                toast({ title: 'You are now the host!' });
            }
        }
    }, [participants, meetingData, user, firestore, meetingRef, toast]);


  // WebRTC Signaling Logic
  useEffect(() => {
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
        
        // After candidate subcollections are marked for deletion, delete the main docs
        batch.delete(offerDocRef);
        batch.delete(answerDocRef);
  
        await batch.commit();
      } catch (error) {
        // This can fail if documents don't exist, which is fine.
        console.log("Could not cleanup webrtc signaling docs, this may be harmless:", error);
      }
    };


    // Condition to terminate the call and cleanup
    if (!localStream || !user || !activeParticipants || activeParticipants.length < 2 || isUserInWaitingRoom) {
      if (peerConnectionRef.current) {
        cleanupPeerConnection();
        // The first participant in the list is responsible for cleaning up signaling docs
        // to prevent race conditions.
        if (activeParticipants && activeParticipants.length > 0 && activeParticipants[0].id === user.uid) {
            cleanupWebRTCSignaling();
        }
      }
      return; // Stop here if no call should be active
    }

    // If we've reached here, it means a call should be active or starting.
    // Initialize PC if it doesn't exist
    if (!peerConnectionRef.current) {
        const pc = new RTCPeerConnection(servers);
        peerConnectionRef.current = pc;
        candidateQueueRef.current = [];

        pc.ontrack = (event) => {
          setRemoteStream(event.streams[0]);
        };
        
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
    }

    const pc = peerConnectionRef.current;
    if (!firestore || !meetingId) return; // a guard for typescript
    const webrtcRef = collection(firestore, MEETINGS_COLLECTION, meetingId, WEBRTC_COLLECTION);

    const isCaller = activeParticipants[0].id === user.uid;
    const isCallee = activeParticipants.length >= 2 && activeParticipants[1].id === user.uid;

    if (isCaller) {
        const offerDescriptionRef = doc(webrtcRef, OFFER_DOC);
        const answerDescriptionRef = doc(webrtcRef, ANSWER_DOC);
        const callerCandidatesCollection = collection(offerDescriptionRef, CALLER_CANDIDATES_COLLECTION);
        const calleeCandidatesCollection = collection(answerDescriptionRef, CALLEE_CANDIDATES_COLLECTION);

        pc.onicecandidate = (event) => {
            event.candidate && addDoc(callerCandidatesCollection, event.candidate.toJSON());
        };

        if (pc.signalingState === 'stable') {
          pc.createOffer().then(offer => {
              pc.setLocalDescription(offer);
              setDocumentNonBlocking(offerDescriptionRef, { sdp: offer.sdp, type: offer.type }, { merge: true });
          });
        }
        
        const unsubAnswer = onSnapshot(answerDescriptionRef, (snapshot) => {
            if (snapshot.exists() && pc.signalingState === 'have-local-offer') {
                const answerDescription = new RTCSessionDescription(snapshot.data());
                pc.setRemoteDescription(answerDescription).then(() => {
                    candidateQueueRef.current.forEach(candidate => pc.addIceCandidate(candidate));
                    candidateQueueRef.current = [];
                }).catch((e) => {
                    console.error("Failed to set remote description for answer:", e);
                });
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

       const unsubOffer = onSnapshot(offerDescriptionRef, (snapshot) => {
           if (snapshot.exists() && !pc.currentRemoteDescription) {
               const offerDescription = new RTCSessionDescription(snapshot.data());
               pc.setRemoteDescription(offerDescription).then(() => {
                    candidateQueueRef.current.forEach(candidate => pc.addIceCandidate(candidate));
                    candidateQueueRef.current = [];

                   pc.createAnswer().then(answer => {
                       if (!pc.currentLocalDescription) {
                           pc.setLocalDescription(answer);
                           setDocumentNonBlocking(answerDescriptionRef, { sdp: answer.sdp, type: answer.type }, { merge: true });
                       }
                   });
               });
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

  }, [localStream, meetingId, firestore, user, activeParticipants, isUserInWaitingRoom]);
  
    // Effect to handle host muting participant
    useEffect(() => {
        if (localStream) {
            const selfMuted = isAudioMuted;
            const hostMuted = currentUserParticipant?.isMuted ?? false;
            localStream.getAudioTracks().forEach(track => {
                track.enabled = !selfMuted && !hostMuted;
            });
        }
    }, [isAudioMuted, currentUserParticipant?.isMuted, localStream]);

    const toggleAudio = () => {
        setIsAudioMuted(prev => !prev);
    };

  const toggleVideo = () => {
      const newVideoState = !isVideoOff;
      localStream?.getVideoTracks().forEach(track => {
          track.enabled = !newVideoState;
      });
      setIsVideoOff(newVideoState);
  };

  const toggleScreenShare = async () => {
    if (!peerConnectionRef.current || !localStream) return;
    const videoSender = peerConnectionRef.current.getSenders().find(sender => sender.track?.kind === 'video');
    if (!videoSender) return;

    if (isScreenSharing) {
        if (cameraTrackRef.current) {
            await videoSender.replaceTrack(cameraTrackRef.current);
            localStream.getVideoTracks()[0].enabled = !isVideoOff;
        }
        setIsScreenSharing(false);
    } else {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = screenStream.getVideoTracks()[0];
        
        await videoSender.replaceTrack(screenTrack);
        setIsScreenSharing(true);

        screenTrack.onended = async () => {
            if (peerConnectionRef.current?.getSenders().find(s => s.track === screenTrack) && cameraTrackRef.current) {
                await videoSender.replaceTrack(cameraTrackRef.current);
                localStream.getVideoTracks()[0].enabled = !isVideoOff;
            }
            setIsScreenSharing(false);
        };
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
      const participantRef = doc(firestore, MEETINGS_COLLECTION, meetingId, PARTICIPANTS_COLLECTION, user.uid);
      updateDocumentNonBlocking(participantRef, { hasRaisedHand: !currentUserParticipant.hasRaisedHand });
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
  
  const toggleRecording = () => {
      if (!isHost || !meetingRef) return;
      updateDocumentNonBlocking(meetingRef, { isRecording: !meetingData?.isRecording });
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

  if (isUserInWaitingRoom) {
    return (
      <AuthGuard>
        <div className="flex h-screen w-full flex-col items-center justify-center bg-background p-4">
            <Card className="max-w-sm">
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
      <div className="flex h-screen w-full">
        <div className="flex flex-1 flex-col">
          <header className="flex h-16 items-center justify-between border-b bg-background px-6">
            <div className="flex items-center gap-4">
                <h1 className="text-xl font-semibold">Meeting Room</h1>
                {meetingData?.isRecording && (
                    <div className="flex items-center gap-2 text-sm text-red-500">
                        <CircleDot className="h-4 w-4 animate-pulse" />
                        <span>Recording</span>
                    </div>
                )}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Timer className="h-4 w-4" />
                <span>{elapsedTime}</span>
            </div>
          </header>
          <main className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 p-4">
            <div className="md:col-span-2 bg-muted rounded-lg flex flex-col items-center justify-center p-4 gap-4">
              <div className="w-full aspect-video relative bg-black rounded-md flex items-center justify-center">
                 <video ref={remoteVideoRef} className="w-full h-full object-contain rounded-md" autoPlay playsInline />
                 <video ref={localVideoRef} className="absolute bottom-4 right-4 w-1/4 max-w-[200px] object-cover rounded-md border-2 border-background" autoPlay muted playsInline />
                 {!remoteStream && activeParticipants && activeParticipants.length > 1 && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <p className="text-white">Connecting...</p>
                    </div>
                 )}
              </div>
               {!hasCameraPermission && (
                  <Alert variant="destructive">
                    <AlertTitle>Camera Access Required</AlertTitle>
                    <AlertDescription>
                      Please allow camera access to use this feature. Video feeds cannot be established.
                    </AlertDescription>
                  </Alert>
                )}
                 {activeParticipants && activeParticipants.length < 2 && !isLoading && (
                    <Alert>
                        <AlertTitle>Waiting for others</AlertTitle>
                        <AlertDescription>
                        You are the only one in the meeting. The video call will start once another person joins.
                        </AlertDescription>
                    </Alert>
                )}
                <div className="flex items-center justify-center gap-2 flex-wrap">
                    <Button onClick={toggleAudio} variant={(isAudioMuted || !!currentUserParticipant?.isMuted) ? "secondary" : "outline"} size="icon" className="rounded-full h-12 w-12" disabled={!hasCameraPermission}>
                      {(isAudioMuted || !!currentUserParticipant?.isMuted) ? <MicOff /> : <Mic />}
                      <span className="sr-only">{(isAudioMuted || !!currentUserParticipant?.isMuted) ? 'Unmute' : 'Mute'}</span>
                    </Button>
                     <Button onClick={toggleVideo} variant={isVideoOff ? "secondary" : "outline"} size="icon" className="rounded-full h-12 w-12" disabled={!hasCameraPermission}>
                      {isVideoOff ? <VideoOff /> : <Video />}
                      <span className="sr-only">{isVideoOff ? 'Turn camera on' : 'Turn camera off'}</span>
                    </Button>
                    <Button onClick={toggleScreenShare} variant={isScreenSharing ? "secondary" : "outline"} size="icon" className="rounded-full h-12 w-12" disabled={!hasCameraPermission}>
                      {isScreenSharing ? <ScreenShareOff /> : <ScreenShare />}
                      <span className="sr-only">{isScreenSharing ? 'Stop Sharing' : 'Share Screen'}</span>
                    </Button>
                    <Button onClick={toggleRaiseHand} variant={currentUserParticipant?.hasRaisedHand ? "secondary" : "outline"} size="icon" className="rounded-full h-12 w-12">
                        <Hand />
                        <span className="sr-only">{currentUserParticipant?.hasRaisedHand ? 'Lower Hand' : 'Raise Hand'}</span>
                    </Button>
                    {isHost && (
                        <Button onClick={toggleLockMeeting} variant={meetingData?.isLocked ? "secondary" : "outline"} size="icon" className="rounded-full h-12 w-12">
                            {meetingData?.isLocked ? <Unlock /> : <Lock />}
                            <span className="sr-only">{meetingData?.isLocked ? 'Unlock Meeting' : 'Lock Meeting'}</span>
                        </Button>
                    )}
                    {isHost && (
                        <Button onClick={toggleRecording} variant={meetingData?.isRecording ? "secondary" : "outline"} size="icon" className="rounded-full h-12 w-12">
                            <CircleDot />
                            <span className="sr-only">{meetingData?.isRecording ? 'Stop Recording' : 'Start Recording'}</span>
                        </Button>
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
            <div className="flex flex-col gap-4">
              {isHost && waitingList && waitingList.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle>Waiting Room ({waitingList.length})</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        {waitingList.map((p) => (
                            <div key={p.id} className="flex items-center justify-between">
                                <span>{p.name}</span>
                                <Button size="sm" onClick={() => admitParticipant(p.id)}>Admit</Button>
                            </div>
                        ))}
                    </CardContent>
                </Card>
              )}
              <Card>
                <CardHeader>
                  <CardTitle>Participants ({activeParticipants?.length || 0})</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {activeParticipants?.map((p) => (
                    <div key={p.id} className="flex items-center gap-4">
                      <Avatar>
                        <AvatarImage src={`https://avatar.vercel.sh/${p.id}.png`} />
                        <AvatarFallback>{p.name?.[0].toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <p className="font-medium">{p.name} {p.id === meetingData?.hostId && '(Host)'}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {p.hasRaisedHand && <Hand className="text-yellow-500 h-4 w-4" />}
                        {isHost && p.hasRaisedHand && (
                            <Button size="sm" variant="ghost" onClick={() => lowerHand(p.id)}>Lower Hand</Button>
                        )}
                        {p.isMuted && <MicOff className="h-4 w-4 text-muted-foreground" />}
                        {isHost && p.id !== user?.uid && (
                            <>
                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => toggleParticipantMute(p.id, !!p.isMuted)}>
                                    {p.isMuted ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                                    <span className="sr-only">{p.isMuted ? 'Request Unmute' : 'Mute Participant'}</span>
                                </Button>
                                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => removeParticipant(p.id)}>
                                    <XCircle className="h-4 w-4" />
                                    <span className="sr-only">Remove Participant</span>
                                </Button>
                            </>
                        )}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card className="flex flex-col flex-1">
                <CardHeader>
                  <CardTitle>Chat</CardTitle>
                </CardHeader>
                <CardContent className="flex-1 space-y-4 overflow-hidden">
                    <ScrollArea className="h-full pr-4">
                        <div className="space-y-4">
                        {chatMessages?.map((msg, index) => (
                            <div key={index} className="flex gap-2 text-sm">
                                <span className="font-bold">{msg.senderId === user?.uid ? "You" : msg.senderName}:</span>
                                <span>{msg.text}</span>
                                <span className="text-xs text-muted-foreground ml-auto">
                                    {msg.createdAt ? format(new Date(msg.createdAt.seconds * 1000), 'p') : ''}
                                </span>
                            </div>
                        ))}
                        <div ref={messagesEndRef} />
                        </div>
                    </ScrollArea>
                </CardContent>
                <CardFooter>
                    <div className="flex w-full items-center gap-2">
                        <Textarea
                            placeholder="Type a message..."
                            className="flex-1"
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSendMessage();
                                }
                            }}
                        />
                        <Button onClick={handleSendMessage} size="icon">
                            <Send className="h-4 w-4" />
                            <span className="sr-only">Send</span>
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
