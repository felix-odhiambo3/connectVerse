
'use client';

import {
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/firebase';
import AuthForm from '@/components/auth/AuthForm';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { Video } from 'lucide-react';
import { Suspense } from 'react';

function LoginContent() {
  const auth = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard';

  const handleLogin = async ({ email, password }) => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      toast({ title: 'Login successful!' });
      router.push(callbackUrl);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Uh oh! Something went wrong.',
        description: error.message,
      });
    }
  };

  return (
    <div className="container relative min-h-screen flex-col items-center justify-center grid lg:max-w-none lg:grid-cols-2 lg:px-0">
      <div className="relative hidden h-full flex-col bg-muted p-10 text-white lg:flex dark:border-r">
        <div className="absolute inset-0 bg-zinc-900" />
        <div className="relative z-20 flex items-center text-lg font-medium">
            <Video className="mr-2 h-6 w-6" />
            ConnectVerse
        </div>
        <div className="relative z-20 mt-auto">
          <blockquote className="space-y-2">
            <p className="text-lg">
              &ldquo;This video conferencing app has transformed how our team collaborates. It's intuitive, reliable, and has all the features we need.&rdquo;
            </p>
            <footer className="text-sm">Sofia Davis</footer>
          </blockquote>
        </div>
      </div>
      <div className="p-4 md:p-8 flex items-center justify-center min-h-screen">
        <div className="mx-auto flex w-full flex-col justify-center space-y-6 max-w-[350px]">
          <div className="flex flex-col space-y-2 text-center">
            <div className="flex justify-center mb-4 lg:hidden">
              <div className="bg-zinc-900 p-2 rounded-xl">
                <Video className="h-6 w-6 text-white" />
              </div>
            </div>
            <h1 className="text-2xl font-black tracking-tight">Welcome back</h1>
            <p className="text-sm font-medium text-zinc-500">Enter your email below to log in</p>
          </div>
          <AuthForm
            title=""
            description=""
            buttonText="Login"
            onSubmit={handleLogin}
          />
          <p className="px-8 text-center text-sm text-zinc-500 font-medium">
            Don't have an account?{' '}
            <Link
              href={callbackUrl ? `/register?callbackUrl=${callbackUrl}` : "/register"}
              className="underline underline-offset-4 font-bold text-zinc-900"
            >
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="h-screen flex items-center justify-center">Loading...</div>}>
      <LoginContent />
    </Suspense>
  );
}

