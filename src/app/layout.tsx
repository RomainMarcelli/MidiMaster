import type { Metadata, Viewport } from "next";
import { Inter, Montserrat } from "next/font/google";
import { Suspense } from "react";
import { ConsoleFilter } from "@/components/layout/ConsoleFilter";
import { ThemeProvider } from "@/components/layout/ThemeProvider";
import { TopProgressBar } from "@/components/ui/TopProgressBar";
import { getBuildBrand } from "@/lib/build-brand";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
  display: "swap",
});

// O — Le metadata HTML est server-side, rendu AVANT l'auth. On utilise
// `getBuildBrand()` qui lit `NEXT_PUBLIC_BRAND_MODE` (figé au build) :
//   - déploiement public générique → "Coups de Midi Quiz"
//   - déploiement Mahylan          → "Les 12 coups de Mahylan"
//
// Pour le branding DYNAMIQUE par utilisateur connecté (Navbar, Hero,
// Splash via `is_owner`), continuer à utiliser `getBranding(isOwner)`
// dans `src/lib/branding.ts`.
const brand = getBuildBrand();

export const metadata: Metadata = {
  title: { default: brand.appName, template: `%s — ${brand.appName}` },
  description: brand.description,
  applicationName: brand.appName,
  // O2 — Le manifest est généré dynamiquement par `app/manifest.ts`.
  // Next l'expose à `/manifest.webmanifest` (pas `.json`).
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: brand.appShortName,
  },
  icons: {
    icon: [
      { url: brand.faviconPath, sizes: "any" },
      // Les PNG d'icônes sont sous `iconBasePath` (mahylan = sous-dossier,
      // generic = racine de public/).
      {
        url: `${brand.iconBasePath}/icon-192.png`,
        type: "image/png",
        sizes: "192x192",
      },
      {
        url: `${brand.iconBasePath}/icon-512.png`,
        type: "image/png",
        sizes: "512x512",
      },
    ],
    apple: [{ url: brand.appleTouchIconPath, sizes: "180x180" }],
    shortcut: brand.faviconPath,
  },
};

export const viewport: Viewport = {
  themeColor: brand.themeColor,
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="fr"
      className={`${inter.variable} ${montserrat.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ConsoleFilter />
        {/* Vague S8 — Barre de progression fine sur navigations Next.js.
            Suspense requis car TopProgressBar utilise useSearchParams. */}
        <Suspense fallback={null}>
          <TopProgressBar />
        </Suspense>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
