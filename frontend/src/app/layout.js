import { Space_Grotesk, Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin', 'vietnamese'],
  variable: '--font-space-grotesk',
  display: 'swap',
  weight: ['600', '700'],
});

const inter = Inter({
  subsets: ['latin', 'vietnamese'],
  variable: '--font-inter',
  display: 'swap',
  weight: ['400', '500'],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
  weight: ['400'],
});

export const metadata = {
  title: 'Guestbook - Đăng ký sự kiện',
  description: 'Ứng dụng đăng ký sự kiện serverless',
};

// suppressHydrationWarning on <html>/<body> only covers attributes injected onto
// those two elements by browser extensions (e.g. data-scribe-recorder-ready).
// It does NOT extend into the component tree, so genuine hydration mismatches
// inside the app are still reported.
export default function RootLayout({ children }) {
  return (
    <html
      lang="vi"
      className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/*
          No-flash theme bootstrap. This MUST stay a blocking inline script in
          <head> so data-theme is on <html> before the first paint: it prevents
          both a flash of the wrong theme and a hydration mismatch (React never
          renders the theme value, it only reads it after mount). Deferring it
          or moving it into a component would reintroduce both problems.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('theme');if(!t){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme='dark';}})();",
          }}
        />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
