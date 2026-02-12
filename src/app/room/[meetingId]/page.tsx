'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useCollection, useUser, useFirestore, useMemoFirebase } from '@/firebase';
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
} from 'firebase/firestore';
import AuthGuard from '@/components/auth/AuthGuard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { setDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { Mic, MicOff, Video, VideoOff } from 'lucide-react';

// Firestore collections
const MEETINGS_COLLECTION = 'meetings';
const PARTICIPANTS_COLLECTION = 'participants';
const WEBRTC_COLLECTION = 'webrtc';
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

function RoomPage() {
  const params = useParams();
  const meetingId = params.meetingId as string;
  const { user } = useUser();
  const firestore = useFirestore();
  const router = useRouter();
  const { toast } = useToast();

  const [hasCameraPermission, setHasCameraPermission] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const candidateQueueRef = useRef<RTCIceCandidate[]>([]);


  const participantsRef = useMemoFirebase(() => {
    if (!firestore || !meetingId) return null;
    return query(collection(firestore, MEETINGS_COLLECTION, meetingId, PARTICIPANTS_COLLECTION), orderBy('joinedAt', 'asc'));
  }, [firestore, meetingId]);

  const { data: participants, isLoading: areParticipantsLoading } = useCollection(participantsRef);

  // Get camera permissions and local stream
  useEffect(() => {
    const getCameraPermission = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setLocalStream(stream);
        setHasCameraPermission(true);
      } catch (error) {
        console.error('Error accessing camera:', error);
        setHasCameraPermission(false);
        toast({
          variant: 'destructive',
          title: 'Camera Access Denied',
          description: 'Please enable camera permissions in your browser settings to use this app.',
        });
      }
    };
    getCameraPermission();
  }, [toast]);
  
  // Effect to attach streams to video elements
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);


  // Join the room and manage participant list
  useEffect(() => {
    if (!user || !meetingId || !firestore) return;

    const participantRef = doc(firestore, MEETINGS_COLLECTION, meetingId, PARTICIPANTS_COLLECTION, user.uid);
    setDocumentNonBlocking(participantRef, {
      name: user.displayName || user.email,
      joinedAt: serverTimestamp(),
    }, { merge: true });

    // Cleanup on unmount
    return () => {
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
      const participantRefToDelete = doc(firestore, MEETINGS_COLLECTION, meetingId, PARTICIPANTS_COLLECTION, user.uid);
      deleteDocumentNonBlocking(participantRefToDelete);
      
      const webrtcRef = collection(firestore, MEETINGS_COLLECTION, meetingId, WEBRTC_COLLECTION);
      getDocs(webrtcRef).then(snapshot => {
         const batch = writeBatch(firestore);
         snapshot.forEach(doc => batch.delete(doc.ref));
         return batch.commit();
      });
    };
  }, [user, meetingId, firestore, localStream]);


  // WebRTC Signaling Logic
  useEffect(() => {
    if (!localStream || !meetingId || !firestore || !user || !participants) return;

    const webrtcRef = collection(firestore, MEETINGS_COLLECTION, meetingId, WEBRTC_COLLECTION);

    const isCaller = participants.length === 2 && participants[0].id === user.uid;
    const isCallee = participants.length === 2 && participants[1].id === user.uid;

    const initializePeerConnection = () => {
        peerConnectionRef.current = new RTCPeerConnection(servers);
        candidateQueueRef.current = [];

        const remote = new MediaStream();
        setRemoteStream(remote);

        // Listen for tracks from the remote peer
        peerConnectionRef.current.ontrack = (event) => {
            event.streams[0].getTracks().forEach(track => {
                remote.addTrack(track);
            });
        };
        
        // Add local tracks to the connection
        localStream.getTracks().forEach(track => {
            peerConnectionRef.current?.addTrack(track, localStream);
        });
    }
    
    // Caller logic
    if (isCaller) {
        initializePeerConnection();
        const pc = peerConnectionRef.current!;
        
        const offerDescriptionRef = doc(webrtcRef, OFFER_DOC);
        const answerDescriptionRef = doc(webrtcRef, ANSWER_DOC);
        const callerCandidatesCollection = collection(offerDescriptionRef, CALLER_CANDIDATES_COLLECTION);
        const calleeCandidatesCollection = collection(answerDescriptionRef, CALLEE_CANDIDATES_COLLECTION);

        pc.onicecandidate = (event) => {
            event.candidate && addDoc(callerCandidatesCollection, event.candidate.toJSON());
        };

        pc.createOffer().then(offer => {
            pc.setLocalDescription(offer);
            setDocumentNonBlocking(offerDescriptionRef, { sdp: offer.sdp, type: offer.type }, { merge: true });
        });
        
        const unsubAnswer = onSnapshot(answerDescriptionRef, (snapshot) => {
            if (snapshot.exists() && pc.currentRemoteDescription?.type !== 'answer') {
                const answerDescription = new RTCSessionDescription(snapshot.data());
                pc.setRemoteDescription(answerDescription).then(() => {
                    candidateQueueRef.current.forEach(candidate => pc.addIceCandidate(candidate));
                    candidateQueueRef.current = [];
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

    // Callee logic
    if (isCallee) {
       initializePeerConnection();
       const pc = peerConnectionRef.current!;

       const offerDescriptionRef = doc(webrtcRef, OFFER_DOC);
       const answerDescriptionRef = doc(webrtcRef, ANSWER_DOC);
       const callerCandidatesCollection = collection(offerDescriptionRef, CALLER_CANDIDATES_COLLECTION);
       const calleeCandidatesCollection = collection(answerDescriptionRef, CALLEE_CANDIDATES_COLLECTION);

        pc.onicecandidate = (event) => {
            event.candidate && addDoc(calleeCandidatesCollection, event.candidate.toJSON());
        };

       const unsubOffer = onSnapshot(offerDescriptionRef, (snapshot) => {
           // Only process offer if we haven't already set a local answer
           if (snapshot.exists() && !pc.currentLocalDescription) {
               const offerDescription = new RTCSessionDescription(snapshot.data());
               pc.setRemoteDescription(offerDescription).then(() => {
                    candidateQueueRef.current.forEach(candidate => pc.addIceCandidate(candidate));
                    candidateQueueRef.current = [];

                   pc.createAnswer().then(answer => {
                       pc.setLocalDescription(answer);
                       setDocumentNonBlocking(answerDescriptionRef, { sdp: answer.sdp, type: answer.type }, { merge: true });
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

  }, [localStream, meetingId, firestore, user, participants]);

  const toggleAudio = () => {
    const newMuteState = !isAudioMuted;
    localStream?.getAudioTracks().forEach(track => {
        track.enabled = !newMuteState;
    });
    setIsAudioMuted(newMuteState);
  };

  const toggleVideo = () => {
      const newVideoState = !isVideoOff;
      localStream?.getVideoTracks().forEach(track => {
          track.enabled = !newVideoState;
      });
      setIsVideoOff(newVideoState);
  };

  const leaveMeeting = () => {
    router.push('/dashboard');
  };
  
  const isLoading = areParticipantsLoading;

  if (isLoading) {
    return (
      <AuthGuard>
        <div className="p-4 md:p-8">
          <Skeleton className="h-8 w-1/4 mb-4" />
          <Skeleton className="h-96 w-full" />
        </div>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <div className="flex h-screen w-full">
        <div className="flex flex-1 flex-col">
          <header className="flex h-16 items-center justify-between border-b bg-background px-6">
            <div>
              <h1 className="text-xl font-semibold">Meeting Room</h1>
              <p className="text-sm text-muted-foreground">ID: {meetingId}</p>
            </div>
          </header>
          <main className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 p-4">
            <div className="md:col-span-2 bg-muted rounded-lg flex flex-col items-center justify-center p-4 gap-4">
              <div className="w-full aspect-video relative bg-black rounded-md flex items-center justify-center">
                 <video ref={remoteVideoRef} className="w-full h-full object-contain rounded-md" autoPlay playsInline />
                 <video ref={localVideoRef} className="absolute bottom-4 right-4 w-1/4 max-w-[200px] object-cover rounded-md border-2 border-background" autoPlay muted playsInline />
                 {!remoteStream && participants && participants.length > 1 && (
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
                 {participants && participants.length < 2 && !isLoading && (
                    <Alert>
                        <AlertTitle>Waiting for others</AlertTitle>
                        <AlertDescription>
                        You are the only one in the meeting. The video call will start once another person joins.
                        </AlertDescription>
                    </Alert>
                )}
                <div className="flex items-center justify-center gap-4">
                    <Button onClick={toggleAudio} variant={isAudioMuted ? "secondary" : "outline"} size="icon" className="rounded-full h-12 w-12">
                      {isAudioMuted ? <MicOff /> : <Mic />}
                      <span className="sr-only">{isAudioMuted ? 'Unmute' : 'Mute'}</span>
                    </Button>
                     <Button onClick={toggleVideo} variant={isVideoOff ? "secondary" : "outline"} size="icon" className="rounded-full h-12 w-12">
                      {isVideoOff ? <VideoOff /> : <Video />}
                      <span className="sr-only">{isVideoOff ? 'Turn camera on' : 'Turn camera off'}</span>
                    </Button>
                    <Button onClick={leaveMeeting} variant="destructive" className="rounded-full h-12 px-6">
                      Leave Meeting
                    </Button>
                  </div>
            </div>
            <div className="flex flex-col gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Participants ({participants?.length || 0})</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {participants?.map((p) => (
                    <div key={p.id} className="flex items-center gap-4">
                      <Avatar>
                        <AvatarImage src={`https://avatar.vercel.sh/${p.id}.png`} />
                        <AvatarFallback>{p.name?.[0].toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <p className="font-medium">{p.name}</p>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}

export default RoomPage;
