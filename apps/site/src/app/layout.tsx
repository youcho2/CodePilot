import './global.css';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: {
    default: 'CodePilot',
    template: '%s | CodePilot',
  },
  description: 'A native desktop GUI client for Claude Code',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
