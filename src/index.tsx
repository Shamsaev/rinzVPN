/* @refresh reload */
import { render } from "solid-js/web";
import "@fontsource-variable/manrope";
import "@fontsource/unbounded/500.css";
import "@fontsource/unbounded/600.css";
import "./styles.css";
import App from "./App";

render(() => <App />, document.getElementById("root")!);
