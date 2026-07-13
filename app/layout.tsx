import type {Metadata, Viewport} from 'next';
import type {ReactElement, ReactNode} from 'react';
import {AppProviders} from './providers';
import '../src/style.css';

export const metadata: Metadata = {
  title: 'NOCK0',
  description: 'NOCK0 multiplayer city prototype'
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0a0a0a'
};

export default function RootLayout({children}: {children: ReactNode}): ReactElement {
  return (
    <html lang="en">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
