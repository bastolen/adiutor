/**
 * @file The fonts Adiutor ships, so text looks and measures the same on every
 * device instead of in each device's own system font (San Francisco, Segoe
 * UI, Roboto, DejaVu Sans): Inter for text and JetBrains Mono for codes, URL
 * names and references. `next/font` downloads them when the app is built and
 * serves them from Adiutor's own domain, so visitors never contact Google, and
 * adds a size-adjusted fallback so nothing jumps while they load. Both are
 * under the SIL Open Font License 1.1 (`LICENSES/`); see
 * docs/decisions/0016-ship-inter-and-jetbrains-mono.md.
 */
import { Inter, JetBrains_Mono } from 'next/font/google';

/** Inter, for all text; read through `--font-sans` in `src/styles/theme.css`. */
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

/** JetBrains Mono, for codes and URL names; read through `--font-mono`. */
const jetBrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

/**
 * The classes that define both fonts' CSS variables, for every document's
 * `<html>` (the root layout and the global error page).
 */
const fontVariables = `${inter.variable} ${jetBrainsMono.variable}`;

export default fontVariables;
