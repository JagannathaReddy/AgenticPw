"use client";

import { useConsoleStore } from "@/store/useConsoleStore";

export default function SettingsPage() {
  const settings = useConsoleStore((s) => s.settings);

  if (!settings) {
    return (
      <div className="max-w-[820px] bg-white border border-[#E4E6EB] rounded-xl p-10 text-center text-[#9CA3AF]">
        Loading settings…
      </div>
    );
  }

  const doctorOk = settings.checks.every((c) => c.ok);

  return (
    <div className="flex flex-col gap-4 max-w-[820px]">
      <div className="bg-white border border-[#E4E6EB] rounded-xl p-5">
        <div className="text-[13.5px] font-bold mb-3">Environment</div>
        {settings.env.map((e) => (
          <div key={e.name} className="flex items-center py-2 border-b border-[#F5F6F8] text-[12.5px] last:border-0">
            <span className="font-mono text-[#4B5563] flex-1">{e.name}</span>
            <span
              className="text-[11px] font-bold py-0.5 px-2 rounded-full"
              style={{
                color: e.set ? "#16A34A" : "#DC2626",
                background: e.set ? "#DCFCE7" : "#FEE2E2",
              }}
            >
              {e.value ?? (e.set ? "set" : "missing")}
            </span>
          </div>
        ))}
      </div>

      <div className="bg-white border border-[#E4E6EB] rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="text-[13.5px] font-bold">Doctor</div>
          <span
            className="text-[11px] font-bold py-0.5 px-2 rounded-full"
            style={{
              color: doctorOk ? "#16A34A" : "#D97706",
              background: doctorOk ? "#DCFCE7" : "#FEF3C7",
            }}
          >
            {doctorOk ? "All good" : "Needs attention"}
          </span>
        </div>
        {settings.checks.map((d) => (
          <div key={d.label} className="py-2.5 border-b border-[#F5F6F8] text-[12.5px] last:border-0">
            <div className="flex items-center gap-2.5">
              <span
                className="w-[7px] h-[7px] rounded-full flex-none"
                style={{ background: d.ok ? "#16A34A" : "#D97706" }}
              />
              <span className="flex-1 font-semibold">{d.label}</span>
              <span className="font-semibold" style={{ color: d.ok ? "#16A34A" : "#D97706" }}>
                {d.ok ? "OK" : "Check"}
              </span>
            </div>
            {d.detail && <div className="text-[11.5px] text-[#9CA3AF] mt-1 ml-4">{d.detail}</div>}
            {!d.ok && d.fixHint && (
              <div className="text-[11.5px] text-[#D97706] mt-0.5 ml-4">→ {d.fixHint}</div>
            )}
          </div>
        ))}
      </div>

      <div className="bg-white border border-[#E4E6EB] rounded-xl p-5">
        <div className="text-[13.5px] font-bold mb-3">Workspace</div>
        <div className="text-[13px] font-semibold">{settings.workspace}</div>
        {settings.repoCount != null && (
          <div className="text-[12px] text-[#9CA3AF] mt-1">{settings.repoCount} repos registered</div>
        )}
      </div>
    </div>
  );
}
