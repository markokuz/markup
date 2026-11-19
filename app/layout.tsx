import type { Metadata } from "next";
import { Geist_Mono, Space_Grotesk } from "next/font/google";
import { SETTINGS_KEY } from "@/app/utils/settings";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Markup - PDF Scale Measure",
  description: "Calibrate scale on PDF drawings and measure with real-world units",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Runs before first paint so a dark-mode reload doesn't flash white. Dark unless saved as light. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `var d=true;try{d=JSON.parse(localStorage.getItem(${JSON.stringify(SETTINGS_KEY)}))?.darkMode!==false}catch{}if(d)document.documentElement.dataset.theme="dark"`,
          }}
        />
      </head>
      <body className="min-h-full overflow-hidden font-sans">{children}</body>
    </html>
  );
}
