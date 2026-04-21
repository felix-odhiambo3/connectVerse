'use client';

import { useUser } from '@/firebase';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight, Video, Menu } from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';

export default function Home() {
  const { user, isUserLoading } = useUser();

  const NavItems = () => (
    <>
      {isUserLoading ? (
        <div />
      ) : user ? (
        <Button asChild className="w-full sm:w-auto">
          <Link href="/dashboard">Go to Dashboard</Link>
        </Button>
      ) : (
        <div className="flex flex-col sm:flex-row gap-4">
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href="/login">Login</Link>
          </Button>
          <Button asChild className="w-full sm:w-auto">
            <Link href="/register">Sign Up</Link>
          </Button>
        </div>
      )}
    </>
  );

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <header className="px-4 lg:px-8 h-16 flex items-center border-b sticky top-0 bg-white/80 backdrop-blur-md z-50">
        <Link href="/" className="flex items-center gap-2 transition-all hover:scale-105">
          <div className="bg-zinc-900 p-1.5 rounded-lg">
            <Video className="h-5 w-5 text-white" />
          </div>
          <span className="font-black text-xl tracking-tighter">ConnectVerse</span>
        </Link>
        <nav className="ml-auto hidden sm:flex gap-4">
          <NavItems />
        </nav>
        <div className="ml-auto sm:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon">
                <Menu className="h-6 w-6" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[300px] pt-12">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <div className="flex flex-col gap-6">
                <NavItems />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>
      <main className="flex-1">
        <section className="w-full py-12 md:py-24 lg:py-32 xl:py-48 flex items-center justify-center">
          <div className="container px-4 md:px-6">
            <div className="flex flex-col items-center space-y-8 text-center">
              <div className="space-y-4 max-w-3xl">
                <h1 className="text-4xl font-black tracking-tighter sm:text-5xl md:text-6xl lg:text-7xl/none">
                  Seamless Video <br className="hidden sm:block" /> Conferencing for Everyone
                </h1>
                <p className="mx-auto max-w-[700px] text-zinc-500 font-medium md:text-xl/relaxed">
                  ConnectVerse offers a simple, reliable, and high-quality video experience. 
                  Built for creators, teams, and families.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto justify-center">
                <Button asChild size="lg" className="h-14 px-8 rounded-2xl font-black uppercase tracking-widest text-xs">
                  <Link href="/dashboard">
                    Get Started <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg" className="h-14 px-8 rounded-2xl font-black uppercase tracking-widest text-xs">
                  <Link href="/login">Explore Features</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>
      <footer className="flex flex-col gap-4 sm:flex-row py-8 w-full shrink-0 items-center px-4 md:px-12 border-t">
        <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">&copy; 2024 ConnectVerse. All rights reserved.</p>
        <nav className="sm:ml-auto flex gap-6 sm:gap-8">
          <Link href="#" className="text-xs font-bold text-zinc-400 uppercase tracking-widest hover:text-zinc-900 transition-colors">
            Terms
          </Link>
          <Link href="#" className="text-xs font-bold text-zinc-400 uppercase tracking-widest hover:text-zinc-900 transition-colors">
            Privacy
          </Link>
        </nav>
      </footer>
    </div>
  );
}
