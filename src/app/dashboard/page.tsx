'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useFirestore, useUser, useCollection, useMemoFirebase } from '@/firebase';
import { addDoc, collection, serverTimestamp, query, where, doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import AuthGuard from '@/components/auth/AuthGuard';
import { LogOut, Plus, Video, Calendar as CalendarIcon, Copy, Trash2, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import { deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';

const scheduleMeetingSchema = z.object({
  name: z.string().min(3, 'Meeting name must be at least 3 characters.'),
  date: z.date({
    required_error: "A date is required.",
  }),
  time: z.string().min(1, 'A time is required.'),
});


export default function DashboardPage() {
  const [meetingId, setMeetingId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [openScheduleDialog, setOpenScheduleDialog] = useState(false);
  const router = useRouter();
  const firestore = useFirestore();
  const auth = useAuth();
  const { user } = useUser();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof scheduleMeetingSchema>>({
    resolver: zodResolver(scheduleMeetingSchema),
    defaultValues: {
      name: "",
      time: "",
    },
  });

  const allUserMeetingsQuery = useMemoFirebase(() => {
    if (!user || !firestore) return null;
    return query(
      collection(firestore, 'meetings'),
      where('hostId', '==', user.uid)
    );
  }, [user, firestore]);

  const { data: allUserMeetings } = useCollection(allUserMeetingsQuery);

  const upcomingMeetings = useMemo(() => {
    if (!allUserMeetings) return [];
    // Client-side filtering
    return allUserMeetings
      .filter(meeting => meeting.status === 'scheduled')
      .sort((a, b) => (a.scheduledAt?.seconds || 0) - (b.scheduledAt?.seconds || 0));
  }, [allUserMeetings]);


  const createInstantMeeting = async () => {
    if (!user || !firestore) return;
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
    } finally {
      setIsCreating(false);
    }
  };

  const handleScheduleSubmit = async (values: z.infer<typeof scheduleMeetingSchema>) => {
    if (!user || !firestore) return;
    setIsCreating(true);

    const { name, date, time } = values;
    const [hours, minutes] = time.split(':');
    const scheduledDateTime = new Date(date);
    scheduledDateTime.setHours(parseInt(hours, 10));
    scheduledDateTime.setMinutes(parseInt(minutes, 10));
    scheduledDateTime.setSeconds(0, 0);

    if (scheduledDateTime < new Date()) {
        toast({
            variant: 'destructive',
            title: 'Invalid time',
            description: 'Scheduled time cannot be in the past.',
        });
        setIsCreating(false);
        return;
    }

    try {
        await addDoc(collection(firestore, 'meetings'), {
            name,
            hostId: user.uid,
            createdAt: serverTimestamp(),
            scheduledAt: scheduledDateTime,
            status: 'scheduled',
            isLocked: false,
            isRecording: false,
        });
        toast({ title: "Meeting scheduled successfully!" });
        setOpenScheduleDialog(false);
        form.reset();
    } catch (error) {
        console.error("Error scheduling meeting:", error);
        toast({
            variant: 'destructive',
            title: 'Error',
            description: 'Could not schedule the meeting. Please try again.',
        });
    } finally {
        setIsCreating(false);
    }
  }

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
    if (!auth) return;
    await auth.signOut();
    router.push('/');
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
        toast({ title: 'Meeting link copied to clipboard!' });
    }, (err) => {
        toast({ variant: 'destructive', title: 'Failed to copy link.' });
    });
  };

  const startMeeting = async (meetingId: string) => {
    if (!firestore) return;
    const meetingRef = doc(firestore, 'meetings', meetingId);
    try {
        await updateDoc(meetingRef, { status: 'pending' });
        router.push(`/room/${meetingId}`);
    } catch (error) {
        toast({ variant: 'destructive', title: 'Failed to start meeting.' });
    }
  };

  const deleteMeeting = (meetingId: string) => {
    if (!firestore) return;
    deleteDocumentNonBlocking(doc(firestore, 'meetings', meetingId));
    toast({ title: "Meeting deleted." });
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
        <main className="flex-1 flex flex-col items-center p-4 md:p-8">
          <div className="w-full max-w-5xl">
            <div className="grid gap-6 md:grid-cols-3 lg:gap-12">
              <Card>
                <CardHeader>
                  <CardTitle>Instant Meeting</CardTitle>
                  <CardDescription>Start a new video call right away.</CardDescription>
                </CardHeader>
                <CardFooter>
                  <Button onClick={createInstantMeeting} disabled={isCreating} className="w-full">
                    <Plus className="mr-2 h-4 w-4" />
                    {isCreating ? 'Creating...' : 'Start Now'}
                  </Button>
                </CardFooter>
              </Card>

              <Dialog open={openScheduleDialog} onOpenChange={setOpenScheduleDialog}>
                <DialogTrigger asChild>
                    <Card className="cursor-pointer hover:border-primary">
                        <CardHeader>
                          <CardTitle>Schedule a Meeting</CardTitle>
                          <CardDescription>Plan a meeting for a future date and time.</CardDescription>
                        </CardHeader>
                        <CardFooter>
                            <Button variant="outline" className="w-full">
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                Schedule
                            </Button>
                        </CardFooter>
                    </Card>
                </DialogTrigger>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Schedule a new meeting</DialogTitle>
                        <DialogDescription>
                            Fill in the details below to schedule your meeting.
                        </DialogDescription>
                    </DialogHeader>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(handleScheduleSubmit)} className="space-y-4">
                            <FormField control={form.control} name="name" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Meeting Name</FormLabel>
                                    <FormControl><Input placeholder="e.g., Team Sync" {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                             )} />
                            <FormField control={form.control} name="date" render={({ field }) => (
                                <FormItem className="flex flex-col">
                                    <FormLabel>Date</FormLabel>
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <FormControl>
                                                <Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
                                                    {field.value ? format(field.value, "PPP") : <span>Select a date</span>}
                                                    <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                                </Button>
                                            </FormControl>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-auto p-0" align="start">
                                            <Calendar
                                                mode="single"
                                                selected={field.value}
                                                onSelect={field.onChange}
                                                disabled={(date) =>
                                                    date < new Date(new Date().setHours(0, 0, 0, 0))
                                                }
                                                initialFocus
                                            />
                                        </PopoverContent>
                                    </Popover>
                                    <FormMessage />
                                </FormItem>
                             )} />
                            <FormField control={form.control} name="time" render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Time</FormLabel>
                                    <FormControl><Input type="time" {...field} /></FormControl>
                                    <FormMessage />
                                </FormItem>
                             )} />
                            <DialogFooter>
                                <Button type="submit" disabled={isCreating}>
                                    {isCreating ? 'Scheduling...' : 'Schedule Meeting'}
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
              </Dialog>

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

            {upcomingMeetings && upcomingMeetings.length > 0 && (
                <div className="mt-12">
                    <h2 className="text-2xl font-semibold mb-4">Upcoming Meetings</h2>
                    <div className="space-y-4">
                        {upcomingMeetings.map((meeting) => (
                            <Card key={meeting.id}>
                                <CardHeader className='flex-row items-center justify-between'>
                                    <div>
                                        <CardTitle>{meeting.name}</CardTitle>
                                        <CardDescription>
                                            {meeting.scheduledAt ? format(new Date(meeting.scheduledAt.seconds * 1000), 'PPP p') : ''}
                                        </CardDescription>
                                    </div>
                                    <div className="flex gap-2">
                                        <Button size="sm" onClick={() => startMeeting(meeting.id)}>
                                            Start <ArrowRight className="ml-2 h-4 w-4" />
                                        </Button>
                                        <Button size="sm" variant="outline" onClick={() => copyToClipboard(`${window.location.origin}/room/${meeting.id}`)}>
                                            <Copy className="h-4 w-4" />
                                        </Button>
                                        <Button size="sm" variant="destructive" onClick={() => deleteMeeting(meeting.id)}>
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </CardHeader>
                            </Card>
                        ))}
                    </div>
                </div>
            )}
          </div>
        </main>
      </div>
    </AuthGuard>
  );
}
