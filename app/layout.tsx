import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Office Radio',
  description: 'One queue, one speaker, one continuous broadcast.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
