import type {Metadata} from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Toaster } from "@/components/ui/toaster";
import { FirebaseClientProvider } from '@/firebase/client-provider';
import WhatsAppHelp from '@/components/WhatsAppHelp';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'ConnectVerse',
  description: 'A modern video conferencing app.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-body antialiased`}>
        <FirebaseClientProvider>
          {children}
          <WhatsAppHelp />
        </FirebaseClientProvider>
        <Toaster />
      </body>
    </html>
  );
}
