"use client";

import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import Toast from "@/components/Toast";
import NewManifestWizard from "@/components/wizard/NewManifestWizard";
import { useConsoleBootstrap } from "@/hooks/useConsoleBootstrap";
import { useConsoleStore } from "@/store/useConsoleStore";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  useConsoleBootstrap();
  const wizardOpen = useConsoleStore((s) => s.wizardOpen);
  const openWizard = useConsoleStore((s) => s.openWizard);
  const apiError = useConsoleStore((s) => s.apiError);

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0">
        <Topbar onOpenWizard={openWizard} />
        {apiError && (
          <div className="flex-none px-8 py-2 bg-[#FEF3C7] text-[#92400E] text-[12.5px] font-semibold border-b border-[#FDE68A]">
            API unreachable — run <code className="font-mono">npm run dev</code> from the repo root (needs api on :3001). {apiError}
          </div>
        )}
        <div className="flex-1 overflow-y-auto py-7 px-8">{children}</div>
      </div>

      {wizardOpen && <NewManifestWizard />}
      <Toast />
    </div>
  );
}
