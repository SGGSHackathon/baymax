import type { Metadata } from "next";
import { Geist, Geist_Mono, Patrick_Hand, Poppins } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import Providers from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const patrickHand = Patrick_Hand({
  variable: "--font-patrick-hand",
  subsets: ["latin"],
  weight: "400",
});

const gilroyHeavy = localFont({
  src: "../public/fonts/Gilroy-Heavy.ttf",
  variable: "--font-gilroy",
  weight: "900",
});

const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Baymax Intelligence — Clinical AI Platform",
  description: "Next generation clinical decision engine. Minimal, fast, and secure patient care.",
  icons: {
    icon: "/baymax-favicon.png",
    shortcut: "/baymax-favicon.png",
    apple: "/baymax-favicon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${patrickHand.variable} ${gilroyHeavy.variable} ${poppins.variable} antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
