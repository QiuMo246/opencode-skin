import { useState } from "react";
import {
  Palette,
  Storefront,
  Images,
  SlidersHorizontal,
  Mountains,
  ArrowsClockwise,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { DesktopSkinProvider } from "./lib/desktopSkin";
import EditorPage from "./pages/EditorPage";
import MarketPage from "./pages/MarketPage";
import GalleryPage from "./pages/GalleryPage";
import DesktopEditorPage from "./pages/DesktopEditorPage";
import DesktopMarketPage from "./pages/DesktopMarketPage";
import WallpaperWorkbenchPage from "./pages/WallpaperWorkbenchPage";

type Page = "editor" | "market" | "gallery" | "dt-editor" | "dt-market" | "dt-wallpaper";

const GROUPS: Array<{ title: string; items: Array<{ id: Page; label: string; hint: string; icon: Icon }> }> =
  [
    {
      title: "终端皮肤",
      items: [
        { id: "editor", label: "主题编辑器", hint: "49 槽位 · 实时预览", icon: Palette },
        { id: "market", label: "主题市场", hint: "官方精选 · GitHub · 一键安装", icon: Storefront },
        { id: "gallery", label: "壁纸工作台", hint: "上传取色 · 生成主题", icon: Images },
      ],
    },
    {
      title: "桌面端皮肤",
      items: [
        { id: "dt-editor", label: "主题编辑器", hint: "实时同步 · 预设 · 截图预览", icon: SlidersHorizontal },
        { id: "dt-market", label: "主题市场", hint: "官方配色映射 · 精选主题库", icon: Storefront },
        { id: "dt-wallpaper", label: "壁纸工作台", hint: "上传取色 · 焦点 · 一键应用", icon: Mountains },
      ],
    },
  ];

export default function App() {
  const [page, setPage] = useState<Page>("editor");

  return (
    <DesktopSkinProvider>
      <div className="app">
        <aside className="sidebar">
          <div className="brand">
            <span className="brand-mark">OC</span>
            <div>
              <div className="brand-name">Skin Studio</div>
              <div className="brand-sub">opencode 换肤工作台 v0.2</div>
            </div>
          </div>
          <nav>
            {GROUPS.map((g) => (
              <div key={g.title} className="nav-group">
                <div className="nav-group-title">{g.title}</div>
                {g.items.map((n) => {
                  const Ico = n.icon;
                  return (
                    <button
                      key={n.id}
                      className={page === n.id ? "nav-item active" : "nav-item"}
                      onClick={() => setPage(n.id)}
                      aria-current={page === n.id ? "page" : undefined}
                    >
                      <span className="nav-icon">
                        <Ico size={17} weight={page === n.id ? "fill" : "regular"} />
                      </span>
                      <span className="nav-texts">
                        <span className="nav-label">{n.label}</span>
                        <span className="nav-hint">{n.hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
          <footer className="sidebar-foot">
            <span className="status-dot" aria-hidden />
            本地服务 127.0.0.1:5175
          </footer>
        </aside>
        <main className="main">
          <header className="topbar">
            <span className="badge badge-warn">
              <ArrowsClockwise size={13} />
              应用或修改终端主题后需重启 opencode 才会生效；桌面端皮肤实时生效
            </span>
          </header>
          <div key={page} className="page-host">
            {page === "editor" && <EditorPage />}
            {page === "market" && <MarketPage />}
            {page === "gallery" && <GalleryPage />}
            {page === "dt-editor" && <DesktopEditorPage />}
            {page === "dt-market" && <DesktopMarketPage />}
            {page === "dt-wallpaper" && <WallpaperWorkbenchPage />}
          </div>
        </main>
      </div>
    </DesktopSkinProvider>
  );
}
