import { evaluateOnTarget, applySkinOnTarget, restoreOnTarget } from "../server/lib/cdp.js";
import { buildSkinEngineJs, normalizeSkinConfig } from "../server/lib/desktopSkin.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PORT = 9333;

async function firstPageWs(): Promise<string> {
  const list = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()) as Array<{
    type: string;
    webSocketDebuggerUrl?: string;
  }>;
  const page = list.find((t) => t.type === "page");
  if (!page?.webSocketDebuggerUrl) throw new Error("no page target");
  return page.webSocketDebuggerUrl;
}

const target = "http://127.0.0.1:9444/mock.html";

async function main() {
  const tabs = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()) as Array<{
    type: string;
    webSocketDebuggerUrl?: string;
    url: string;
  }>;
  const existing = tabs.find((t) => t.type === "page" && t.url.includes("mock.html"));
  if (existing?.webSocketDebuggerUrl) {
    await evaluateOnTarget(
      existing.webSocketDebuggerUrl,
      "try{window.__ocSkinEngine__.restore()}catch(e){}; try{localStorage.clear()}catch(e){}",
    );
    await evaluateOnTarget(existing.webSocketDebuggerUrl, `location.reload()`);
    await sleep(1200);
  } else {
    const anyPage = tabs.find((t) => t.type === "page");
    if (!anyPage?.webSocketDebuggerUrl) throw new Error("no page target");
    await evaluateOnTarget(anyPage.webSocketDebuggerUrl, `location.href=${JSON.stringify(target)}`);
    await sleep(2000);
  }
  const tabs2 = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()) as Array<{
    type: string;
    webSocketDebuggerUrl?: string;
    url: string;
  }>;
  const found = tabs2.find((t) => t.type === "page" && t.url.includes("mock.html"));
  if (!found?.webSocketDebuggerUrl) throw new Error("navigation to mock target failed");
  const list0 = { webSocketDebuggerUrl: found.webSocketDebuggerUrl };
  await sleep(1200);
  const ws = list0.webSocketDebuggerUrl ?? (await firstPageWs());

  const cfg = normalizeSkinConfig({
    appearance: "dark",
    accentHex: "#e879f9",
    windowBlurPx: 22,
    imgBrightness: 110,
    imageDataUrl:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  });
  const r1 = await applySkinOnTarget(ws, buildSkinEngineJs(cfg));
  console.log("apply:", JSON.stringify(r1));

  const chk1 = await evaluateOnTarget(
    ws,
    "JSON.stringify({style:!!document.getElementById('__oc_studio_style__'),cls:document.documentElement.classList.contains('oc-studio-skin'),ls:!!localStorage.getItem('__oc_skin_cfg_v2'),engine:!!window.__ocSkinEngine__})",
  );
  console.log("state:", chk1);

  await evaluateOnTarget(ws, "location.reload()");
  await sleep(2500);
  const ws2 = await firstPageWs();
  const chk2 = await evaluateOnTarget(
    ws2,
    "JSON.stringify({style:!!document.getElementById('__oc_studio_style__'),cls:document.documentElement.classList.contains('oc-studio-skin'),ls:(function(){try{return !!localStorage.getItem('__oc_skin_cfg_v2')}catch(e){return 'ERR'}})(),engine:!!window.__ocSkinEngine__,err:window.__ocSkinErr__||null,ready:document.readyState})",
  );
  console.log("after-reload:", chk2);

  await evaluateOnTarget(ws2, "document.getElementById('__oc_studio_style__').remove()");
  await sleep(600);
  const chk3 = await evaluateOnTarget(
    ws2,
    "JSON.stringify({observerRestored:!!document.getElementById('__oc_studio_style__')})",
  );
  console.log("observer:", chk3);

  const rs = await restoreOnTarget(ws2);
  await sleep(300);
  const chk4 = await evaluateOnTarget(
    ws2,
    "JSON.stringify({style:!!document.getElementById('__oc_studio_style__'),cls:document.documentElement.classList.contains('oc-studio-skin'),ls:!!localStorage.getItem('__oc_skin_cfg_v2')})",
  );
  console.log("restore-result:", rs, "after-restore:", chk4);
  await sleep(300);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
