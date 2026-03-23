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
import { LogOut, Plus, Video, Calendar as CalendarIcon, Copy, Trash2, ArrowRight, Check } from 'lucide-react';
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
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const router = useRouter();
  const firestore = useFirestore();
  const auth = useAuth();
  const { user } = useUser();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof scheduleMeetingSchema>>({
    resolver: zodResolver(scheduleMeetingSchema),
    defaultValues: {
      name: "",
      time: "12:00",
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
      .sort((a, b) => {
        const timeA = a.scheduledAt?.seconds || 0;
        const timeB = b.scheduledAt?.seconds || 0;
        return timeA - timeB;
      });
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
        geminiNotesEnabled: false,
        participantPermissions: {
            allowShareScreen: true,
            allowSendReactions: true,
            allowUnmute: true,
            allowStartVideo: true,
        },
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

    const now = new Date();
    if (scheduledDateTime < now) {
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
            geminiNotesEnabled: false,
            participantPermissions: {
                allowShareScreen: true,
                allowSendReactions: true,
                allowUnmute: true,
                allowStartVideo: true,
            },
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
        toast({ title: 'Meeting link copied!' });
    }, (err) => {
        toast({ variant: 'destructive', title: 'Failed to copy.' });
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
        <header className="px-4 lg:px-6 h-16 flex items-center border-b bg-card">
          <Link href="/dashboard" className="flex items-center justify-center transition-opacity hover:opacity-80" prefetch={false}>
            <div className="bg-primary p-1.5 rounded-lg mr-2">
                <Video className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="font-bold text-lg tracking-tight">ConnectVerse</span>
          </Link>
          <div className="ml-auto">
             <Button variant="ghost" size="icon" onClick={handleSignOut} className="rounded-full">
                <LogOut className="h-4 w-4" />
                <span className="sr-only">Sign Out</span>
            </Button>
          </div>
        </header>
        <main className="flex-1 flex flex-col items-center p-4 md:p-12 bg-zinc-50/50">
          <div className="w-full max-w-5xl space-y-12">
            <section>
              <div className="flex items-end justify-between mb-8">
                <div>
                  <h2 className="text-3xl font-bold tracking-tight">Quick Start</h2>
                  <p className="text-muted-foreground mt-1">Start or plan your next meeting in seconds.</p>
                </div>
              </div>
              <div className="grid gap-6 md:grid-cols-3">
                <Card className="flex flex-col shadow-sm border-zinc-200 transition-all hover:shadow-md">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Plus className="h-5 w-5 text-primary" />
                        Instant Meeting
                    </CardTitle>
                    <CardDescription>Start a new video call immediately.</CardDescription>
                  </CardHeader>
                  <CardFooter className="mt-auto">
                    <Button onClick={createInstantMeeting} disabled={isCreating} className="w-full h-11">
                      {isCreating ? 'Creating...' : 'Start Now'}
                    </Button>
                  </CardFooter>
                </Card>

                <Dialog open={openScheduleDialog} onOpenChange={setOpenScheduleDialog}>
                  <DialogTrigger asChild>
                      <Card className="flex flex-col cursor-pointer hover:border-primary transition-all hover:shadow-md shadow-sm border-zinc-200">
                          <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <CalendarIcon className="h-5 w-5 text-primary" />
                                Schedule Meeting
                            </CardTitle>
                            <CardDescription>Plan a meeting for a future date and time.</CardDescription>
                          </CardHeader>
                          <CardFooter className="mt-auto">
                              <Button variant="outline" className="w-full h-11">
                                  Schedule
                              </Button>
                          </CardFooter>
                      </Card>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[425px]">
                      <DialogHeader>
                          <DialogTitle>Schedule a new meeting</DialogTitle>
                          <DialogDescription>
                              Fill in the details below to schedule your meeting.
                          </DialogDescription>
                      </DialogHeader>
                      <Form {...form}>
                          <form onSubmit={form.handleSubmit(handleScheduleSubmit)} className="space-y-6 pt-4">
                              <FormField control={form.control} name="name" render={({ field }) => (
                                  <FormItem>
                                      <FormLabel>Meeting Name</FormLabel>
                                      <FormControl><Input placeholder="e.g., Weekly Sync" {...field} /></FormControl>
                                      <FormMessage />
                                  </FormItem>
                               )} />
                              <FormField control={form.control} name="date" render={({ field }) => (
                                  <FormItem className="flex flex-col">
                                      <FormLabel>Date</FormLabel>
                                      <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                                          <PopoverTrigger asChild>
                                              <FormControl>
                                                  <Button 
                                                    variant={"outline"} 
                                                    className={cn("w-full pl-3 text-left font-normal h-10 border-zinc-200", !field.value && "text-muted-foreground")}
                                                  >
                                                      {field.value ? format(field.value, "PPP") : <span>Select a date</span>}
                                                      <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                                  </Button>
                                              </FormControl>
                                          </PopoverTrigger>
                                          <PopoverContent className="w-auto p-0" align="start" sideOffset={8}>
                                              <Calendar
                                                  mode="single"
                                                  selected={field.value}
                                                  onSelect={(date) => {
                                                    if (date) {
                                                        field.onChange(date);
                                                        setDatePickerOpen(false);
                                                    }
                                                  }}
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
                                      <FormControl><Input type="time" className="h-10" {...field} /></FormControl>
                                      <FormMessage />
                                  </FormItem>
                               )} />
                              <DialogFooter>
                                  <Button type="submit" disabled={isCreating} className="w-full sm:w-auto">
                                      {isCreating ? 'Scheduling...' : 'Schedule Meeting'}
                                  </Button>
                              </DialogFooter>
                          </form>
                      </Form>
                  </DialogContent>
                </Dialog>

                <Card className="flex flex-col shadow-sm border-zinc-200 transition-all hover:shadow-md">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Video className="h-5 w-5 text-primary" />
                        Join a meeting
                    </CardTitle>
                    <CardDescription>Enter a meeting ID to join an existing call.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Input
                      type="text"
                      placeholder="Meeting ID (e.g., abc-123)"
                      value={meetingId}
                      onChange={(e) => setMeetingId(e.target.value)}
                      className="w-full h-10"
                    />
                  </CardContent>
                  <CardFooter className="mt-auto">
                    <Button onClick={joinMeeting} variant="secondary" className="w-full h-11">Join Meeting</Button>
                  </CardFooter>
                </Card>
              </div>
            </section>

            {upcomingMeetings && upcomingMeetings.length > 0 && (
                <section className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <h2 className="text-2xl font-semibold mb-6">Upcoming Meetings</h2>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {upcomingMeetings.map((meeting) => (
                            <Card key={meeting.id} className="group overflow-hidden border-zinc-200 shadow-sm transition-all hover:shadow-md">
                                <CardHeader className="pb-3">
                                    <div className="flex justify-between items-start">
                                        <CardTitle className="text-xl group-hover:text-primary transition-colors">{meeting.name}</CardTitle>
                                        <div className="bg-primary/10 text-primary p-2 rounded-full">
                                            <CalendarIcon className="h-4 w-4" />
                                        </div>
                                    </div>
                                    <CardDescription className="font-medium text-zinc-600 mt-1">
                                        {meeting.scheduledAt ? format(new Date(meeting.scheduledAt.seconds * 1000), 'PPP') : ''}
                                        <br />
                                        <span className="text-zinc-400 font-normal">
                                            {meeting.scheduledAt ? format(new Date(meeting.scheduledAt.seconds * 1000), 'p') : ''}
                                        </span>
                                    </CardDescription>
                                </CardHeader>
                                <CardFooter className="bg-zinc-50/80 border-t pt-4 pb-4 gap-2">
                                    <Button size="sm" onClick={() => startMeeting(meeting.id)} className="flex-1 shadow-sm">
                                        Start <ArrowRight className="ml-2 h-4 w-4" />
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => copyToClipboard(`${window.location.origin}/room/${meeting.id}`)} className="h-9 w-9 p-0 bg-white">
                                        <Copy className="h-4 w-4" />
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => deleteMeeting(meeting.id)} className="h-9 w-9 p-0 text-zinc-400 hover:text-destructive hover:bg-destructive/5">
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </CardFooter>
                            </Card>
                        ))}
                    </div>
                </section>
            )}
          </div>
        </main>
      </div>
    </AuthGuard>
  );
}
