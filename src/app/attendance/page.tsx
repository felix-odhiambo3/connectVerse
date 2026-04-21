
'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, useFirestore, useUser, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where, orderBy, doc, deleteDoc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import AuthGuard from '@/components/auth/AuthGuard';
import { 
  ChevronLeft, 
  Search, 
  Calendar as CalendarIcon, 
  Users, 
  Trash2, 
  FileText, 
  Download,
  BarChart3,
  Video
} from 'lucide-react';
import Link from 'next/link';
import { format } from "date-fns";
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from '@/components/ui/scroll-area';

export default function AttendanceRecordsPage() {
  const router = useRouter();
  const firestore = useFirestore();
  const { user } = useUser();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const attendanceQuery = useMemoFirebase(() => {
    if (!user?.uid || !firestore) return null;
    return query(
      collection(firestore, 'seriesAttendance'),
      where('hostId', '==', user.uid),
      orderBy('recordedAt', 'desc')
    );
  }, [user?.uid, firestore]);

  const { data: rawRecords, isLoading } = useCollection(attendanceQuery);

  const sessions = useMemo(() => {
    if (!rawRecords) return [];
    const grouped = rawRecords.reduce((acc: any, record) => {
      if (!acc[record.meetingId]) {
        acc[record.meetingId] = {
          id: record.meetingId,
          name: record.meetingName,
          date: record.recordedAt,
          participants: [],
        };
      }
      acc[record.meetingId].participants.push(record);
      return acc;
    }, {});
    
    return Object.values(grouped).filter((s: any) => 
      s.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [rawRecords, searchQuery]);

  const selectedSession = useMemo(() => {
    if (!selectedSessionId) return null;
    return sessions.find((s: any) => s.id === selectedSessionId);
  }, [sessions, selectedSessionId]);

  const deleteSession = async (meetingId: string) => {
    if (!firestore || !rawRecords) return;
    const toDelete = rawRecords.filter(r => r.meetingId === meetingId);
    try {
      await Promise.all(toDelete.map(r => deleteDoc(doc(firestore, 'seriesAttendance', r.id))));
      toast({ title: "Session record deleted." });
      if (selectedSessionId === meetingId) setSelectedSessionId(null);
    } catch (e) {
      toast({ variant: 'destructive', title: "Delete failed" });
    }
  };

  const exportToCSV = (session: any) => {
    const headers = ["Name", "Duration", "Attendance %", "Status"];
    const rows = session.participants.map((p: any) => [
      p.userName,
      `${Math.floor(p.totalTimeAttended / 60)}m ${p.totalTimeAttended % 60}s`,
      `${p.attendancePercentage}%`,
      p.status
    ]);
    
    const content = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${session.name}_attendance.csv`);
    link.click();
    toast({ title: "Exported successfully" });
  };

  return (
    <AuthGuard>
      <div className="flex flex-col min-h-screen bg-[#F8F9FB]">
        <header className="px-4 md:px-8 h-16 md:h-20 flex items-center border-b bg-white sticky top-0 z-50">
          <Link href="/dashboard" className="flex items-center text-zinc-400 hover:text-zinc-900 transition-colors mr-6">
            <ChevronLeft className="h-5 w-5 mr-1" />
            <span className="font-bold text-sm uppercase tracking-widest">Back</span>
          </Link>
          <div className="flex items-center">
            <div className="bg-zinc-900 p-1.5 rounded-lg mr-3">
              <BarChart3 className="h-4 w-4 text-white" />
            </div>
            <h1 className="font-black text-lg md:text-xl tracking-tighter">Attendance History</h1>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-12 overflow-hidden">
          <div className="max-w-7xl mx-auto h-full flex flex-col md:flex-row gap-8">
            <div className={cn("flex-1 flex flex-col gap-6", selectedSessionId && "hidden md:flex")}>
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                <Input 
                  placeholder="Search by session name..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-11 h-12 md:h-14 rounded-2xl bg-white border-none shadow-lg shadow-zinc-200/50 font-medium"
                />
              </div>

              <ScrollArea className="flex-1 rounded-[2.5rem]">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pb-12">
                  {isLoading ? (
                    Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-48 rounded-[2rem]" />)
                  ) : sessions.length > 0 ? (
                    sessions.map((session: any) => (
                      <Card 
                        key={session.id} 
                        onClick={() => setSelectedSessionId(session.id)}
                        className={cn(
                          "group cursor-pointer border-none shadow-xl hover:shadow-2xl transition-all rounded-[2rem] overflow-hidden bg-white",
                          selectedSessionId === session.id && "ring-4 ring-zinc-900"
                        )}
                      >
                        <CardHeader className="p-6 md:p-8 pb-4">
                          <div className="flex justify-between items-start mb-4">
                            <div className="bg-zinc-50 p-3 rounded-2xl"><Video className="h-5 w-5 text-zinc-900" /></div>
                            <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); deleteSession(session.id); }} className="text-zinc-300 hover:text-destructive hover:bg-destructive/5 rounded-xl"><Trash2 className="h-4 w-4" /></Button>
                          </div>
                          <CardTitle className="text-xl font-black truncate">{session.name}</CardTitle>
                          <CardDescription className="font-bold text-zinc-400 text-[10px] uppercase tracking-widest mt-2">
                            {session.date ? format(session.date.toDate(), 'PPP p') : 'Unknown Date'}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="p-6 md:p-8 pt-0">
                          <div className="flex items-center gap-6 mt-4">
                            <div className="flex flex-col">
                              <span className="text-2xl font-black">{session.participants.length}</span>
                              <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Participants</span>
                            </div>
                            <Separator orientation="vertical" className="h-8 bg-zinc-100" />
                            <div className="flex flex-col">
                              <span className="text-2xl font-black text-green-500">
                                {session.participants.filter((p: any) => p.status === 'Present').length}
                              </span>
                              <span className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Present</span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))
                  ) : (
                    <div className="col-span-full py-24 text-center">
                      <FileText className="h-16 w-16 text-zinc-200 mx-auto mb-6" />
                      <h2 className="text-xl font-black text-zinc-400">No records found</h2>
                      <p className="text-zinc-500 font-medium">Recorded attendance sessions will appear here.</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>

            {selectedSession ? (
              <div className="w-full md:w-[450px] lg:w-[550px] flex flex-col h-full bg-white rounded-[2.5rem] md:rounded-[3.5rem] shadow-2xl overflow-hidden animate-in slide-in-from-right duration-300">
                <div className="p-8 md:p-12 pb-6 border-b">
                  <div className="flex justify-between items-start mb-6">
                    <Button variant="ghost" size="icon" onClick={() => setSelectedSessionId(null)} className="md:hidden -ml-4 mb-2"><ChevronLeft /></Button>
                    <div className="flex flex-col gap-2">
                       <h2 className="text-2xl md:text-3xl font-black tracking-tighter leading-none">{selectedSession.name}</h2>
                       <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">{selectedSession.date ? format(selectedSession.date.toDate(), 'PPP p') : ''}</p>
                    </div>
                    <Button onClick={() => exportToCSV(selectedSession)} size="sm" className="rounded-xl h-10 px-4 font-black uppercase text-[9px] tracking-widest shadow-lg">
                      Export <Download className="ml-2 h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                
                <ScrollArea className="flex-1">
                  <div className="p-8 md:p-12 pt-6">
                    <div className="rounded-[2rem] border border-zinc-100 overflow-hidden">
                      <Table>
                        <TableHeader className="bg-zinc-50">
                          <TableRow>
                            <TableHead className="font-black text-[9px] uppercase tracking-widest">Name</TableHead>
                            <TableHead className="font-black text-[9px] uppercase tracking-widest">Stats</TableHead>
                            <TableHead className="font-black text-[9px] uppercase tracking-widest text-right">Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedSession.participants.map((record: any) => (
                            <TableRow key={record.id}>
                              <TableCell className="font-bold text-xs">{record.userName}</TableCell>
                              <TableCell className="text-zinc-500 font-medium text-[11px]">
                                {Math.floor(record.totalTimeAttended / 60)}m {record.totalTimeAttended % 60}s ({record.attendancePercentage}%)
                              </TableCell>
                              <TableCell className="text-right">
                                <Badge variant={record.status === 'Present' ? 'secondary' : 'destructive'} className={cn(
                                  "font-black text-[8px] uppercase tracking-widest",
                                  record.status === 'Present' ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                                )}>
                                  {record.status}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </ScrollArea>
              </div>
            ) : !isLoading && sessions.length > 0 && (
              <div className="hidden md:flex flex-1 items-center justify-center bg-zinc-50 rounded-[3.5rem] border-2 border-dashed border-zinc-200">
                <div className="text-center space-y-4">
                  <div className="h-16 w-16 bg-white rounded-[1.5rem] flex items-center justify-center mx-auto shadow-sm"><Search className="h-6 w-6 text-zinc-300" /></div>
                  <p className="text-sm font-black text-zinc-400 uppercase tracking-widest">Select a session to view details</p>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </AuthGuard>
  );
}

