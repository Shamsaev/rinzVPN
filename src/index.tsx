/* @refresh reload */
import { render } from "solid-js/web";
import "@fontsource-variable/onest";
import { polyfillCountryFlagEmojis } from "country-flag-emoji-polyfill";
import flagsFont from "country-flag-emoji-polyfill/dist/TwemojiCountryFlags.woff2?url";
import "./styles.css";
import App from "./App";

// Windows не рисует эмодзи-флаги — подключаем шрифт только для них (локально, без CDN)
polyfillCountryFlagEmojis("Twemoji Country Flags", flagsFont);

render(() => <App />, document.getElementById("root")!);
