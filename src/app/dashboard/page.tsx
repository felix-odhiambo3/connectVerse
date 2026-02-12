'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useFirestore, useUser } from '@/firebase';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import AuthGuard from '@/components/auth/AuthGuard';
import { LogOut, Plus, Video } from 'lucide-react';
import Link from 'next/link';

export default function DashboardPage() {
  const [meetingId, setMeetingId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const router = useRouter();
  const firestore = useFirestore();
  const auth = useAuth();
  const { user } = useUser();
  const { toast } = useToast();

  const createMeeting = async () => {
    if (!user) return;
    setIsCreating(true);
    try {
      const meetingsCollection = collection(firestore, 'meetings');
      const newMeetingRef = await addDoc(meetingsCollection, {
        hostId: user.uid,
        createdAt: serverTimestamp(),
        status: 'pending',
        isLocked: false,
        isRecording: false,
      });
      toast({ title: 'Meeting created!' });
      router.push(`/room/${newMeetingRef.id}`);
    } catch (error) {
      console.error('Error creating meeting:', error);
      toast({
        variant: 'destructive',
        title: 'Error creating meeting',
        description: 'There was a problem creating your meeting. Please try again.',
      });
      setIsCreating(false);
    }
  };

  const joinMeeting = () => {
    if (meetingId.trim()) {
      router.push(`/room/${meetingId.trim()}`);
    } else {
        toast({
            variant: 'destructive',
            title: 'Invalid Meeting ID',
            description: 'Please enter a valid meeting ID.',
        });
    }
  };
  
  const handleSignOut = async () => {
    await auth.signOut();
    router.push('/');
  }

  return (
    <AuthGuard>
      <div className="flex flex-col min-h-screen bg-background">
        <header className="px-4 lg:px-6 h-14 flex items-center border-b">
          <Link href="/dashboard" className="flex items-center justify-center" prefetch={false}>
            <Video className="h-6 w-6" />
            <span className="ml-2 font-semibold">ConnectVerse</span>
          </Link>
          <div className="ml-auto">
             <Button variant="ghost" size="icon" onClick={handleSignOut}>
                <LogOut className="h-4 w-4" />
                <span className="sr-only">Sign Out</span>
            </Button>
          </div>
        </header>
        <main className="flex-1 flex items-center justify-center p-4">
          <div className="grid gap-6 md:grid-cols-2 lg:gap-12">
            <Card>
              <CardHeader>
                <CardTitle>Create a new meeting</CardTitle>
                <CardDescription>Start a new video call instantly.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">Click the button below to generate a unique meeting link to share with others.</p>
              </CardContent>
              <CardFooter>
                <Button onClick={createMeeting} disabled={isCreating} className="w-full">
                  <Plus className="mr-2 h-4 w-4" />
                  {isCreating ? 'Creating...' : 'Create Meeting'}
                </Button>
              </CardFooter>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Join a meeting</CardTitle>
                <CardDescription>Enter a meeting ID to join an existing call.</CardDescription>
              </CardHeader>
              <CardContent>
                <Input
                  type="text"
                  placeholder="Enter Meeting ID"
                  value={meetingId}
                  onChange={(e) => setMeetingId(e.target.value)}
                  className="w-full"
                />
              </CardContent>
              <CardFooter>
                <Button onClick={joinMeeting} className="w-full">Join Meeting</Button>
              </CardFooter>
            </Card>
          </div>
        </main>
      </div>
    </AuthGuard>
  );
}
