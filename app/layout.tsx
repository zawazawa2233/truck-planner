import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ReactNode } from 'react';
import PwaRegister from '@/components/PwaRegister';

export const metadata: Metadata = {
  title: 'トラック休憩・給油プランナー',
  description: 'Google Maps URL based truck operation planner',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: '運行プランナー',
    statusBarStyle: 'black-translucent'
  },
  icons: {
    icon: [{ url: '/icon', type: 'image/png' }],
    apple: [{ url: '/apple-icon', type: 'image/png' }]
  }
};

export const viewport: Viewport = {
  themeColor: '#0f1a1d'
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
