
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
import { useEffect, useState } from 'react';

export default function LandingPage() {
  const { user, isUserLoading } = useUser();
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const NavItems = () => (
    <div className="flex flex-col sm:flex-row items-center gap-6 sm:gap-10">
      <Link href="#features" className="text-sm font-bold text-zinc-600 hover:text-primary transition-colors">Features</Link>
      <Link href="#pricing" className="text-sm font-bold text-zinc-600 hover:text-primary transition-colors">Pricing</Link>
      {isUserLoading ? (
        <div className="w-20 h-8 bg-zinc-100 animate-pulse rounded-full" />
      ) : user ? (
        <Button asChild className="rounded-full px-8 font-black uppercase tracking-widest text-[10px] shadow-xl shadow-primary/20 hover:scale-105 transition-all">
          <Link href="/dashboard">Dashboard</Link>
        </Button>
      ) : (
        <div className="flex items-center gap-6">
          <Link href="/login" className="text-sm font-bold text-zinc-600 hover:text-primary transition-colors">Login</Link>
          <Button asChild className="rounded-full px-8 font-black uppercase tracking-widest text-[10px] shadow-xl shadow-primary/20 hover:scale-105 transition-all">
            <Link href="/register">Get Started</Link>
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col min-h-screen bg-[#FDFDFF] selection:bg-accent/30">
      {/* Navigation */}
      <header className={cn(
        "fixed top-0 left-0 right-0 h-20 flex items-center px-4 lg:px-12 z-[100] transition-all duration-300",
        isScrolled ? "bg-white/70 backdrop-blur-xl border-b shadow-sm" : "bg-transparent"
      )}>
        <Link href="/" className="flex items-center gap-3 transition-all hover:scale-105">
          <div className="bg-primary p-2 rounded-2xl shadow-lg shadow-primary/30">
            <Video className="h-6 w-6 text-white" />
          </div>
          <span className="font-black text-2xl tracking-tighter text-zinc-900">ConnectVerse</span>
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
        <section className="relative w-full min-h-screen flex items-center pt-20 overflow-hidden">
          {/* Animated Background Elements */}
          <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/4 w-[800px] h-[800px] bg-accent/20 rounded-full blur-[120px] animate-pulse pointer-events-none" />
          <div className="absolute bottom-0 left-0 translate-y-1/2 -translate-x-1/4 w-[800px] h-[800px] bg-primary/10 rounded-full blur-[120px] animate-pulse pointer-events-none" />
          
          <div className="container px-4 md:px-6 relative z-10">
            <div className="flex flex-col items-center space-y-12 text-center">
              <div className="space-y-6 max-w-5xl animate-in fade-in slide-in-from-bottom-8 duration-700">
                <Badge variant="outline" className="px-6 py-2 rounded-full border-primary/20 text-primary font-black uppercase tracking-[0.2em] text-[10px] bg-white/50 backdrop-blur-sm shadow-sm">
                  Revolutionizing Real-Time Accountability
                </Badge>
                <h1 className="text-6xl font-black tracking-tighter sm:text-7xl md:text-8xl lg:text-9xl/none text-zinc-900 text-balance leading-[0.9] py-4">
                  Attendance That <br /> 
                  <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent">Actually Tracks</span>
                </h1>
                <p className="mx-auto max-w-[800px] text-zinc-500 font-medium md:text-xl/relaxed lg:text-2xl/relaxed">
                  Stop counting heads. Start measuring engagement. Our accumulative engine distinguishes between "just joined" and "actively attended".
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-6 w-full sm:w-auto justify-center animate-in fade-in slide-in-from-bottom-12 duration-1000 delay-200">
                <Button asChild size="lg" className="h-16 px-12 rounded-2xl font-black uppercase tracking-widest text-[11px] shadow-2xl shadow-primary/40 hover:scale-105 hover:-rotate-1 transition-all">
                  <Link href="/register">
                    Start Free Today <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="h-16 px-12 rounded-2xl font-black uppercase tracking-widest text-[11px] border-2 bg-white/50 backdrop-blur-md hover:bg-white transition-all">
                  <Link href="#features">See How It Works</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Problem Section */}
        <section className="w-full py-32 bg-zinc-900 text-white relative overflow-hidden">
          <div className="container px-4 md:px-6 relative z-10">
            <div className="grid lg:grid-cols-2 gap-20 items-center">
              <div className="space-y-10">
                <Badge className="bg-white/10 text-white border-white/20 hover:bg-white/20">The Challenge</Badge>
                <h2 className="text-5xl md:text-7xl font-black tracking-tighter leading-tight">
                  The "Present <br /> But Absent" <br /> Reality
                </h2>
                <div className="space-y-6">
                  {[
                    { icon: Clock, title: "Ghost Joining", desc: "Users join for 1 minute just to trigger a 'present' log.", color: "text-red-400" },
                    { icon: AlertCircle, title: "Unnoticed Lateness", desc: "No penalty for joining a 60-minute session at minute 55.", color: "text-orange-400" },
                    { icon: XCircle, title: "Manual Reporting", desc: "Wasted hours exporting logs and cross-referencing names.", color: "text-amber-400" }
                  ].map((item, i) => (
                    <div key={i} className="flex gap-6 p-8 rounded-[2.5rem] bg-white/5 border border-white/10 hover:bg-white/10 transition-all duration-500">
                      <div className={cn("p-4 rounded-2xl bg-zinc-800 shadow-xl shrink-0", item.color)}>
                        <item.icon className="h-7 w-7" />
                      </div>
                      <div>
                        <h3 className="font-black text-xl mb-1">{item.title}</h3>
                        <p className="text-zinc-400 font-medium leading-relaxed">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="relative group">
                <div className="absolute inset-0 bg-primary/20 rounded-[4rem] -rotate-3 scale-105 blur-2xl transition-all group-hover:rotate-0 group-hover:scale-110" />
                <div className="relative bg-[#121212] rounded-[3.5rem] p-12 shadow-2xl border border-white/5 overflow-hidden">
                   <div className="space-y-10">
                      <div className="flex items-center gap-3">
                         <div className="w-3 h-3 rounded-full bg-red-500/50" />
                         <div className="w-3 h-3 rounded-full bg-yellow-500/50" />
                         <div className="w-3 h-3 rounded-full bg-green-500/50" />
                      </div>
                      <div className="space-y-6">
                         <div className="h-5 w-3/4 bg-white/10 rounded-full animate-pulse" />
                         <div className="h-5 w-1/2 bg-white/10 rounded-full animate-pulse delay-75" />
                         <div className="h-5 w-2/3 bg-white/10 rounded-full animate-pulse delay-150" />
                      </div>
                      <div className="grid grid-cols-2 gap-6">
                         <div className="p-8 bg-white/5 rounded-[2.5rem] border border-white/10 text-center hover:bg-white/10 transition-colors">
                            <span className="text-5xl font-black text-red-500">42%</span>
                            <p className="text-[11px] uppercase font-black tracking-[0.2em] mt-3 opacity-40">Participation Gap</p>
                         </div>
                         <div className="p-8 bg-white/5 rounded-[2.5rem] border border-white/10 text-center hover:bg-white/10 transition-colors">
                            <span className="text-5xl font-black text-white">12m</span>
                            <p className="text-[11px] uppercase font-black tracking-[0.2em] mt-3 opacity-40">Avg. Delay</p>
                         </div>
                      </div>
                   </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Solution Section */}
        <section id="features" className="w-full py-40 bg-[#FDFDFF] relative">
          <div className="container px-4 md:px-6">
            <div className="text-center space-y-6 mb-24 max-w-3xl mx-auto">
              <Badge className="bg-primary/10 text-primary border-primary/20 font-black px-6 py-2 rounded-full uppercase tracking-widest text-[10px]">The Connector Standard</Badge>
              <h2 className="text-5xl md:text-7xl font-black tracking-tighter text-zinc-900 leading-[1.1]">Engineered for Accountability</h2>
              <p className="text-zinc-500 font-medium text-lg">We don't just log arrivals. we measure participation quality.</p>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
              {[
                { 
                  icon: ShieldCheck, 
                  title: "15-Min Buffer", 
                  desc: "Automated classification of 'On Time' vs 'Late' with custom buffer support.",
                  color: "bg-green-50 text-green-600"
                },
                { 
                  icon: BarChart3, 
                  title: "70% Rule", 
                  desc: "Only participants attending 70%+ of the session duration are marked 'Present'.",
                  color: "bg-primary/10 text-primary"
                },
                { 
                  icon: Zap, 
                  title: "Accumulative", 
                  desc: "Active timers that pause on disconnect and resume on rejoin. No data loss.",
                  color: "bg-yellow-50 text-yellow-600"
                },
                { 
                  icon: Users, 
                  title: "Real-time Mesh", 
                  desc: "Ultra-low latency audio/video with instant hand-raise priority sorting.",
                  color: "bg-blue-50 text-blue-600"
                }
              ].map((feature, i) => (
                <Card key={i} className="rounded-[3rem] border-none shadow-2xl hover:shadow-primary/5 hover:-translate-y-2 transition-all duration-500 bg-white group overflow-hidden p-4">
                  <CardHeader className="p-8">
                    <div className={cn("w-20 h-20 rounded-[2rem] flex items-center justify-center mb-8 group-hover:scale-110 group-hover:rotate-6 transition-all duration-500", feature.color)}>
                      <feature.icon className="h-10 w-10" />
                    </div>
                    <CardTitle className="text-2xl font-black mb-4 leading-tight">{feature.title}</CardTitle>
                    <CardDescription className="text-zinc-500 font-medium leading-relaxed text-base">
                      {feature.desc}
                    </CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Use Cases */}
        <section className="w-full py-32 bg-zinc-50">
          <div className="container px-4 md:px-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
               {[
                 { icon: GraduationCap, title: "Universities", desc: "Accurately track student engagement for accreditation requirements." },
                 { icon: Building2, title: "Corporate Training", desc: "Verify mandatory training completion with verifiable timing data." },
                 { icon: Globe, title: "Global NGOs", desc: "Provide transparent participation data to donors and stakeholders." }
               ].map((item, i) => (
                 <div key={i} className="flex flex-col items-center text-center space-y-6 group">
                    <div className="w-24 h-24 rounded-[2.5rem] bg-white flex items-center justify-center text-primary shadow-xl group-hover:scale-110 transition-transform duration-500">
                       <item.icon className="h-10 w-10" />
                    </div>
                    <h3 className="text-3xl font-black text-zinc-900 tracking-tight">{item.title}</h3>
                    <p className="text-zinc-500 font-medium px-4 text-lg leading-relaxed">{item.desc}</p>
                 </div>
               ))}
            </div>
          </div>
        </section>

        {/* Pricing Section */}
        <section id="pricing" className="w-full py-40 bg-white">
          <div className="container px-4 md:px-6">
            <div className="text-center space-y-6 mb-24">
              <h2 className="text-5xl md:text-7xl font-black tracking-tighter text-zinc-900 leading-none">Simple Pricing</h2>
              <p className="text-zinc-500 text-xl font-medium">Built for organizations of every size.</p>
            </div>
            <div className="grid md:grid-cols-3 gap-10 max-w-7xl mx-auto items-center">
              {[
                { 
                  name: "Free", 
                  price: "$0", 
                  features: ["10 Participants", "Basic summaries", "Community Support"],
                  cta: "Start for Free",
                  popular: false
                },
                { 
                  name: "Starter", 
                  price: "$19", 
                  features: ["50 Participants", "Advanced Analytics", "CSV/PDF Exports", "Priority Support"],
                  cta: "Get Started",
                  popular: true
                },
                { 
                  name: "Pro", 
                  price: "$49", 
                  features: ["Unlimited Participants", "White-labeling", "Custom Buffers", "Dedicated Manager"],
                  cta: "Contact Sales",
                  popular: false
                }
              ].map((plan, i) => (
                <Card key={i} className={cn(
                  "rounded-[3.5rem] border-2 transition-all duration-500 p-6",
                  plan.popular ? "border-primary bg-white shadow-[0_40px_100px_rgba(79,70,229,0.15)] scale-110 z-10" : "border-zinc-100 shadow-xl opacity-80 hover:opacity-100"
                )}>
                  {plan.popular && (
                    <div className="flex justify-center -mt-10 mb-6">
                      <Badge className="bg-primary text-white font-black px-8 py-2 rounded-full shadow-2xl tracking-widest text-[10px]">MOST POPULAR</Badge>
                    </div>
                  )}
                  <CardHeader className="text-center p-8 pb-6">
                    <CardTitle className="text-sm font-black uppercase tracking-[0.3em] text-zinc-400 mb-4">{plan.name}</CardTitle>
                    <div className="flex items-baseline justify-center gap-2">
                      <span className="text-7xl font-black text-zinc-900 tracking-tighter">{plan.price}</span>
                      <span className="text-zinc-400 font-bold text-lg">/mo</span>
                    </div>
                  </CardHeader>
                  <CardContent className="p-8 space-y-10">
                    <ul className="space-y-5">
                      {plan.features.map((f, j) => (
                        <li key={j} className="flex items-center gap-4 font-bold text-zinc-600">
                          <CheckCircle2 className="h-6 w-6 text-accent shrink-0" /> {f}
                        </li>
                      ))}
                    </ul>
                    <Button asChild className={cn(
                      "w-full h-16 rounded-2xl font-black uppercase tracking-widest text-xs transition-all",
                      plan.popular ? "bg-primary shadow-2xl shadow-primary/30 hover:scale-105" : "bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
                    )}>
                      <Link href="/register">{plan.cta}</Link>
                    </Button>
                    <div className="flex items-center justify-center gap-3 pt-4 border-t border-zinc-50">
                       <Zap className="h-4 w-4 text-accent" />
                       <span className="text-[11px] font-black uppercase tracking-widest text-zinc-400">Supports M-Pesa Payments</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA Section */}
        <section className="w-full py-40 bg-primary relative overflow-hidden text-white">
          <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-accent/30 rounded-full blur-[120px] animate-pulse" />
          <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-white/10 rounded-full blur-[120px] animate-pulse" />
          
          <div className="container px-4 md:px-6 relative z-10 text-center space-y-16">
            <h2 className="text-6xl md:text-9xl font-black tracking-tighter leading-none py-2">
              Fix Your <br /> Attendance.
            </h2>
            <div className="flex flex-col sm:flex-row gap-8 justify-center items-center">
              <Button asChild size="lg" className="h-20 px-16 rounded-3xl bg-white text-primary hover:bg-zinc-50 font-black uppercase tracking-widest text-xs shadow-2xl hover:scale-110 hover:rotate-1 transition-all">
                <Link href="/register">Start Free Today</Link>
              </Button>
              <Link href="/login" className="font-black uppercase tracking-widest text-xs hover:text-accent transition-colors">
                Already have an account? Log In
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="w-full py-20 px-4 md:px-12 bg-white border-t">
        <div className="container flex flex-col md:flex-row justify-between items-start gap-16">
          <div className="space-y-6 max-w-sm">
            <Link href="/" className="flex items-center gap-3">
              <div className="bg-primary p-2 rounded-xl shadow-md">
                <Video className="h-5 w-5 text-white" />
              </div>
              <span className="font-black text-2xl tracking-tighter text-zinc-900">ConnectVerse</span>
            </Link>
            <p className="text-zinc-500 font-medium leading-relaxed">
              Redefining participation through intelligent, real-time accountability metrics.
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-16">
             <div className="space-y-6">
                <h4 className="font-black text-xs uppercase tracking-[0.2em] text-zinc-900">Platform</h4>
                <ul className="space-y-4 text-sm font-bold text-zinc-500">
                   <li><Link href="#features" className="hover:text-primary transition-colors">Features</Link></li>
                   <li><Link href="#pricing" className="hover:text-primary transition-colors">Pricing</Link></li>
                   <li><Link href="/dashboard" className="hover:text-primary transition-colors">Dashboard</Link></li>
                </ul>
             </div>
             <div className="space-y-6">
                <h4 className="font-black text-xs uppercase tracking-[0.2em] text-zinc-900">Legal</h4>
                <ul className="space-y-4 text-sm font-bold text-zinc-500">
                   <li><Link href="#" className="hover:text-primary transition-colors">Terms</Link></li>
                   <li><Link href="#" className="hover:text-primary transition-colors">Privacy</Link></li>
                </ul>
             </div>
          </div>
        </div>
        <div className="container mt-20 pt-10 border-t flex flex-col sm:flex-row justify-between items-center gap-6">
          <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">
            &copy; 2024 ConnectVerse Inc. All rights reserved.
          </p>
          <div className="flex gap-8">
             <Globe className="h-5 w-5 text-zinc-300 hover:text-primary transition-colors cursor-pointer" />
             <Zap className="h-5 w-5 text-zinc-300 hover:text-primary transition-colors cursor-pointer" />
          </div>
        </div>
      </footer>
    </div>
  );
}
