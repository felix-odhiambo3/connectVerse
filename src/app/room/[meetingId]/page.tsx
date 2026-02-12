'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useDoc, useCollection, useUser, useFirestore, useMemoFirebase } from '@/firebase';
import { doc, collection, serverTimestamp } from 'firebase/firestore';
import AuthGuard from '@/components/auth/AuthGuard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { setDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';

function RoomPage() {
  const params = useParams();
  const meetingId = params.meetingId as string;
  const { user } = useUser();
  const firestore = useFirestore();
  const router = useRouter();

  const meetingRef = useMemoFirebase(() => {
    if (!firestore || !meetingId) return null;
    return doc(firestore, 'meetings', meetingId);
  }, [firestore, meetingId]);

  const { data: meeting, isLoading: isMeetingLoading } = useDoc(meetingRef);

  const participantsRef = useMemoFirebase(() => {
    if (!firestore || !meetingId) return null;
    return collection(firestore, 'meetings', meetingId, 'participants');
  }, [firestore, meetingId]);
  
  const { data: participants, isLoading: areParticipantsLoading } = useCollection(participantsRef);

  useEffect(() => {
    if (!user || !meetingId || !firestore) return;

    const participantRef = doc(firestore, 'meetings', meetingId, 'participants', user.uid);

    setDocumentNonBlocking(participantRef, {
        name: user.displayName || user.email,
        joinedAt: serverTimestamp(),
    }, { merge: true });


    return () => {
        const participantRefToDelete = doc(firestore, 'meetings', meetingId, 'participants', user.uid);
        deleteDocumentNonBlocking(participantRefToDelete);
    };
  }, [user, meetingId, firestore]);

  const leaveMeeting = () => {
    router.push('/dashboard');
  };

  if (isMeetingLoading || areParticipantsLoading) {
    return (
        <AuthGuard>
            <div className="p-4 md:p-8">
                <Skeleton className="h-8 w-1/4 mb-4" />
                <Skeleton className="h-96 w-full" />
            </div>
        </AuthGuard>
    )
  }

  if (!meeting) {
    return (
      <AuthGuard>
        <div className="flex flex-col items-center justify-center h-screen">
          <h1 className="text-2xl font-bold mb-4">Meeting not found</h1>
          <p className="text-muted-foreground mb-8">The meeting ID is invalid or the meeting has ended.</p>
          <Button onClick={() => router.push('/dashboard')}>Go to Dashboard</Button>
        </div>
      </AuthGuard>
    );
  }

  const isHost = user?.uid === meeting.hostId;

  return (
    <AuthGuard>
      <div className="flex h-screen w-full">
        <div className="flex flex-1 flex-col">
          <header className="flex h-16 items-center justify-between border-b bg-background px-6">
            <div>
              <h1 className="text-xl font-semibold">Meeting Room</h1>
              <p className="text-sm text-muted-foreground">ID: {meetingId}</p>
            </div>
            <Button onClick={leaveMeeting}>Leave Meeting</Button>
          </header>
          <main className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 p-4">
              <div className="md:col-span-2 bg-muted rounded-lg flex items-center justify-center">
                  <p className="text-muted-foreground">Video feed will be here</p>
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
                                {meeting.hostId === p.id && <Badge>Host</Badge>}
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
