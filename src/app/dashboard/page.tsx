
'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useFirestore, useUser, useCollection, useMemoFirebase } from '@/firebase';
import { addDoc, collection, serverTimestamp, query, where, doc, writeBatch, limit, orderBy } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import AuthGuard from '@/components/auth/AuthGuard';
import { LogOut, Plus, Video, Calendar as CalendarIcon, Trash2, ArrowRight, Repeat } from 'lucide-react';
import Link from 'next/link';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { format, addWeeks, addDays } from "date-fns";
import { deleteDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const scheduleMeetingSchema = z.object({
  name: z.string().min(3, 'Meeting name must be at least 3 characters.'),
  date: z.date({ required_error: "A date is required." }),
  time: z.string().min(1, 'A time is required.'),
  isRecurring: z.boolean().default(false),
  occurrences: z.string().optional(),
  fixedDurationHours: z.string().min(1, 'Duration is required.'),
  repeatInterval: z.enum(['daily', 'weekly']).optional(),
});

export default function DashboardPage() {
  const [meetingIdInput, setMeetingIdInput] = useState('');
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
      date: new Date(),
      isRecurring: false,
      occurrences: "2",
      fixedDurationHours: "1",
      repeatInterval: "weekly",
    },
  });

  const allUserMeetingsQuery = useMemoFirebase(() => {
    if (!user?.uid || !firestore) return null;
    console.log("Fetching Dashboard Firestore...");
    return query(
      collection(firestore, 'meetings'), 
      where('hostId', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(5) // QUOTA: Keep dashboard load extremely light
    );
  }, [user?.uid, firestore]);

  const { data: allUserMeetings } = useCollection(allUserMeetingsQuery);

  const upcomingMeetings = useMemo(() => {
    if (!allUserMeetings) return [];
    return allUserMeetings
      .filter(meeting => meeting.status === 'scheduled' || meeting.status === 'active')
      .sort((a, b) => {
        const dateA = a.scheduledAt?.seconds || 0;
        const dateB = b.scheduledAt?.seconds || 0;
        return dateA - dateB;
      });
  }, [allUserMeetings]);

  const handleScheduleSubmit = async (values: z.infer<typeof scheduleMeetingSchema>) => {
    if (!user || !firestore) return;
    setIsCreating(true);

    const { name, date, time, isRecurring, occurrences, fixedDurationHours, repeatInterval } = values;
    const [hours, minutes] = time.split(':');
    const baseDate = new Date(date);
    baseDate.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);

    const now = new Date();
    if (baseDate < now) {
      toast({ variant: 'destructive', title: 'Invalid time', description: 'Meeting cannot be in the past.' });
      setIsCreating(false);
      return;
    }

    try {
      const batch = writeBatch(firestore);
      const seriesId = Math.random().toString(36).substr(2, 9);
      const count = isRecurring ? Math.min(parseInt(occurrences || "1", 10), 2) : 1;
      const duration = parseFloat(fixedDurationHours);

      for (let i = 0; i < count; i++) {
        let scheduledAt;
        if (repeatInterval === 'daily') {
          scheduledAt = addDays(baseDate, i);
        } else {
          scheduledAt = addWeeks(baseDate, i);
        }

        const meetingRef = doc(collection(firestore, 'meetings'));
        batch.set(meetingRef, {
          name: isRecurring ? `${name} (Session ${i + 1})` : name,
          hostId: user.uid,
          createdAt: serverTimestamp(),
          scheduledAt: scheduledAt,
          status: 'scheduled',
          seriesId: seriesId,
          fixedDurationHours: duration,
          sessionIndex: i + 1,
          totalSessionsInSeries: count,
          isLocked: false,
          isRecording: false,
          participantPermissions: {
            allowShareScreen: true,
            allowSendReactions: true,
            allowUnmute: true,
            allowStartVideo: true,
          },
        });
      }

      await batch.commit();
      toast({ title: isRecurring ? "Meeting series scheduled!" : "Meeting scheduled!" });
      setOpenScheduleDialog(false);
      form.reset();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not schedule meeting.' });
    } finally {
      setIsCreating(false);
    }
  };

  const createInstantMeeting = async () => {
    if (!user || !firestore) return;
    setIsCreating(true);
    try {
      const newMeetingRef = await addDoc(collection(firestore, 'meetings'), {
        name: 'Instant Meeting',
        hostId: user.uid,
        createdAt: serverTimestamp(),
        status: 'active',
        isLocked: false,
        isRecording: false,
        fixedDurationHours: 1, 
        participantPermissions: {
          allowShareScreen: true,
          allowSendReactions: true,
          allowUnmute: true,
          allowStartVideo: true,
        },
      });
      router.push(`/room/${newMeetingRef.id}`);
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error creating meeting' });
    } finally {
      setIsCreating(false);
    }
  };

  const joinMeeting = () => {
    let id = meetingIdInput.trim();
    if (id.includes('/room/')) {
      const parts = id.split('/room/');
      id = parts[parts.length - 1].split('?')[0];
    }
    if (id) router.push(`/room/${id}`);
    else toast({ variant: 'destructive', title: 'Invalid ID' });
  };

  const deleteMeeting = (meetingId: string) => {
    if (!firestore) return;
    deleteDocumentNonBlocking(doc(firestore, 'meetings', meetingId));
    toast({ title: "Meeting deleted." });
  };

  return (
    <AuthGuard>
      <div className="flex flex-col min-h-screen bg-background">
        <header className="px-4 lg:px-6 h-16 flex items-center border-b bg-card">
          <Link href="/dashboard" className="flex items-center transition-opacity hover:opacity-80">
            <div className="bg-primary p-1.5 rounded-lg mr-2"><Video className="h-5 w-5 text-primary-foreground" /></div>
            <span className="font-bold text-lg tracking-tight">ConnectVerse</span>
          </Link>
          <div className="ml-auto">
            <Button variant="ghost" size="icon" onClick={() => auth?.signOut()} className="rounded-full"><LogOut className="h-4 w-4" /></Button>
          </div>
        </header>
        <main className="flex-1 flex flex-col items-center p-4 md:p-12 bg-zinc-50/50">
          <div className="w-full max-w-5xl space-y-12">
            <section>
              <h2 className="text-3xl font-bold tracking-tight mb-8">Quick Start</h2>
              <div className="grid gap-6 md:grid-cols-3">
                <Card className="flex flex-col shadow-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5 text-primary" /> Instant Meeting</CardTitle>
                    <CardDescription>Start a video call immediately.</CardDescription>
                  </CardHeader>
                  <CardFooter className="mt-auto">
                    <Button onClick={createInstantMeeting} disabled={isCreating} className="w-full">
                      {isCreating ? 'Creating...' : 'Start Now'}
                    </Button>
                  </CardFooter>
                </Card>

                <Dialog open={openScheduleDialog} onOpenChange={setOpenScheduleDialog}>
                  <DialogTrigger asChild>
                    <Card className="flex flex-col cursor-pointer hover:border-primary transition-all shadow-sm">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2"><CalendarIcon className="h-5 w-5 text-primary" /> Schedule Session</CardTitle>
                        <CardDescription>Plan single or recurring sessions.</CardDescription>
                      </CardHeader>
                      <CardFooter className="mt-auto"><Button variant="outline" className="w-full">Schedule</Button></CardFooter>
                    </Card>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                      <DialogTitle>Schedule Meeting</DialogTitle>
                      <DialogDescription>Set up your session details and recurrence pattern (Max 2).</DialogDescription>
                    </DialogHeader>
                    <Form {...form}>
                      <form onSubmit={form.handleSubmit(handleScheduleSubmit)} className="space-y-4 pt-4">
                        <FormField control={form.control} name="name" render={({ field }) => (
                          <FormItem><FormLabel>Meeting Name</FormLabel><FormControl><Input placeholder="e.g., Physics 101" {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <div className="grid grid-cols-2 gap-4">
                          <FormField control={form.control} name="date" render={({ field }) => (
                            <FormItem className="flex flex-col">
                              <FormLabel>Date</FormLabel>
                              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                                <PopoverTrigger asChild>
                                  <FormControl><Button variant="outline" className={cn("pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>{field.value ? format(field.value, "PPP") : <span>Pick a date</span>}<CalendarIcon className="ml-auto h-4 w-4 opacity-50" /></Button></FormControl>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                  <Calendar mode="single" selected={field.value} onSelect={(d) => { if (d) { field.onChange(d); setDatePickerOpen(false); } }} disabled={(d) => d < new Date(new Date().setHours(0,0,0,0))} />
                                </PopoverContent>
                              </Popover>
                            </FormItem>
                          )} />
                          <FormField control={form.control} name="time" render={({ field }) => (
                            <FormItem><FormLabel>Start Time</FormLabel><FormControl><Input type="time" {...field} /></FormControl></FormItem>
                          )} />
                        </div>
                        <FormField control={form.control} name="fixedDurationHours" render={({ field }) => (
                          <FormItem><FormLabel>Session Duration (Hours)</FormLabel><FormControl><Input type="number" min="1" max="8" {...field} /></FormControl><FormDescription>Hours earned for attending this session.</FormDescription></FormItem>
                        )} />
                        <div className="p-4 bg-zinc-50 rounded-lg border space-y-4">
                          <FormField control={form.control} name="isRecurring" render={({ field }) => (
                            <FormItem className="flex items-center justify-between">
                              <div className="space-y-0.5"><FormLabel>Recurring Meeting</FormLabel><FormDescription>Create up to 2 sessions at once.</FormDescription></div>
                              <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                            </FormItem>
                          )} />
                          {form.watch('isRecurring') && (
                            <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2">
                              <FormField control={form.control} name="repeatInterval" render={({ field }) => (
                                <FormItem><FormLabel>Pattern</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select interval" /></SelectTrigger></FormControl><SelectContent><SelectItem value="daily">Daily</SelectItem><SelectItem value="weekly">Weekly</SelectItem></SelectContent></Select></FormItem>
                              )} />
                              <FormField control={form.control} name="occurrences" render={({ field }) => (
                                <FormItem><FormLabel>Total Sessions</FormLabel><FormControl><Input type="number" min="2" max="2" {...field} /></FormControl></FormItem>
                              )} />
                            </div>
                          )}
                        </div>
                        <DialogFooter><Button type="submit" disabled={isCreating} className="w-full">{isCreating ? 'Scheduling...' : 'Confirm Schedule'}</Button></DialogFooter>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>

                <Card className="flex flex-col shadow-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><ArrowRight className="h-5 w-5 text-primary" /> Join Meeting</CardTitle>
                    <CardDescription>Enter a meeting ID or link.</CardDescription>
                  </CardHeader>
                  <CardContent><Input placeholder="Meeting ID or Link" value={meetingIdInput} onChange={(e) => setMeetingIdInput(e.target.value)} /></CardContent>
                  <CardFooter className="mt-auto"><Button onClick={joinMeeting} variant="secondary" className="w-full">Join</Button></CardFooter>
                </Card>
              </div>
            </section>

            {upcomingMeetings.length > 0 && (
              <section>
                <h2 className="text-2xl font-semibold mb-6">Upcoming Sessions</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {upcomingMeetings.map((meeting) => (
                    <Card key={meeting.id} className="group overflow-hidden border-zinc-200 shadow-sm hover:shadow-md transition-all">
                      <CardHeader className="pb-3">
                        <div className="flex justify-between items-start">
                          <CardTitle className="text-lg truncate mr-2">{meeting.name}</CardTitle>
                          {meeting.seriesId && <Repeat className="h-4 w-4 text-primary opacity-50" />}
                        </div>
                        <CardDescription className="font-medium text-zinc-600 mt-1">
                          {meeting.scheduledAt ? format(new Date(meeting.scheduledAt.seconds * 1000), 'PPP') : 'No date'}<br />
                          <span className="text-zinc-400 font-normal">{meeting.scheduledAt ? format(new Date(meeting.scheduledAt.seconds * 1000), 'p') : '--'} • {meeting.fixedDurationHours}h Session</span>
                        </CardDescription>
                      </CardHeader>
                      <CardFooter className="bg-zinc-50/80 border-t pt-4 pb-4 gap-2">
                        <Button size="sm" onClick={() => router.push(`/room/${meeting.id}`)} className="flex-1">Start</Button>
                        <Button size="sm" variant="ghost" onClick={() => deleteMeeting(meeting.id)} className="h-9 w-9 p-0 text-zinc-400 hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
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
