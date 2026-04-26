
'use client';

import Link from 'next/link';
import { ChevronLeft, ShieldCheck, Lock, Eye, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

export default function PrivacyPage() {
  return (
    <div className="flex flex-col min-h-screen bg-[#F8F9FB]">
      <header className="px-4 md:px-12 h-20 flex items-center border-b bg-white sticky top-0 z-50">
        <Link href="/" className="flex items-center text-zinc-400 hover:text-zinc-900 transition-colors mr-6">
          <ChevronLeft className="h-5 w-5 mr-1" />
          <span className="font-black text-xs uppercase tracking-widest">Back</span>
        </Link>
        <div className="flex items-center">
          <div className="bg-primary p-2 rounded-xl mr-4 shadow-lg shadow-primary/20">
            <ShieldCheck className="h-5 w-5 text-white" />
          </div>
          <h1 className="font-black text-xl tracking-tighter text-zinc-900">Privacy Policy</h1>
        </div>
      </header>

      <main className="flex-1 p-6 md:p-12 lg:p-24 max-w-4xl mx-auto space-y-12">
        <section className="space-y-6">
          <Badge className="bg-primary/10 text-primary border-primary/20 font-black px-4 py-1 rounded-full uppercase tracking-widest text-[10px]">Data Protection</Badge>
          <h2 className="text-4xl md:text-5xl font-black tracking-tighter text-zinc-900 leading-tight">Your Privacy Matters</h2>
          <p className="text-zinc-500 font-medium text-lg leading-relaxed">
            We value your trust. This policy explains how we collect, use, and protect your personal information at ConnectVerse.
          </p>
        </section>

        <div className="space-y-8">
          <Card className="rounded-[2rem] border-none shadow-xl bg-white overflow-hidden">
            <CardHeader className="p-8 md:p-10 pb-4">
              <CardTitle className="text-xl font-black flex items-center gap-3">
                <div className="bg-zinc-100 p-2 rounded-lg"><Eye className="h-5 w-5 text-zinc-900" /></div>
                1. Information We Collect
              </CardTitle>
            </CardHeader>
            <CardContent className="p-8 md:p-10 pt-0 text-zinc-500 font-medium leading-relaxed space-y-4">
              <p>We collect information you provide directly to us:</p>
              <ul className="list-disc pl-5 space-y-2">
                <li>Account details (Name, Email, Username).</li>
                <li>Session participation data (Join/Leave times, active duration).</li>
                <li>Payment identifiers (Phone number used for M-Pesa STK push).</li>
              </ul>
              <p>We do NOT record video or audio calls on our servers unless a session host explicitly enables "Cloud Recording" (currently in beta).</p>
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-none shadow-xl bg-white overflow-hidden">
            <CardHeader className="p-8 md:p-10 pb-4">
              <CardTitle className="text-xl font-black flex items-center gap-3">
                <div className="bg-zinc-100 p-2 rounded-lg"><Server className="h-5 w-5 text-zinc-900" /></div>
                2. How We Use Information
              </CardTitle>
            </CardHeader>
            <CardContent className="p-8 md:p-10 pt-0 text-zinc-500 font-medium leading-relaxed space-y-4">
              <p>Your data is used solely to:</p>
              <ul className="list-disc pl-5 space-y-2">
                <li>Provide video conferencing services.</li>
                <li>Generate accurate attendance reports for hosts.</li>
                <li>Process subscriptions and provide technical support.</li>
              </ul>
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-none shadow-xl bg-white overflow-hidden">
            <CardHeader className="p-8 md:p-10 pb-4">
              <CardTitle className="text-xl font-black flex items-center gap-3">
                <div className="bg-zinc-100 p-2 rounded-lg"><Lock className="h-5 w-5 text-zinc-900" /></div>
                3. Data Security
              </CardTitle>
            </CardHeader>
            <CardContent className="p-8 md:p-10 pt-0 text-zinc-500 font-medium leading-relaxed space-y-4">
              <p>We implement industry-standard security measures including SSL/TLS encryption for all data in transit. Participation metrics are stored securely in Firestore with restricted access based on host ownership.</p>
            </CardContent>
          </Card>
        </div>

        <section className="bg-white border-2 border-primary/20 rounded-[2.5rem] p-10 md:p-16 text-center shadow-2xl">
          <div className="max-w-md mx-auto space-y-6">
            <Lock className="h-12 w-12 mx-auto text-primary" />
            <h3 className="text-2xl font-black tracking-tight text-zinc-900">Your Data, Your Control</h3>
            <p className="text-zinc-500 text-sm font-medium leading-relaxed">You can request a copy of your data or account deletion by contacting our privacy officer at odhiambo3gfelix@gmail.com.</p>
            <Button asChild className="rounded-xl h-12 px-8 font-black uppercase tracking-widest text-[10px] bg-primary">
              <Link href="/manual">Support Center</Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="py-12 border-t bg-white text-center">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">&copy; 2024 ConnectVerse Privacy</p>
      </footer>
    </div>
  );
}
