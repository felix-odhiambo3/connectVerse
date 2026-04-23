'use client';

import { useUser } from '@/firebase';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { 
  ArrowRight, 
  Video, 
  Menu, 
  CheckCircle2, 
  Clock, 
  Users, 
  ShieldCheck, 
  Zap, 
  BarChart3, 
  XCircle, 
  AlertCircle, 
  Building2, 
  GraduationCap, 
  Globe
} from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export default function LandingPage() {
  const { user, isUserLoading } = useUser();

  const NavItems = () => (
    <div className="flex flex-col sm:flex-row items-center gap-6 sm:gap-8">
      <Link href="#features" className="text-sm font-bold text-zinc-600 hover:text-primary transition-colors">Features</Link>
      <Link href="#pricing" className="text-sm font-bold text-zinc-600 hover:text-primary transition-colors">Pricing</Link>
      {isUserLoading ? (
        <div className="w-20 h-8 bg-zinc-100 animate-pulse rounded-lg" />
      ) : user ? (
        <Button asChild className="rounded-full px-6 font-bold shadow-lg shadow-primary/20">
          <Link href="/dashboard">Go to Dashboard</Link>
        </Button>
      ) : (
        <div className="flex items-center gap-4">
          <Link href="/login" className="text-sm font-bold text-zinc-600 hover:text-primary transition-colors">Login</Link>
          <Button asChild className="rounded-full px-6 font-bold shadow-lg shadow-primary/20">
            <Link href="/register">Get Started</Link>
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col min-h-screen bg-background selection:bg-accent/30">
      {/* Navigation */}
      <header className="px-4 lg:px-12 h-20 flex items-center border-b sticky top-0 bg-background/80 backdrop-blur-xl z-[100]">
        <Link href="/" className="flex items-center gap-3 transition-all hover:scale-105">
          <div className="bg-primary p-2 rounded-2xl shadow-lg shadow-primary/30">
            <Video className="h-6 w-6 text-white" />
          </div>
          <span className="font-black text-2xl tracking-tighter text-primary">ConnectVerse</span>
        </Link>
        <nav className="ml-auto hidden sm:block">
          <NavItems />
        </nav>
        <div className="ml-auto sm:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-xl">
                <Menu className="h-6 w-6" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[300px] pt-12 rounded-l-[2rem]">
              <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
              <div className="flex flex-col gap-8">
                <NavItems />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="relative w-full py-20 lg:py-32 xl:py-48 overflow-hidden">
          <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/4 w-[600px] h-[600px] bg-accent/20 rounded-full blur-[120px] pointer-events-none" />
          <div className="absolute bottom-0 left-0 translate-y-1/2 -translate-x-1/4 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
          
          <div className="container px-4 md:px-6 relative">
            <div className="flex flex-col items-center space-y-10 text-center">
              <div className="space-y-6 max-w-4xl">
                <Badge variant="outline" className="px-4 py-1.5 rounded-full border-primary/20 text-primary font-black uppercase tracking-widest text-[10px] bg-white/50 backdrop-blur-sm">
                  Revolutionizing Real-Time Attendance
                </Badge>
                <h1 className="text-5xl font-black tracking-tighter sm:text-6xl md:text-7xl lg:text-8xl/none text-zinc-900 text-balance leading-[0.95]">
                  Smart Attendance <br /> 
                  <span className="text-primary italic">Actually</span> Tracks Participation
                </h1>
                <p className="mx-auto max-w-[800px] text-zinc-500 font-medium md:text-xl/relaxed lg:text-2xl/relaxed">
                  Stop counting heads. Start measuring engagement. ConnectVerse distinguishes between "just joined" and "actively attended" with advanced accumulative tracking.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-6 w-full sm:w-auto justify-center">
                <Button asChild size="lg" className="h-16 px-10 rounded-2xl font-black uppercase tracking-widest text-xs shadow-2xl shadow-primary/40 hover:scale-105 transition-all">
                  <Link href="/register">
                    Start Free <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="h-16 px-10 rounded-2xl font-black uppercase tracking-widest text-xs border-2 hover:bg-zinc-50">
                  <Link href="#features">Explore Features</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Problem Section */}
        <section className="w-full py-24 bg-white">
          <div className="container px-4 md:px-6">
            <div className="grid lg:grid-cols-2 gap-16 items-center">
              <div className="space-y-8">
                <h2 className="text-4xl md:text-5xl font-black tracking-tighter text-zinc-900">
                  The "Present But Absent" <br /> Problem
                </h2>
                <div className="space-y-6">
                  {[
                    { icon: Clock, title: "Fake Attendance", desc: "Users joining for 2 minutes just to be marked 'present'.", color: "text-red-500" },
                    { icon: Clock, title: "Late Arrivals", desc: "Traditional tools don't penalize joining 45 minutes into a 1-hour session.", color: "text-orange-500" },
                    { icon: AlertCircle, title: "Manual Chaos", desc: "Taking screenshots of participant lists is inefficient and prone to error.", color: "text-amber-500" }
                  ].map((item, i) => (
                    <div key={i} className="flex gap-4 p-6 rounded-3xl bg-zinc-50 border border-zinc-100 hover:shadow-lg transition-all">
                      <div className={cn("p-3 rounded-2xl bg-white shadow-sm", item.color)}>
                        <item.icon className="h-6 w-6" />
                      </div>
                      <div>
                        <h3 className="font-black text-lg text-zinc-900">{item.title}</h3>
                        <p className="text-zinc-500 font-medium">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="relative">
                <div className="absolute inset-0 bg-primary/5 rounded-[4rem] -rotate-3 scale-105" />
                <div className="relative bg-zinc-900 rounded-[3.5rem] p-8 md:p-12 shadow-2xl text-white">
                   <div className="space-y-6">
                      <div className="flex items-center gap-3">
                         <div className="w-3 h-3 rounded-full bg-red-500" />
                         <div className="w-3 h-3 rounded-full bg-yellow-500" />
                         <div className="w-3 h-3 rounded-full bg-green-500" />
                      </div>
                      <div className="space-y-4">
                         <div className="h-4 w-3/4 bg-white/10 rounded-full" />
                         <div className="h-4 w-1/2 bg-white/10 rounded-full" />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                         <div className="p-6 bg-white/5 rounded-3xl border border-white/10 text-center">
                            <span className="text-3xl font-black text-red-400">42%</span>
                            <p className="text-[10px] uppercase font-black tracking-widest mt-2 opacity-50">Attendance Leakage</p>
                         </div>
                         <div className="p-6 bg-white/5 rounded-3xl border border-white/10 text-center">
                            <span className="text-3xl font-black text-white">12m</span>
                            <p className="text-[10px] uppercase font-black tracking-widest mt-2 opacity-50">Avg. Delay</p>
                         </div>
                      </div>
                   </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Solution Section */}
        <section id="features" className="w-full py-24 bg-[#F8F9FB]">
          <div className="container px-4 md:px-6">
            <div className="text-center space-y-4 mb-20">
              <Badge className="bg-accent text-zinc-900 font-black px-4 py-1">The ConnectVerse Standard</Badge>
              <h2 className="text-4xl md:text-6xl font-black tracking-tighter text-zinc-900">Total Accountability</h2>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
              {[
                { 
                  icon: ShieldCheck, 
                  title: "15-Min Rule", 
                  desc: "Automatic classification of 'On Time' vs 'Late' based on a strict 15-minute buffer.",
                  color: "bg-green-100 text-green-600"
                },
                { 
                  icon: BarChart3, 
                  title: "70% Rule", 
                  desc: "Only participants attending 70% or more of the session are marked as 'Present'.",
                  color: "bg-primary/10 text-primary"
                },
                { 
                  icon: Zap, 
                  title: "Accumulative", 
                  desc: "Time tracks across reconnects and disconnects. No duration is ever lost.",
                  color: "bg-yellow-100 text-yellow-600"
                },
                { 
                  icon: Users, 
                  title: "Real-time Mesh", 
                  desc: "Ultra-low latency WebRTC audio/video with instant hand-raises and reactions.",
                  color: "bg-blue-100 text-blue-600"
                }
              ].map((feature, i) => (
                <Card key={i} className="rounded-[2.5rem] border-none shadow-xl hover:shadow-2xl transition-all bg-white group overflow-hidden">
                  <CardHeader className="p-8">
                    <div className={cn("w-16 h-16 rounded-[1.5rem] flex items-center justify-center mb-6 group-hover:scale-110 transition-transform", feature.color)}>
                      <feature.icon className="h-8 w-8" />
                    </div>
                    <CardTitle className="text-2xl font-black mb-2">{feature.title}</CardTitle>
                    <CardDescription className="text-zinc-500 font-medium leading-relaxed">
                      {feature.desc}
                    </CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Comparison Section */}
        <section className="w-full py-24 bg-zinc-900 text-white overflow-hidden relative">
          <div className="container px-4 md:px-6 relative z-10">
            <div className="max-w-4xl mx-auto text-center space-y-16">
              <div className="space-y-4">
                <h2 className="text-4xl md:text-6xl font-black tracking-tighter">Participation vs Presence</h2>
                <p className="text-zinc-400 text-xl">Most tools tell you who joined. We tell you who stayed.</p>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-12 text-left">
                <div className="space-y-6 p-8 rounded-[3rem] bg-white/5 border border-white/10 backdrop-blur-sm">
                   <h3 className="text-2xl font-black text-primary">Standard Tools</h3>
                   <ul className="space-y-4">
                      <li className="flex items-center gap-3 text-zinc-500"><XCircle className="h-5 w-5" /> Binary attendance (Joined = Present)</li>
                      <li className="flex items-center gap-3 text-zinc-500"><XCircle className="h-5 w-5" /> Manual export of CSVs</li>
                      <li className="flex items-center gap-3 text-zinc-500"><XCircle className="h-5 w-5" /> No participation thresholds</li>
                      <li className="flex items-center gap-3 text-zinc-500"><XCircle className="h-5 w-5" /> Time resets on disconnect</li>
                   </ul>
                </div>
                <div className="space-y-6 p-8 rounded-[3rem] bg-white/10 border-2 border-primary shadow-2xl shadow-primary/20">
                   <h3 className="text-2xl font-black text-white flex items-center gap-2">ConnectVerse <Badge className="bg-accent text-zinc-900">Winner</Badge></h3>
                   <ul className="space-y-4">
                      <li className="flex items-center gap-3 text-white font-bold"><CheckCircle2 className="h-5 w-5 text-accent" /> Weighted attendance logic</li>
                      <li className="flex items-center gap-3 text-white font-bold"><CheckCircle2 className="h-5 w-5 text-accent" /> Instant session summaries</li>
                      <li className="flex items-center gap-3 text-white font-bold"><CheckCircle2 className="h-5 w-5 text-accent" /> Custom late/on-time buffers</li>
                      <li className="flex items-center gap-3 text-white font-bold"><CheckCircle2 className="h-5 w-5 text-accent" /> Accumulative participation tracking</li>
                   </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Use Cases */}
        <section className="w-full py-24 bg-white">
          <div className="container px-4 md:px-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
               {[
                 { icon: GraduationCap, title: "Universities", desc: "Track student engagement for degree requirements." },
                 { icon: Building2, title: "Corporate Training", desc: "Verify employees completed mandatory safety sessions." },
                 { icon: Globe, title: "NGOs", desc: "Report accurate volunteer participation to donors." }
               ].map((item, i) => (
                 <div key={i} className="space-y-4">
                    <div className="mx-auto w-20 h-20 rounded-[2rem] bg-zinc-50 flex items-center justify-center text-primary shadow-inner">
                       <item.icon className="h-10 w-10" />
                    </div>
                    <h3 className="text-2xl font-black text-zinc-900">{item.title}</h3>
                    <p className="text-zinc-500 font-medium px-4">{item.desc}</p>
                 </div>
               ))}
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="w-full py-24 bg-[#F8F9FB]">
          <div className="container px-4 md:px-6">
            <div className="max-w-5xl mx-auto">
              <div className="grid md:grid-cols-3 gap-12 relative">
                <div className="hidden md:block absolute top-1/4 left-[20%] right-[20%] h-0.5 border-t-2 border-dashed border-zinc-200" />
                {[
                  { step: "01", title: "Create Session", desc: "Set up a one-time or recurring session in seconds." },
                  { step: "02", title: "Share Link", desc: "Send the secure invite link to your participants." },
                  { step: "03", title: "Automated Data", desc: "Watch attendance update in real-time as users participate." }
                ].map((item, i) => (
                  <div key={i} className="relative z-10 text-center space-y-6">
                    <div className="mx-auto w-16 h-16 rounded-full bg-primary flex items-center justify-center text-white font-black shadow-xl shadow-primary/30">
                      {item.step}
                    </div>
                    <h3 className="text-xl font-black text-zinc-900">{item.title}</h3>
                    <p className="text-zinc-500 font-medium leading-relaxed">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section id="pricing" className="w-full py-24 bg-white">
          <div className="container px-4 md:px-6">
            <div className="text-center space-y-4 mb-20">
              <h2 className="text-4xl md:text-6xl font-black tracking-tighter text-zinc-900">Simple, Transparent Pricing</h2>
              <p className="text-zinc-500 text-lg font-medium">Scales with your organization. Support for M-Pesa included.</p>
            </div>
            <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
              {[
                { 
                  name: "Free", 
                  price: "$0", 
                  features: ["Up to 10 participants", "Basic summaries", "Community support"],
                  cta: "Get Started",
                  popular: false
                },
                { 
                  name: "Starter", 
                  price: "$19", 
                  features: ["Up to 50 participants", "Advanced analytics", "CSV Exports", "Priority support"],
                  cta: "Upgrade to Starter",
                  popular: true
                },
                { 
                  name: "Pro", 
                  price: "$49", 
                  features: ["Unlimited participants", "White-labeling", "API Access", "Dedicated manager"],
                  cta: "Contact Sales",
                  popular: false
                }
              ].map((plan, i) => (
                <Card key={i} className={cn(
                  "rounded-[2.5rem] border-2 transition-all p-4",
                  plan.popular ? "border-primary bg-white shadow-2xl scale-105" : "border-zinc-100 shadow-xl"
                )}>
                  {plan.popular && (
                    <div className="flex justify-center -mt-8 mb-4">
                      <Badge className="bg-primary text-white font-black px-6 py-1 shadow-xl">MOST POPULAR</Badge>
                    </div>
                  )}
                  <CardHeader className="text-center p-8 pb-4">
                    <CardTitle className="text-xl font-black uppercase tracking-widest text-zinc-400 mb-2">{plan.name}</CardTitle>
                    <div className="flex items-baseline justify-center gap-1">
                      <span className="text-6xl font-black text-zinc-900">{plan.price}</span>
                      <span className="text-zinc-500 font-bold">/mo</span>
                    </div>
                  </CardHeader>
                  <CardContent className="p-8 space-y-8">
                    <ul className="space-y-4">
                      {plan.features.map((f, j) => (
                        <li key={j} className="flex items-center gap-3 font-medium text-zinc-600">
                          <CheckCircle2 className="h-5 w-5 text-accent" /> {f}
                        </li>
                      ))}
                    </ul>
                    <Button asChild className={cn(
                      "w-full h-14 rounded-2xl font-black uppercase tracking-widest text-xs",
                      plan.popular ? "bg-primary" : "bg-zinc-100 text-zinc-900 hover:bg-zinc-200 shadow-none border-none"
                    )}>
                      <Link href="/register">{plan.cta}</Link>
                    </Button>
                    <div className="flex items-center justify-center gap-2 pt-4">
                       <Zap className="h-3 w-3 text-accent" />
                       <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Pay via M-Pesa Supported</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA Section */}
        <section className="w-full py-24 bg-primary relative overflow-hidden">
          <div className="absolute top-0 right-0 w-96 h-96 bg-accent/20 rounded-full blur-[100px]" />
          <div className="absolute bottom-0 left-0 w-96 h-96 bg-white/10 rounded-full blur-[100px]" />
          
          <div className="container px-4 md:px-6 relative z-10 text-center text-white space-y-12">
            <h2 className="text-4xl md:text-7xl font-black tracking-tighter leading-none">
              Ready to fix your <br /> attendance data?
            </h2>
            <div className="flex flex-col sm:flex-row gap-6 justify-center">
              <Button asChild size="lg" className="h-16 px-12 rounded-2xl bg-white text-primary hover:bg-zinc-100 font-black uppercase tracking-widest text-xs shadow-2xl transition-all">
                <Link href="/register">Start Free Today</Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="h-16 px-12 rounded-2xl bg-transparent text-white border-2 border-white hover:bg-white/10 font-black uppercase tracking-widest text-xs">
                <Link href="/login">Access Dashboard</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="w-full py-12 px-4 md:px-12 bg-white border-t">
        <div className="container flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-3">
            <div className="bg-primary p-1.5 rounded-lg shadow-md">
              <Video className="h-4 w-4 text-white" />
            </div>
            <span className="font-black text-xl tracking-tighter text-primary">ConnectVerse</span>
          </div>
          <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">
            &copy; 2024 ConnectVerse Inc. All rights reserved. Built for professional participation.
          </p>
          <nav className="flex gap-8">
            <Link href="#" className="text-xs font-bold text-zinc-400 uppercase tracking-widest hover:text-primary transition-colors">Terms</Link>
            <Link href="#" className="text-xs font-bold text-zinc-400 uppercase tracking-widest hover:text-primary transition-colors">Privacy</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
