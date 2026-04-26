
'use client';

import Link from 'next/link';
import { ChevronLeft, ShieldCheck, Scale, FileText, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

export default function TermsPage() {
  return (
    <div className="flex flex-col min-h-screen bg-[#F8F9FB]">
      <header className="px-4 md:px-12 h-20 flex items-center border-b bg-white sticky top-0 z-50">
        <Link href="/" className="flex items-center text-zinc-400 hover:text-zinc-900 transition-colors mr-6">
          <ChevronLeft className="h-5 w-5 mr-1" />
          <span className="font-black text-xs uppercase tracking-widest">Back</span>
        </Link>
        <div className="flex items-center">
          <div className="bg-zinc-900 p-2 rounded-xl mr-4">
            <Scale className="h-5 w-5 text-white" />
          </div>
          <h1 className="font-black text-xl tracking-tighter text-zinc-900">Terms of Service</h1>
        </div>
      </header>

      <main className="flex-1 p-6 md:p-12 lg:p-24 max-w-4xl mx-auto space-y-12">
        <section className="space-y-6">
          <Badge className="bg-zinc-100 text-zinc-900 border-zinc-200 font-black px-4 py-1 rounded-full uppercase tracking-widest text-[10px]">Legal Agreement</Badge>
          <h2 className="text-4xl md:text-5xl font-black tracking-tighter text-zinc-900 leading-tight">ConnectVerse Terms & Conditions</h2>
          <p className="text-zinc-500 font-medium text-lg leading-relaxed">
            Last updated: May 20, 2024. Please read these terms carefully before using our platform.
          </p>
        </section>

        <div className="space-y-8">
          <Card className="rounded-[2rem] border-none shadow-xl bg-white overflow-hidden">
            <CardHeader className="p-8 md:p-10 pb-4">
              <CardTitle className="text-xl font-black flex items-center gap-3">
                1. Acceptance of Terms
              </CardTitle>
            </CardHeader>
            <CardContent className="p-8 md:p-10 pt-0 text-zinc-500 font-medium leading-relaxed space-y-4">
              <p>By accessing or using ConnectVerse, you agree to be bound by these Terms of Service. If you disagree with any part of the terms, you may not access the service.</p>
              <p>ConnectVerse provides video conferencing and attendance tracking tools. We reserve the right to modify these terms at any time.</p>
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-none shadow-xl bg-white overflow-hidden">
            <CardHeader className="p-8 md:p-10 pb-4">
              <CardTitle className="text-xl font-black flex items-center gap-3">
                2. User Accounts
              </CardTitle>
            </CardHeader>
            <CardContent className="p-8 md:p-10 pt-0 text-zinc-500 font-medium leading-relaxed space-y-4">
              <p>When you create an account, you must provide accurate and complete information. You are responsible for safeguarding your password and for any activities under your account.</p>
              <p>Failure to provide accurate information constitutes a breach of terms, which may result in immediate termination of your account.</p>
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-none shadow-xl bg-white overflow-hidden">
            <CardHeader className="p-8 md:p-10 pb-4">
              <CardTitle className="text-xl font-black flex items-center gap-3">
                3. Participation & Attendance Rules
              </CardTitle>
            </CardHeader>
            <CardContent className="p-8 md:p-10 pt-0 text-zinc-500 font-medium leading-relaxed space-y-4">
              <p>ConnectVerse uses proprietary algorithms to determine "Presence." Users agree that:</p>
              <ul className="list-disc pl-5 space-y-2">
                <li>A minimum 70% active session duration is required to be marked "Present."</li>
                <li>Lateness is determined by the session host's configured buffer (default 15 minutes).</li>
                <li>Automated logs are final unless explicitly disputed with the session host.</li>
              </ul>
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-none shadow-xl bg-white overflow-hidden">
            <CardHeader className="p-8 md:p-10 pb-4">
              <CardTitle className="text-xl font-black flex items-center gap-3">
                4. Payments & M-Pesa
              </CardTitle>
            </CardHeader>
            <CardContent className="p-8 md:p-10 pt-0 text-zinc-500 font-medium leading-relaxed space-y-4">
              <p>Payments are processed via M-Pesa. Subscriptions are non-refundable except as required by law. Once an STK push is confirmed, service upgrades are immediate.</p>
            </CardContent>
          </Card>
        </div>

        <section className="bg-zinc-900 rounded-[2.5rem] p-10 md:p-16 text-white text-center">
          <div className="max-w-md mx-auto space-y-6">
            <Scale className="h-12 w-12 mx-auto text-primary" />
            <h3 className="text-2xl font-black tracking-tight">Questions about our Terms?</h3>
            <p className="text-zinc-400 text-sm font-medium">If you have any questions regarding this agreement, please contact us at odhiambo3gfelix@gmail.com.</p>
            <Button asChild className="rounded-xl h-12 px-8 font-black uppercase tracking-widest text-[10px]">
              <Link href="/manual">View Documentation</Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="py-12 border-t bg-white text-center">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">&copy; 2024 ConnectVerse Legal</p>
      </footer>
    </div>
  );
}
