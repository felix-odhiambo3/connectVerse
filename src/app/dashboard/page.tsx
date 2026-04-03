
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
    // QUOTA: Extreme limits for Spark plan (3 documents)
    return query(
      collection(firestore, 'meetings'), 
      where('hostId', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(3) 
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
      toast({ title: "Session scheduled!" });
      setOpenScheduleDialog(false);
      form.reset();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not schedule.' });
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
      <div className="flex flex-col min-h-screen bg-background text-zinc-900">
        <header className="px-8 h-20 flex items-center border-b bg-white/80 backdrop-blur-md sticky top-0 z-50">
          <Link href="/dashboard" className="flex items-center transition-all hover:scale-105">
            <div className="bg-zinc-900 p-2 rounded-xl mr-3 shadow-lg shadow-zinc-200"><Video className="h-5 w-5 text-white" /></div>
            <span className="font-black text-xl tracking-tighter">ConnectVerse</span>
          </Link>
          <div className="ml-auto flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => auth?.signOut()} className="rounded-full hover:bg-zinc-100"><LogOut className="h-4 w-4" /></Button>
          </div>
        </header>
        <main className="flex-1 flex flex-col items-center p-6 md:p-12 bg-[#F8F9FB]">
          <div className="w-full max-w-6xl space-y-12">
            <section className="space-y-8">
              <div className="flex flex-col gap-2">
                <h2 className="text-4xl font-black tracking-tighter">Welcome back</h2>
                <p className="text-zinc-500 font-medium">Ready for your next session?</p>
              </div>
              
              <div className="grid gap-6 md:grid-cols-3">
                <Card className="flex flex-col shadow-xl border-none bg-zinc-900 text-white rounded-[2rem] overflow-hidden group">
                  <CardHeader className="p-8">
                    <CardTitle className="flex items-center gap-3 text-2xl font-black"><Plus className="h-6 w-6 text-primary-foreground opacity-50" /> Instant</CardTitle>
                    <CardDescription className="text-zinc-400 font-medium">Start a video call immediately.</CardDescription>
                  </CardHeader>
                  <CardFooter className="mt-auto p-8 pt-0">
                    <Button onClick={createInstantMeeting} disabled={isCreating} className="w-full h-14 rounded-2xl bg-white text-zinc-900 font-black uppercase tracking-widest text-[11px] hover:bg-zinc-100">
                      {isCreating ? 'Creating...' : 'Start Now'}
                    </Button>
                  </CardFooter>
                </Card>

                <Dialog open={openScheduleDialog} onOpenChange={setOpenScheduleDialog}>
                  <DialogTrigger asChild>
                    <Card className="flex flex-col cursor-pointer hover:shadow-2xl transition-all shadow-xl border-none rounded-[2rem] overflow-hidden bg-white">
                      <CardHeader className="p-8">
                        <CardTitle className="flex items-center gap-3 text-2xl font-black"><CalendarIcon className="h-6 w-6 text-zinc-400" /> Schedule</CardTitle>
                        <CardDescription className="font-medium text-zinc-500">Plan single or recurring sessions.</CardDescription>
                      </CardHeader>
                      <CardFooter className="mt-auto p-8 pt-0"><Button variant="secondary" className="w-full h-14 rounded-2xl font-black uppercase tracking-widest text-[11px] bg-zinc-100 text-zinc-900">Schedule</Button></CardFooter>
                    </Card>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[500px] rounded-[2.5rem] border-none shadow-2xl">
                    <DialogHeader>
                      <DialogTitle className="text-2xl font-black">Schedule Meeting</DialogTitle>
                      <DialogDescription className="font-medium">Set up your session details (Max 2 for trial).</DialogDescription>
                    </DialogHeader>
                    <Form {...form}>
                      <form onSubmit={form.handleSubmit(handleScheduleSubmit)} className="space-y-6 pt-4">
                        <FormField control={form.control} name="name" render={({ field }) => (
                          <FormItem><FormLabel className="font-black text-[11px] uppercase tracking-widest">Meeting Name</FormLabel><FormControl><Input className="h-12 rounded-xl bg-zinc-50 border-zinc-100" placeholder="e.g., Physics 101" {...field} /></FormControl><FormMessage /></FormItem>
                        )} />
                        <div className="grid grid-cols-2 gap-4">
                          <FormField control={form.control} name="date" render={({ field }) => (
                            <FormItem className="flex flex-col">
                              <FormLabel className="font-black text-[11px] uppercase tracking-widest">Date</FormLabel>
                              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                                <PopoverTrigger asChild>
                                  <FormControl><Button variant="outline" className={cn("h-12 rounded-xl bg-zinc-50 border-zinc-100 text-left font-medium", !field.value && "text-muted-foreground")}>{field.value ? format(field.value, "PPP") : <span>Pick a date</span>}<CalendarIcon className="ml-auto h-4 w-4 opacity-50" /></Button></FormControl>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0 rounded-2xl border-none shadow-2xl" align="start">
                                  <Calendar mode="single" selected={field.value} onSelect={(d) => { if (d) { field.onChange(d); setDatePickerOpen(false); } }} disabled={(d) => d < new Date(new Date().setHours(0,0,0,0))} />
                                </PopoverContent>
                              </Popover>
                            </FormItem>
                          )} />
                          <FormField control={form.control} name="time" render={({ field }) => (
                            <FormItem><FormLabel className="font-black text-[11px] uppercase tracking-widest">Time</FormLabel><FormControl><Input type="time" className="h-12 rounded-xl bg-zinc-50 border-zinc-100" {...field} /></FormControl></FormItem>
                          )} />
                        </div>
                        <div className="p-6 bg-zinc-50 rounded-[2rem] border border-zinc-100 space-y-6">
                          <FormField control={form.control} name="isRecurring" render={({ field }) => (
                            <FormItem className="flex items-center justify-between">
                              <div className="space-y-0.5"><FormLabel className="font-black text-[11px] uppercase tracking-widest">Recurring</FormLabel><FormDescription className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Max 2 sessions</FormDescription></div>
                              <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                            </FormItem>
                          )} />
                          {form.watch('isRecurring') && (
                            <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2">
                              <FormField control={form.control} name="repeatInterval" render={({ field }) => (
                                <FormItem><FormLabel className="font-black text-[11px] uppercase tracking-widest">Pattern</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger className="h-12 rounded-xl bg-white"><SelectValue placeholder="Select interval" /></SelectTrigger></FormControl><SelectContent className="rounded-xl"><SelectItem value="daily">Daily</SelectItem><SelectItem value="weekly">Weekly</SelectItem></SelectContent></Select></FormItem>
                              )} />
                              <FormField control={form.control} name="occurrences" render={({ field }) => (
                                <FormItem><FormLabel className="font-black text-[11px] uppercase tracking-widest">Count</FormLabel><FormControl><Input type="number" min="2" max="2" className="h-12 rounded-xl bg-white" {...field} /></FormControl></FormItem>
                              )} />
                            </div>
                          )}
                        </div>
                        <DialogFooter><Button type="submit" disabled={isCreating} className="w-full h-14 rounded-2xl font-black uppercase tracking-widest text-[11px]">{isCreating ? 'Processing...' : 'Schedule Now'}</Button></DialogFooter>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>

                <Card className="flex flex-col shadow-xl border-none rounded-[2rem] overflow-hidden bg-white">
                  <CardHeader className="p-8">
                    <CardTitle className="flex items-center gap-3 text-2xl font-black"><ArrowRight className="h-6 w-6 text-zinc-400" /> Join</CardTitle>
                    <CardDescription className="font-medium text-zinc-500">Enter a meeting ID or link.</CardDescription>
                  </CardHeader>
                  <CardContent className="px-8 pb-4"><Input placeholder="Meeting ID or Link" value={meetingIdInput} onChange={(e) => setMeetingIdInput(e.target.value)} className="h-12 rounded-xl bg-zinc-50 border-zinc-100" /></CardContent>
                  <CardFooter className="mt-auto p-8 pt-0"><Button onClick={joinMeeting} variant="secondary" className="w-full h-14 rounded-2xl font-black uppercase tracking-widest text-[11px] bg-zinc-100 text-zinc-900">Join Room</Button></CardFooter>
                </Card>
              </div>
            </section>

            {upcomingMeetings.length > 0 && (
              <section className="space-y-8 pb-12">
                <h2 className="text-3xl font-black tracking-tighter">History & Scheduled</h2>
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {upcomingMeetings.map((meeting) => (
                    <Card key={meeting.id} className="group overflow-hidden border-none shadow-lg hover:shadow-2xl transition-all rounded-[2.5rem] bg-white">
                      <CardHeader className="p-8 pb-4">
                        <div className="flex justify-between items-start mb-4">
                           <div className="bg-zinc-50 p-3 rounded-2xl"><Video className="h-5 w-5 text-zinc-900" /></div>
                          {meeting.seriesId && <Repeat className="h-4 w-4 text-zinc-300" />}
                        </div>
                        <CardTitle className="text-xl font-black truncate">{meeting.name}</CardTitle>
                        <CardDescription className="font-bold text-zinc-400 text-xs mt-2 uppercase tracking-widest">
                          {meeting.scheduledAt ? format(new Date(meeting.scheduledAt.seconds * 1000), 'PPP') : 'Active Now'}<br />
                          <span className="opacity-60">{meeting.scheduledAt ? format(new Date(meeting.scheduledAt.seconds * 1000), 'p') : '--'} • {meeting.fixedDurationHours}h Session</span>
                        </CardDescription>
                      </CardHeader>
                      <CardFooter className="p-8 pt-4 gap-3">
                        <Button size="sm" onClick={() => router.push(`/room/${meeting.id}`)} className="flex-1 h-12 rounded-xl font-black text-[10px] uppercase tracking-widest">Start</Button>
                        <Button size="sm" variant="ghost" onClick={() => deleteMeeting(meeting.id)} className="h-12 w-12 rounded-xl text-zinc-300 hover:text-destructive hover:bg-destructive/5"><Trash2 className="h-4 w-4" /></Button>
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
