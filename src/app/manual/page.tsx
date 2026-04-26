
'use client';

import Link from 'next/link';
import { ChevronLeft, BookOpen, Video, Users, BarChart3, ShieldCheck, Zap, Smartphone, ArrowRight, Mail, Phone, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

export default function ManualPage() {
  return (
    <div className="flex flex-col min-h-screen bg-[#F8F9FB]">
      <header className="px-4 md:px-12 h-20 flex items-center border-b bg-white sticky top-0 z-50">
        <Link href="/" className="flex items-center text-zinc-400 hover:text-zinc-900 transition-colors mr-6">
          <ChevronLeft className="h-5 w-5 mr-1" />
          <span className="font-black text-xs uppercase tracking-widest">Back</span>
        </Link>
        <div className="flex items-center">
          <div className="bg-primary p-2 rounded-xl mr-4 shadow-lg shadow-primary/20">
            <BookOpen className="h-5 w-5 text-white" />
          </div>
          <h1 className="font-black text-xl tracking-tighter text-zinc-900">User Manual</h1>
        </div>
      </header>

      <main className="flex-1 p-6 md:p-12 lg:p-24 max-w-5xl mx-auto space-y-16">
        <section className="space-y-6">
          <Badge className="bg-primary/10 text-primary border-primary/20 font-black px-4 py-1 rounded-full uppercase tracking-widest text-[10px]">Documentation</Badge>
          <h2 className="text-4xl md:text-6xl font-black tracking-tighter text-zinc-900 leading-none">Getting Started with ConnectVerse</h2>
          <p className="text-zinc-500 font-medium text-lg leading-relaxed">
            ConnectVerse is more than just a video tool; it's an accountability engine. Follow this guide to master real-time attendance tracking and engagement metrics.
          </p>
        </section>

        <div className="grid gap-8">
          <Card className="rounded-[2.5rem] border-none shadow-xl overflow-hidden bg-white">
            <CardHeader className="p-8 md:p-12 pb-4">
              <CardTitle className="text-2xl font-black flex items-center gap-3">
                <div className="bg-zinc-900 p-2 rounded-lg"><Zap className="h-5 w-5 text-white" /></div>
                1. Account Setup
              </CardTitle>
            </CardHeader>
            <CardContent className="p-8 md:p-12 pt-0 space-y-4">
              <p className="text-zinc-500 font-medium">Create your account using the <Link href="/register" className="text-primary font-bold hover:underline">Sign Up</Link> page. Once logged in, you'll be redirected to your personal dashboard where you can manage all your sessions.</p>
            </CardContent>
          </Card>

          <Card className="rounded-[2.5rem] border-none shadow-xl overflow-hidden bg-white">
            <CardHeader className="p-8 md:p-12 pb-4">
              <CardTitle className="text-2xl font-black flex items-center gap-3">
                <div className="bg-zinc-900 p-2 rounded-lg"><Video className="h-5 w-5 text-white" /></div>
                2. Managing Meetings
              </CardTitle>
            </CardHeader>
            <CardContent className="p-8 md:p-12 pt-0 space-y-6">
              <div className="space-y-4">
                <h4 className="font-black text-sm uppercase tracking-widest text-zinc-900">Instant Meetings</h4>
                <p className="text-zinc-500 font-medium">Click <strong>"Start Now"</strong> to create a room immediately. You'll get a unique URL to share with participants.</p>
              </div>
              <Separator />
              <div className="space-y-4">
                <h4 className="font-black text-sm uppercase tracking-widest text-zinc-900">Scheduled Sessions</h4>
                <p className="text-zinc-500 font-medium">Use the <strong>"Schedule"</strong> card to set a future date and time. You can also create recurring sessions (Daily or Weekly) for long-term courses or workshops.</p>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[2.5rem] border-none shadow-xl overflow-hidden bg-white">
            <CardHeader className="p-8 md:p-12 pb-4">
              <CardTitle className="text-2xl font-black flex items-center gap-3">
                <div className="bg-zinc-900 p-2 rounded-lg"><BarChart3 className="h-5 w-5 text-white" /></div>
                3. The Participation Engine
              </CardTitle>
            </CardHeader>
            <CardContent className="p-8 md:p-12 pt-0 space-y-8">
              <p className="text-zinc-500 font-medium">Our system goes beyond just "logging in." Here is how we calculate attendance:</p>
              <div className="grid md:grid-cols-2 gap-6">
                <div className="p-6 bg-green-50 rounded-2xl border border-green-100 space-y-2">
                  <h5 className="font-black text-xs uppercase tracking-widest text-green-700">The 70% Rule</h5>
                  <p className="text-[11px] font-bold text-green-600 leading-relaxed">A participant is only marked as "Present" if they stay for at least 70% of the total session duration. Disconnects are handled automatically—we accumulate active time across rejoins.</p>
                </div>
                <div className="p-6 bg-blue-50 rounded-2xl border border-blue-100 space-y-2">
                  <h5 className="font-black text-xs uppercase tracking-widest text-blue-700">15-Min Buffer</h5>
                  <p className="text-[11px] font-bold text-blue-600 leading-relaxed">For scheduled meetings, users joining more than 15 minutes after the start time are automatically flagged as "Late" in the final report.</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[2.5rem] border-none shadow-xl overflow-hidden bg-white">
            <CardHeader className="p-8 md:p-12 pb-4">
              <CardTitle className="text-2xl font-black flex items-center gap-3">
                <div className="bg-zinc-900 p-2 rounded-lg"><Smartphone className="h-5 w-5 text-white" /></div>
                4. Billing & Upgrades
              </CardTitle>
            </CardHeader>
            <CardContent className="p-8 md:p-12 pt-0 space-y-4">
              <p className="text-zinc-500 font-medium">Upgrade to Starter or Pro plans via <strong>M-Pesa</strong>. Clicking "Buy Plan" opens a secure payment modal. Enter your phone number (254XXXXXXXXX) and follow the STK Push instructions on your phone. Your account features unlock instantly upon confirmation.</p>
            </CardContent>
          </Card>
        </div>

        <section className="bg-white rounded-[3rem] p-8 md:p-16 shadow-2xl border border-zinc-100">
          <div className="text-center space-y-12">
            <div className="space-y-4">
              <h3 className="text-3xl font-black tracking-tighter">Still need help?</h3>
              <p className="text-zinc-500 font-medium">Reach out to our support team directly via any of these channels.</p>
            </div>
            
            <div className="grid sm:grid-cols-3 gap-6">
              <Button asChild variant="outline" className="h-20 rounded-2xl border-2 hover:bg-green-50 hover:border-green-200 group transition-all">
                <Link href="https://wa.me/254748809701">
                  <div className="flex flex-col items-center gap-1">
                    <MessageSquare className="h-5 w-5 text-green-500 group-hover:scale-110 transition-transform" />
                    <span className="font-black text-[10px] uppercase tracking-widest">WhatsApp</span>
                  </div>
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-20 rounded-2xl border-2 hover:bg-blue-50 hover:border-blue-200 group transition-all">
                <Link href="tel:+254748809701">
                  <div className="flex flex-col items-center gap-1">
                    <Phone className="h-5 w-5 text-blue-500 group-hover:scale-110 transition-transform" />
                    <span className="font-black text-[10px] uppercase tracking-widest">Call Now</span>
                  </div>
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-20 rounded-2xl border-2 hover:bg-primary/5 hover:border-primary/20 group transition-all">
                <Link href="mailto:odhiambo3gfelix@gmail.com">
                  <div className="flex flex-col items-center gap-1">
                    <Mail className="h-5 w-5 text-primary group-hover:scale-110 transition-transform" />
                    <span className="font-black text-[10px] uppercase tracking-widest">Email Us</span>
                  </div>
                </Link>
              </Button>
            </div>

            <Separator />

            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
              <Button asChild size="lg" className="h-16 px-12 rounded-2xl font-black uppercase tracking-widest text-[11px] shadow-2xl shadow-primary/40">
                <Link href="/dashboard">Go to Dashboard <ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="py-12 border-t bg-white text-center">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">&copy; 2024 ConnectVerse Manual v1.0</p>
      </footer>
    </div>
  );
}
