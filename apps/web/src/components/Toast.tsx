"use client";

import { useConsoleStore } from "@/store/useConsoleStore";

export default function Toast() {
  const toast = useConsoleStore((s) => s.toast);
  if (!toast) return null;
  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#14161B] text-white py-3 px-5 rounded-[10px] text-[13px] font-semibold shadow-[0_8px_24px_rgba(0,0,0,0.25)] z-[500]"
      style={{ animation: "fade-in 0.2s ease" }}
    >
      {toast}
    </div>
  );
}
